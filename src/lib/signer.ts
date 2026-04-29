import { schnorr } from "@noble/curves/secp256k1.js";
import type { WindowNostr } from "nostr-tools/nip07";
import { sha256Hex } from "./crypto";
import {
  bytesToHex,
  hexToBytes,
  type Keypair,
  type NostrEvent,
} from "./keys";

declare global {
  interface Window {
    nostr?: WindowNostr;
  }
}

// ── Signer abstraction ────────────────────────────────────────────
//
// Every event Orbee publishes goes through a `Signer`. The implementation
// determines WHERE the signing happens:
//
//   • LocalSigner  - in-process, uses a raw Keypair (nsec-imported or
//                    newly-minted). Default for the existing auth flow.
//   • Nip07Signer  - forwards to window.nostr (browser-extension signer
//                    like Alby / nos2x). Lands in a later pass.
//   • BunkerSigner - forwards to a remote NIP-46 signer over relay
//                    events (nsec.app, nostrsigner, etc.). Lands after.
//
// Callers only touch the interface. Refactoring `createSignedEvent` into
// `signer.signEvent()` everywhere is the prereq for any non-local auth
// path - without it, a BunkerSigner can't "be the keypair" because it
// doesn't have one.

/** Fields a caller supplies; the signer fills in pubkey / id / sig / created_at. */
export interface UnsignedEvent {
  kind: number;
  content: string;
  tags: string[][];
  /** Optional - signer uses `Math.floor(Date.now()/1000)` if absent. */
  created_at?: number;
}

export interface Signer {
  /** Public key in 32-byte hex (Nostr-native form, not npub). */
  readonly pubkey: string;
  /** Finalize & sign an event. Returns a full `NostrEvent` ready to publish. */
  signEvent(unsigned: UnsignedEvent): Promise<NostrEvent>;
}

// ── LocalSigner ──────────────────────────────────────────────────
//
// Wraps a Keypair. The Keypair is an internal detail - consumers should
// route everything through the Signer interface. The one exception is
// the recovery-key reveal in ProfileEditor, which needs the raw privkey
// to encode an nsec; that branch uses `isLocalSigner(s)` as a type guard
// and won't render for non-Local signers.

export class LocalSigner implements Signer {
  constructor(public readonly keypair: Keypair) {}

  get pubkey(): string {
    return this.keypair.pubkey;
  }

  async signEvent(unsigned: UnsignedEvent): Promise<NostrEvent> {
    const created_at = unsigned.created_at ?? Math.floor(Date.now() / 1000);
    const tags = unsigned.tags ?? [];
    const serialized = JSON.stringify([
      0,
      this.keypair.pubkey,
      created_at,
      unsigned.kind,
      tags,
      unsigned.content,
    ]);
    const id = await sha256Hex(serialized);
    const sig = bytesToHex(schnorr.sign(hexToBytes(id), this.keypair.privkey));
    return {
      id,
      pubkey: this.keypair.pubkey,
      created_at,
      kind: unsigned.kind,
      tags,
      content: unsigned.content,
      sig,
    };
  }
}

/** Narrow a Signer to LocalSigner when the caller needs raw keypair access
 *  (e.g., the recovery-key reveal). Returns false for remote signers. */
export function isLocalSigner(s: Signer): s is LocalSigner {
  return s instanceof LocalSigner;
}

// ── Nip07Signer ──────────────────────────────────────────────────
//
// Forwards signing to window.nostr - the browser-extension signer
// (Alby, nos2x, nostr-keys-signer, etc.). The extension holds the
// private key; this client never touches it.
//
// Pubkey is fetched once at init() and cached sync on the instance,
// so the reactive UI can read `signer.pubkey` without awaits.
// signEvent() forwards each event to the extension, which prompts the
// user (or silently signs if they've whitelisted Orbee).

export class Nip07Signer implements Signer {
  constructor(public readonly pubkey: string) {}

  /** Fetch pubkey from the extension and build the signer. Throws if
   *  no extension is installed. */
  static async init(): Promise<Nip07Signer> {
    if (!window.nostr) throw new Error("NIP-07 extension not found");
    const pubkey = await window.nostr.getPublicKey();
    return new Nip07Signer(pubkey);
  }

  async signEvent(unsigned: UnsignedEvent): Promise<NostrEvent> {
    if (!window.nostr) throw new Error("NIP-07 extension disconnected");
    // Extension fills in id/pubkey/sig/created_at (if absent) and returns
    // a fully-signed event. Its WindowNostr.signEvent returns VerifiedEvent
    // from nostr-tools, which is assignable to our NostrEvent shape.
    const signed = await window.nostr.signEvent({
      kind: unsigned.kind,
      content: unsigned.content,
      tags: unsigned.tags,
      created_at: unsigned.created_at ?? Math.floor(Date.now() / 1000),
    });
    return signed as unknown as NostrEvent;
  }
}

export function isNip07Signer(s: Signer): s is Nip07Signer {
  return s instanceof Nip07Signer;
}

/** True if a NIP-07 extension is currently installed. */
export function hasNip07(): boolean {
  return typeof window !== "undefined" && !!window.nostr;
}

