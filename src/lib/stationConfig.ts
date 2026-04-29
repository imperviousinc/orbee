import { createSignal } from "solid-js";
import { createStore } from "solid-js/store";
import type { NostrEvent } from "./keys";
import type { Signer } from "./signer";
import { profileRelay, getRelay } from "./nostr";
import type { ScopeOverride } from "./stationScope";
import { stationKey, type StationRef } from "./stations";
import { eventMap, registerEvent } from "./replyState";

// Orbee station config - one replaceable kind:30078 event per (admin
// pubkey, station). Carries anything about a station that strict NIP-29
// relays won't let us store in the group metadata itself: scope override,
// pinned message ids, future theme / emoji / welcome bits.
//
// Publishes to whatever general-Nostr relay the client is currently wired
// to (see nostr.ts `profileRelay`). The event schema is relay-agnostic -
// swap the transport and nothing here changes.
//
// Authorization: a config is honored only if its pubkey is in the
// station's current admin list (kind:39001). When multiple admins have
// each published their own, latest `created_at` wins - same tiebreaker
// NIP-29 itself uses when the relay re-emits 39000 from the most recent
// 9002.

export interface StationConfig {
  scope?: ScopeOverride | null;
  pinned?: string[];
}

interface ConfigEntry {
  config: StationConfig;
  pubkey: string;
  created_at: number;
}

// Keyed by stationKey(ref) so components with a ref can read synchronously
// (they don't need to know the hashed d-tag).
const [stationConfigs, setStationConfigs] = createStore<Record<string, ConfigEntry>>({});
export { stationConfigs };

// ── d-tag derivation ──────────────────────────────────────────────
//
// stationId = sha256( sha256(normalizedRelayUrl) || utf8(groupId) )
// dTag      = "orbee:" + stationId  (hex)
//
// The double-hash (HASH(HASH(a) || b)) avoids concat-ambiguity - without
// it, e.g., ("abc","def") and ("ab","cdef") would produce the same byte
// stream. Pre-hashing one component pins its length. Relay URL is
// normalized (lowercase + strip trailing slash) so trivial URL variants
// don't fork a station's config.

const DTAG_PREFIX = "orbee:";
const dTagCache = new Map<string, string>();

function normalizeRelayUrl(url: string): string {
  return url.toLowerCase().replace(/\/+$/, "");
}

async function sha256Bytes(bytes: Uint8Array): Promise<Uint8Array> {
  const hash = await crypto.subtle.digest("SHA-256", bytes as unknown as BufferSource);
  return new Uint8Array(hash);
}

function bytesToHex(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i++) out += bytes[i].toString(16).padStart(2, "0");
  return out;
}

export async function computeStationDTag(ref: StationRef): Promise<string> {
  const k = stationKey(ref);
  const cached = dTagCache.get(k);
  if (cached) return cached;
  const enc = new TextEncoder();
  const relayHash = await sha256Bytes(enc.encode(normalizeRelayUrl(ref.relay)));
  const idBytes = enc.encode(ref.id);
  const combined = new Uint8Array(relayHash.length + idBytes.length);
  combined.set(relayHash, 0);
  combined.set(idBytes, relayHash.length);
  const stationHash = await sha256Bytes(combined);
  const dTag = DTAG_PREFIX + bytesToHex(stationHash);
  dTagCache.set(k, dTag);
  return dTag;
}

// ── Publish ───────────────────────────────────────────────────────
//
// Replaceable events are per-(kind, pubkey, d-tag), so this is whole-
// config overwrite: pass the full intended state. Callers merge with
// current before publishing if they only want to change one field.

export async function editStationConfig(
  signer: Signer,
  ref: StationRef,
  config: StationConfig,
): Promise<{ ok: boolean; message: string }> {
  const dTag = await computeStationDTag(ref);
  const content: StationConfig = {};
  if (config.scope !== undefined) content.scope = config.scope;
  if (config.pinned !== undefined) content.pinned = config.pinned;
  const event = await signer.signEvent({
    kind: 30078,
    content: JSON.stringify(content),
    tags: [["d", dTag]],
  });
  // Optimistic local update so the UI reflects the change before the
  // relay round-trip. applyConfigEvent will re-apply on echo (same
  // timestamp tiebreak keeps it a no-op).
  applyConfigEvent(stationKey(ref), event);
  return profileRelay.publish(event);
}

// ── Pin helpers ───────────────────────────────────────────────────
//
// Thin wrappers around editStationConfig that merge with the current
// config (don't wipe scope when toggling a pin). Whole-config overwrite
// semantics otherwise - the replaceable event is always full state.

function currentPinned(ref: StationRef): string[] {
  return stationConfigs[stationKey(ref)]?.config.pinned ?? [];
}

export async function pinMessage(signer: Signer, ref: StationRef, eventId: string) {
  const k = stationKey(ref);
  const existing = stationConfigs[k]?.config;
  const pinned = currentPinned(ref);
  if (pinned.includes(eventId)) return { ok: true, message: "already pinned" };
  return editStationConfig(signer, ref, {
    ...existing,
    pinned: [...pinned, eventId],
  });
}

export async function unpinMessage(signer: Signer, ref: StationRef, eventId: string) {
  const k = stationKey(ref);
  const existing = stationConfigs[k]?.config;
  const pinned = currentPinned(ref);
  if (!pinned.includes(eventId)) return { ok: true, message: "not pinned" };
  return editStationConfig(signer, ref, {
    ...existing,
    pinned: pinned.filter((id) => id !== eventId),
  });
}

