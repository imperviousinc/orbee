import { schnorr } from "@noble/curves/secp256k1.js";

export interface Keypair {
  privkey: Uint8Array;
  pubkey: string; // hex
}

export interface NostrEvent {
  id: string;
  pubkey: string;
  created_at: number;
  kind: number;
  tags: string[][];
  content: string;
  sig: string;
}

export function bytesToHex(b: Uint8Array): string {
  return Array.from(b)
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("");
}

export function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

// ── Bech32 (NIP-19) ──

const BECH32_CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";

function bech32Decode(str: string): { hrp: string; data: Uint8Array } | null {
  const pos = str.lastIndexOf("1");
  if (pos < 1 || pos + 7 > str.length) return null;
  const hrp = str.slice(0, pos);
  const dataChars = str.slice(pos + 1);
  const values: number[] = [];
  for (const c of dataChars) {
    const v = BECH32_CHARSET.indexOf(c);
    if (v === -1) return null;
    values.push(v);
  }
  // Strip 6-char checksum, convert 5-bit to 8-bit
  const fiveBit = values.slice(0, -6);
  let acc = 0, bits = 0;
  const result: number[] = [];
  for (const v of fiveBit) {
    acc = (acc << 5) | v;
    bits += 5;
    while (bits >= 8) {
      bits -= 8;
      result.push((acc >> bits) & 0xff);
    }
  }
  return { hrp, data: new Uint8Array(result) };
}

/** Decode an nsec1... bech32 string to a 32-byte private key. */
export function decodeNsec(nsec: string): Uint8Array | null {
  const decoded = bech32Decode(nsec.toLowerCase().trim());
  if (!decoded || decoded.hrp !== "nsec" || decoded.data.length !== 32) return null;
  return decoded.data;
}

/** Decode an npub1... bech32 string to a 32-byte hex pubkey. */
export function decodeNpub(npub: string): string | null {
  const decoded = bech32Decode(npub.toLowerCase().trim());
  if (!decoded || decoded.hrp !== "npub" || decoded.data.length !== 32) return null;
  return bytesToHex(decoded.data);
}

// ── Bech32 encode (for npub display) ──

function bech32Polymod(values: number[]): number {
  const GEN = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
  let chk = 1;
  for (const v of values) {
    const b = chk >>> 25;
    chk = ((chk & 0x1ffffff) << 5) ^ v;
    for (let i = 0; i < 5; i++) if ((b >> i) & 1) chk ^= GEN[i];
  }
  return chk;
}

function bech32HrpExpand(hrp: string): number[] {
  const out: number[] = [];
  for (let i = 0; i < hrp.length; i++) out.push(hrp.charCodeAt(i) >> 5);
  out.push(0);
  for (let i = 0; i < hrp.length; i++) out.push(hrp.charCodeAt(i) & 31);
  return out;
}

function bech32Checksum(hrp: string, data: number[]): number[] {
  const values = [...bech32HrpExpand(hrp), ...data, 0, 0, 0, 0, 0, 0];
  const mod = bech32Polymod(values) ^ 1;
  const out: number[] = [];
  for (let i = 0; i < 6; i++) out.push((mod >> (5 * (5 - i))) & 31);
  return out;
}

function convertBits8to5(bytes: Uint8Array): number[] {
  let acc = 0, bits = 0;
  const out: number[] = [];
  for (const value of bytes) {
    acc = (acc << 8) | value;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      out.push((acc >> bits) & 31);
    }
  }
  if (bits > 0) out.push((acc << (5 - bits)) & 31);
  return out;
}

/**
 * Encode a 32-byte hex pubkey as `npub1…`. Cached by hex input - the
 * conversion is hot-path (every message render with no profile).
 */
const npubCache = new Map<string, string>();
export function pubkeyToNpub(pubkeyHex: string): string {
  const cached = npubCache.get(pubkeyHex);
  if (cached) return cached;
  const data = convertBits8to5(hexToBytes(pubkeyHex));
  const combined = [...data, ...bech32Checksum("npub", data)];
  const out = "npub1" + combined.map((c) => BECH32_CHARSET[c]).join("");
  npubCache.set(pubkeyHex, out);
  return out;
}

/**
 * Encode a 32-byte private key as `nsec1…`. Used by the profile editor
 * to surface the user's recovery key. NOT cached - small enough,
 * called rarely, and avoiding a long-lived reference in memory.
 */