// ── Nip46Signer (bunker) ─────────────────────────────────────────
//
// Remote signing via NIP-46. The user's private key lives in a separate
// signer app (nsec.app, Amber, bunker CLI, etc.); we talk to it over
// encrypted events relayed through one or more Nostr relays. nostr-tools'
// BunkerSigner does the protocol heavy lifting (connect handshake,
// encrypted JSON-RPC, re-sends, reconnection) - we just wrap it to fit
// Orbee's sync-pubkey Signer interface.
//
// Two connection flows:
//
//   • bunker://<signerPubkey>?relay=<url>&secret=<token>
//       signer-initiated - user pastes the URL from their signer app.
//       We generate an ephemeral client keypair, call BunkerSigner.fromBunker,
//       and the library sends "connect" over the specified relays.
//
//   • nostrconnect://<clientPubkey>?relay=<url>&secret=<token>&name=Orbee
//       client-initiated - we generate the URI + QR on the sign-in page,
//       user scans it with their signer, BunkerSigner.fromURI waits for
//       the signer to reach us.
//
// Persistence: we remember (clientSk, signerPubkey, relays, secret) so
// reload can reconnect without re-pairing.

import { BunkerSigner, parseBunkerInput, type BunkerPointer } from "nostr-tools/nip46";
import { generateSecretKey } from "nostr-tools/pure";

export interface BunkerSessionState {
  clientSk: Uint8Array;  // ephemeral client keypair private key
  signerPubkey: string;
  relays: string[];
  secret: string | null;
}

export class Nip46Signer implements Signer {
  constructor(
    public readonly pubkey: string,
    private bunker: BunkerSigner,
    /** Snapshot of the session params - used to persist + rebuild on reload. */
    public readonly session: BunkerSessionState,
  ) {}

  async signEvent(unsigned: UnsignedEvent): Promise<NostrEvent> {
    const signed = await this.bunker.signEvent({
      kind: unsigned.kind,
      content: unsigned.content,
      tags: unsigned.tags,
      created_at: unsigned.created_at ?? Math.floor(Date.now() / 1000),
    });
    return signed as unknown as NostrEvent;
  }

  async close(): Promise<void> {
    try { await this.bunker.close(); } catch { /* best-effort */ }
  }

  // ── Factories ──

  /** Client-initiated flow. We generate the nostrconnect:// URI, call
   *  fromURI, which waits for the signer to respond. Returns both the
   *  URI (for display as QR + copy text) and a Promise that resolves
   *  to the ready signer once the signer pairs. */
  static beginNostrConnect(opts: {
    relays: string[];
    name?: string;
    abort?: AbortSignal;
  }): { uri: string; clientSk: Uint8Array; ready: Promise<Nip46Signer> } {
    const clientSk = generateSecretKey();
    const secret = randomHex(32);
    // BunkerSigner.fromURI accepts a nostrconnect:// URI - but we need to
    // build one ourselves since we're the client originating the flow.
    // (nostr-tools exposes createNostrConnectURI; import it here.)
    const uri = createNostrConnectURI({
      clientPubkey: pubkeyFromSk(clientSk),
      relays: opts.relays,
      secret,
      name: opts.name ?? "Orbee",
    });
    const ready = BunkerSigner.fromURI(
      clientSk,
      uri,
      {},
      opts.abort ?? 300_000,  // 5-minute default to scan + approve
    ).then(async (bunker) => {
      const pubkey = await bunker.getPublicKey();
      return new Nip46Signer(pubkey, bunker, {
        clientSk,
        signerPubkey: bunker.bp.pubkey,
        relays: bunker.bp.relays,
        secret: bunker.bp.secret,
      });
    });
    return { uri, clientSk, ready };
  }

  /** Signer-initiated flow. User pastes a bunker:// URL (or a NIP-05
   *  `name@domain.com` that resolves to one); we parse, generate an
   *  ephemeral client key, and call BunkerSigner.fromBunker. */
  static async fromBunkerUri(input: string): Promise<Nip46Signer> {
    const bp = await parseBunkerInput(input);
    if (!bp) throw new Error("Invalid bunker URL");
    const clientSk = generateSecretKey();
    const bunker = BunkerSigner.fromBunker(clientSk, bp);
    await bunker.connect();
    const pubkey = await bunker.getPublicKey();
    return new Nip46Signer(pubkey, bunker, {
      clientSk,
      signerPubkey: bp.pubkey,
      relays: bp.relays,
      secret: bp.secret,
    });
  }

  /** Rebuild a session from persisted state after a page reload. No
   *  re-pairing needed - we reconnect with the same ephemeral key. */
  static async fromSession(session: BunkerSessionState): Promise<Nip46Signer> {
    const bp: BunkerPointer = {
      pubkey: session.signerPubkey,
      relays: session.relays,
      secret: session.secret,
    };
    const bunker = BunkerSigner.fromBunker(session.clientSk, bp);
    await bunker.connect();
    const pubkey = await bunker.getPublicKey();
    return new Nip46Signer(pubkey, bunker, session);
  }
}

export function isNip46Signer(s: Signer): s is Nip46Signer {
  return s instanceof Nip46Signer;
}

// ── small helpers ─────────────────────────────────────────────────

function randomHex(bytes: number): string {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return bytesToHex(arr);
}

function pubkeyFromSk(sk: Uint8Array): string {
  return bytesToHex(schnorr.getPublicKey(sk));
}

// Import what we need from nostr-tools for the nostrconnect flow - kept
// at the bottom so the primary Signer/LocalSigner/Nip07Signer code stays
// at the top of the file.
import { createNostrConnectURI } from "nostr-tools/nip46";