export function isPinned(ref: StationRef, eventId: string): boolean {
  return currentPinned(ref).includes(eventId);
}

// ── Subscribe ─────────────────────────────────────────────────────
//
// One sub per station, filtered by the current admin set from 39001.
// Resubscribes when the admin set changes (debounced via signature
// comparison so cache-hydrate + live-replay don't both fire).

const subsByStation = new Map<string, string>();        // stationKey → sub id
const adminsByStation = new Map<string, string>();      // stationKey → sorted admin signature

export function subscribeStationConfig(ref: StationRef, admins: string[]) {
  const k = stationKey(ref);
  const sig = [...admins].sort().join(",");
  if (adminsByStation.get(k) === sig) return;
  adminsByStation.set(k, sig);

  const prev = subsByStation.get(k);
  if (prev !== undefined) profileRelay.unsubscribe(prev);
  subsByStation.delete(k);

  if (admins.length === 0) return;

  // d-tag is stable for a given ref, so compute once and fire the sub.
  computeStationDTag(ref).then((dTag) => {
    // Admin set may have changed again during the await - if so, the
    // later call has already overwritten adminsByStation, and we'd be
    // starting a stale sub. Bail if the signature no longer matches.
    if (adminsByStation.get(k) !== sig) return;
    const subId = profileRelay.subscribe(
      { kinds: [30078], authors: admins, "#d": [dTag] } as any,
      (event) => applyConfigEvent(k, event),
    );
    subsByStation.set(k, subId);
  });
}

export function unsubscribeStationConfig(ref: StationRef) {
  const k = stationKey(ref);
  const sub = subsByStation.get(k);
  if (sub !== undefined) profileRelay.unsubscribe(sub);
  subsByStation.delete(k);
  adminsByStation.delete(k);
}

/** Drop cached config (pinned, scope, etc.) for a station. Call on leave. */
export function clearStationConfig(ref: StationRef) {
  const k = stationKey(ref);
  unsubscribeStationConfig(ref);
  setStationConfigs(k, undefined as any);
}

function applyConfigEvent(k: string, event: NostrEvent) {
  const existing = stationConfigs[k];
  if (existing && existing.created_at >= event.created_at) return;
  let parsed: any;
  try {
    parsed = JSON.parse(event.content);
  } catch {
    return;
  }
  if (!parsed || typeof parsed !== "object") return;
  const config: StationConfig = {
    scope: parsed.scope ?? undefined,
    pinned: Array.isArray(parsed.pinned) ? parsed.pinned.filter((x: any) => typeof x === "string") : [],
  };
  setStationConfigs(k, { config, pubkey: event.pubkey, created_at: event.created_at });

  // Kick off fetches for any pinned event bodies we don't already have in
  // the session event map. Pins often reference older messages outside
  // the hydrated feed window; the pinned panel needs the full event to
  // render author + content + timestamp.
  const refParts = k.split("::");
  if (refParts.length === 2 && config.pinned && config.pinned.length > 0) {
    ensurePinnedBodies({ relay: refParts[0], id: refParts[1] }, config.pinned);
  }
}

// ── Fetch missing pinned bodies ───────────────────────────────────
//
// One-shot subscription by id on the station's group relay. Unsubscribes
// on EOSE. Idempotent: never refetches an id that's already in eventMap
// or in-flight.
//
// Any id that doesn't resolve by EOSE is marked in `missingPinIds` -
// the event was deleted, expired, or the relay never had it. UI reads
// this to hide the dead pin (instead of showing "loading…" forever).

const inflightPinFetches = new Set<string>();
const [missingPinIdsSignal, setMissingPinIdsSignal] = createSignal<Set<string>>(new Set());
export const missingPinIds = missingPinIdsSignal;

function markMissing(ids: string[]) {
  if (ids.length === 0) return;
  const next = new Set(missingPinIdsSignal());
  let changed = false;
  for (const id of ids) {
    if (!next.has(id)) {
      next.add(id);
      changed = true;
    }
  }
  if (changed) setMissingPinIdsSignal(next);
}

function ensurePinnedBodies(ref: StationRef, pinnedIds: string[]) {
  const missing = pinnedIds.filter(
    (id) => !eventMap[id] && !inflightPinFetches.has(id),
  );
  if (missing.length === 0) return;
  for (const id of missing) inflightPinFetches.add(id);
  const r = getRelay(ref.relay);
  r.connect()
    .then(() => {
      let subId: string | null = null;
      subId = r.subscribe(
        { ids: missing, kinds: [9] } as any,
        (event) => registerEvent(event),
        () => {
          if (subId !== null) r.unsubscribe(subId);
          for (const id of missing) inflightPinFetches.delete(id);
          // Any id we asked for that didn't come back by EOSE is dead
          // (deleted upstream or never existed). Mark so the UI skips it.
          const unresolved = missing.filter((id) => !eventMap[id]);
          markMissing(unresolved);
        },
      );
    })
    .catch(() => {
      for (const id of missing) inflightPinFetches.delete(id);
      // Connection failed - treat as missing for now; a later reconnect
      // + fresh fetch will un-mark if the event is actually there.
      markMissing(missing);
    });
}