export function privkeyToNsec(privkey: Uint8Array): string {
  const data = convertBits8to5(privkey);
  const combined = [...data, ...bech32Checksum("nsec", data)];
  return "nsec1" + combined.map((c) => BECH32_CHARSET[c]).join("");
}

/** Truncated `npub1abcd…wxyz` for display when no handle is known. */
export function truncateNpub(pubkeyHex: string): string {
  const npub = pubkeyToNpub(pubkeyHex);
  return npub.slice(0, 10) + "…" + npub.slice(-4);
}

/** Longer truncation - used on the handle-claim setup page to
 *  visually hammer "look how much shorter a handle is vs. this". */
export function truncateNpubLong(pubkeyHex: string): string {
  const npub = pubkeyToNpub(pubkeyHex);
  return npub.slice(0, 24) + "…" + npub.slice(-8);
}

/**
 * Same truncation as `truncateNpub`, but split into structural parts so
 * the renderer can fade the non-identifying bits.
 *
 *   prefix - "npub1"  (bech32 HRP + separator; identical on every npub)
 *   head   - first 5 data chars (most-identifying bits of the pubkey)
 *   tail   - last 4 chars (mostly checksum; useful for visual compare)
 *
 * The prefix and the ellipsis between head/tail carry no identifying
 * information, so the UI can dim them to ~45% opacity and let the eye
 * land on the head + tail.
 */
export function truncateNpubParts(pubkeyHex: string): {
  prefix: string;
  head: string;
  tail: string;
} {
  const npub = pubkeyToNpub(pubkeyHex);
  return {
    prefix: npub.slice(0, 5),
    head: npub.slice(5, 10),
    tail: npub.slice(-4),
  };
}

// ── Auth persistence ──
//
// Method-aware: `orbee-auth-method` localStorage key discriminates which
// sign-in path the user picked last time. Each method has its own stored
// material. Only one method is active at a time.

const AUTH_METHOD_KEY = "orbee-auth-method";
const AUTH_PRIVKEY_KEY = "spaces-board-privkey";
const AUTH_HANDLE_KEY = "spaces-board-handle";
const AUTH_NIP07_PUBKEY_KEY = "orbee-nip07-pubkey";
const AUTH_BUNKER_KEY = "orbee-bunker-session";
const BACKUP_PENDING_PREFIX = "orbee-backup-pending:";
const BACKUP_SNOOZED_UNTIL_PREFIX = "orbee-backup-snoozed:";

export interface StoredBunkerSession {
  clientSkHex: string;       // ephemeral client keypair private key (hex)
  signerPubkey: string;      // bunker's pubkey
  relays: string[];          // relays to reach the bunker on
  secret: string | null;     // connection secret token
  userPubkey: string;        // the user's pubkey the bunker signs as (cached)
}

export type StoredAuth =
  | { method: "local"; handle: string; keypair: Keypair }
  | { method: "nip07"; pubkey: string }
  | { method: "bunker"; session: StoredBunkerSession };

/** Build a keypair from a raw 32-byte private key. */
export function keypairFromPrivkey(privkey: Uint8Array): Keypair {
  const pubkey = bytesToHex(schnorr.getPublicKey(privkey));
  return { privkey, pubkey };
}

/** Load stored auth material. Returns null if not signed in. App.tsx
 *  dispatches on `method` to construct the right Signer. */
export function loadAuth(): StoredAuth | null {
  const method = localStorage.getItem(AUTH_METHOD_KEY);
  if (method === "nip07") {
    const pubkey = localStorage.getItem(AUTH_NIP07_PUBKEY_KEY);
    if (!pubkey) return null;
    return { method: "nip07", pubkey };
  }
  if (method === "bunker") {
    const raw = localStorage.getItem(AUTH_BUNKER_KEY);
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as StoredBunkerSession;
      if (!parsed?.clientSkHex || !parsed?.signerPubkey || !Array.isArray(parsed.relays)) return null;
      return { method: "bunker", session: parsed };
    } catch {
      return null;
    }
  }
  // Default / legacy: local signer (pre-dates the method key).
  const hex = localStorage.getItem(AUTH_PRIVKEY_KEY);
  if (!hex) return null;
  const handle = localStorage.getItem(AUTH_HANDLE_KEY) || "";
  const privkey = hexToBytes(hex);
  return { method: "local", handle, keypair: keypairFromPrivkey(privkey) };
}

/** Persist local-signer auth (nsec import / fresh keypair). */
export function saveLocalAuth(handle: string, privkey: Uint8Array) {
  localStorage.setItem(AUTH_METHOD_KEY, "local");
  localStorage.setItem(AUTH_PRIVKEY_KEY, bytesToHex(privkey));
  localStorage.setItem(AUTH_HANDLE_KEY, handle);
  localStorage.removeItem(AUTH_NIP07_PUBKEY_KEY);
}

/** Persist NIP-07 (browser-extension) auth. We only remember which
 *  pubkey the extension returned last time; signing always round-trips
 *  through window.nostr on demand. */
export function saveNip07Auth(pubkey: string) {
  localStorage.setItem(AUTH_METHOD_KEY, "nip07");
  localStorage.setItem(AUTH_NIP07_PUBKEY_KEY, pubkey);
  localStorage.removeItem(AUTH_PRIVKEY_KEY);
  localStorage.removeItem(AUTH_HANDLE_KEY);
  localStorage.removeItem(AUTH_BUNKER_KEY);
}

/** Persist NIP-46 (bunker) auth. Stores the ephemeral client key + bunker
 *  pointer so a reload can reconnect without fresh pairing. */
export function saveBunkerAuth(session: StoredBunkerSession) {
  localStorage.setItem(AUTH_METHOD_KEY, "bunker");
  localStorage.setItem(AUTH_BUNKER_KEY, JSON.stringify(session));
  localStorage.removeItem(AUTH_PRIVKEY_KEY);
  localStorage.removeItem(AUTH_HANDLE_KEY);
  localStorage.removeItem(AUTH_NIP07_PUBKEY_KEY);
}

/** Clear all stored auth regardless of method. */
export function clearAuth() {
  localStorage.removeItem(AUTH_METHOD_KEY);
  localStorage.removeItem(AUTH_PRIVKEY_KEY);
  localStorage.removeItem(AUTH_HANDLE_KEY);
  localStorage.removeItem(AUTH_NIP07_PUBKEY_KEY);
  localStorage.removeItem(AUTH_BUNKER_KEY);
}

// ── Backup-pending tracking ──
//
// When a user signs up via the "fast-mint" path (we generate a keypair for
// them), they haven't yet saved their nsec anywhere. We nag them to back it
// up via an amber banner; this tracks per-pubkey state.
//
//   setBackupPending(pk)  - fresh key minted for this pubkey
//   clearBackupPending(pk) - user confirmed "I've saved it"
//   isBackupPending(pk)   - banner should show (unless snoozed)
//   snoozeBackup(pk)      - user clicked "Remind me later" (1h timeout)
//   isBackupSnoozed(pk)   - snooze still active

export function setBackupPending(pubkey: string) {
  localStorage.setItem(BACKUP_PENDING_PREFIX + pubkey, "1");
}

export function clearBackupPending(pubkey: string) {
  localStorage.removeItem(BACKUP_PENDING_PREFIX + pubkey);
  localStorage.removeItem(BACKUP_SNOOZED_UNTIL_PREFIX + pubkey);
}

export function isBackupPending(pubkey: string): boolean {
  return localStorage.getItem(BACKUP_PENDING_PREFIX + pubkey) === "1";
}

export function snoozeBackup(pubkey: string, ms = 60 * 60 * 1000) {
  localStorage.setItem(
    BACKUP_SNOOZED_UNTIL_PREFIX + pubkey,
    String(Date.now() + ms),
  );
}

export function isBackupSnoozed(pubkey: string): boolean {
  const until = localStorage.getItem(BACKUP_SNOOZED_UNTIL_PREFIX + pubkey);
  if (!until) return false;
  const n = parseInt(until, 10);
  if (!Number.isFinite(n)) return false;
  return n > Date.now();
}

// Event signing now lives on the Signer abstraction - see lib/signer.ts.
// LocalSigner.signEvent replaces the old createSignedEvent(keypair, …).

/**
 * Friendly identity label when no handle is known.
 * Returns truncated `npub1abcd…wxyz` form - recognizable across nostr clients.
 */
export function truncatePubkey(pubkey: string): string {
  return truncateNpub(pubkey);
}
