/**
 * Fabric RPC client.
 *
 * The real Fabric client (WASM + handle cache) lives in the SharedWorker
 * - one instance across all tabs. This module just forwards resolve
 * requests and awaits the serialized response, so per-tab overhead is
 * zero and the cache is shared.
 *
 * Zones come back pre-serialized as `{handle, json}` - consumers that
 * used to call `zone.toJson()` now just read `zone.json` directly.
 *
 * Fabric 0.2 API:
 *   • `resolveAll(handles)` returns an array of zones directly (no
 *     wrapping ResolvedBatch, no separate roots field).
 *   • `resolve(handle)` returns the inner zone.
 *   • `badge(zone)` takes the zone; bootstrap is implicit.
 * The worker holds each zone in a Map<handle, zone> so badge() calls
 * don't need to re-transmit zones over postMessage (they're WASM-backed
 * and not structured-cloneable anyway).
 */

import { ensureWorker, onFabricMessage } from "./nostr";

export interface ResolvedZone {
  /** Human-readable handle, e.g. "alice@bitcoin". */
  handle: string;
  /** Parsed zone data: `{ records: Array<{type, key, value/values}> }`. */
  json: any;
}

type ResolvePending = {
  kind: "resolve";
  resolve: (v: ResolvedZone[]) => void;
  reject: (e: unknown) => void;
};
type PublishPending = {
  kind: "publish";
  resolve: () => void;
  reject: (e: unknown) => void;
};
type TrustPending = {
  kind: "trust";
  resolve: () => void;
  reject: (e: unknown) => void;
};
type BadgesPending = {
  kind: "badges";
  resolve: (v: Badge[]) => void;
  reject: (e: unknown) => void;
};
type TrustedPending = {
  kind: "trusted";
  resolve: (v: TrustedSnapshot) => void;
  reject: (e: unknown) => void;
};
type Pending = ResolvePending | PublishPending | TrustPending | BadgesPending | TrustedPending;

/** Snapshot of fabric's anchor pools, returned by getTrustedId. */
export interface TrustedSnapshot {
  /** Hex-encoded trust ID the user pinned, or null. */
  trusted: string | null;
  /** Hex-encoded observed root from the latest anchor fetch. */
  observed: string | null;
  /** Hex-encoded semi-trusted root (e.g. from a public explorer). */
  semiTrusted: string | null;
}

export type Badge = "orange" | "unverified" | "none";

const pending = new Map<string, Pending>();
let reqSeq = 0;

// Register once on module init - the dispatcher in nostr.ts calls this
// when any `fabric_*` message arrives. Routes by reqId to the waiting
// promise and resolves/rejects based on message type.
onFabricMessage((data: any) => {
  console.log("[fabric/recv]", { type: data.type, reqId: data.reqId, hasPending: pending.has(data.reqId) });
  const p = pending.get(data.reqId);
  if (!p) return;
  pending.delete(data.reqId);
  switch (data.type) {
    case "fabric_result":
      if (p.kind === "resolve") p.resolve(data.zones ?? []);
      break;
    case "fabric_error":
      p.reject(new Error(data.message || "fabric error"));
      break;
    case "fabric_publish_result":
      if (p.kind === "publish") p.resolve();
      break;
    case "fabric_publish_error":
      p.reject(new Error(data.message || "fabric publish error"));
      break;
    case "fabric_trust_result":
      if (p.kind === "trust") p.resolve();
      break;
    case "fabric_trust_error":
      p.reject(new Error(data.message || "fabric trust error"));
      break;
    case "fabric_badges_result":
      if (p.kind === "badges") p.resolve(data.badges);
      break;
    case "fabric_badges_error":
      p.reject(new Error(data.message || "fabric badges error"));
      break;
    case "fabric_trusted_result":
      if (p.kind === "trusted") {
        p.resolve({
          trusted: data.trusted ?? null,
          observed: data.observed ?? null,
          semiTrusted: data.semiTrusted ?? null,
        });
      }
      break;
    case "fabric_trusted_error":
      p.reject(new Error(data.message || "fabric trusted error"));
      break;
  }
});

/**
 * Hint the worker to start loading the Fabric WASM in the background.
 * Called early during sign-in so the 2.8MB download is warm by the
 * time any resolve is needed. Idempotent: subsequent calls are no-ops
 * inside the worker (the loading promise is cached).
 */
export function preloadFabric(): void {
  ensureWorker().postMessage({ type: "fabric_preload" });
}

/**
 * Batch-resolve a list of handles. Returns an array of zones
 * (pre-serialized as `{handle, json}`). Handles that Fabric couldn't
 * resolve are simply absent from the result; callers match by handle.
 */
export function resolveHandles(handles: string[]): Promise<ResolvedZone[]> {
  const reqId = `f${++reqSeq}`;
  return new Promise((resolve, reject) => {
    pending.set(reqId, { kind: "resolve", resolve, reject });
    ensureWorker().postMessage({ type: "fabric_resolve_all", reqId, handles });
    // 30s timeout so a stuck WASM load or flaky network doesn't leak
    // pending entries forever.
    window.setTimeout(() => {
      if (pending.delete(reqId)) reject(new Error("fabric resolve timeout"));
    }, 30_000);
  });
}

/**
 * Publish a zone to Fabric relays. Builds + signs + broadcasts via the
 * shared-worker Fabric instance.
 *
 * @param opts.cert       Raw .spacecert bytes (decoded from the faucet's base64)
 * @param opts.records    JSON record array, e.g.
 *                        `[{type:'seq',version:0}, {type:'addr',key:'nostr',value:[npub]}]`
 * @param opts.secretKey  64-char hex string (or 32-byte Uint8Array) - the
 *                        BIP-340 key that controls the handle.
 */
export function publishZone(opts: {
  cert: Uint8Array;
  records: any[];
  secretKey: string | Uint8Array;
}): Promise<void> {
  const reqId = `fp${++reqSeq}`;
  return new Promise<void>((resolve, reject) => {
    pending.set(reqId, { kind: "publish", resolve, reject });
    ensureWorker().postMessage({
      type: "fabric_publish",
      reqId,
      cert: opts.cert,
      records: opts.records,
      secretKey: opts.secretKey,
    });
    // 45s ceiling - Fabric publish hits several relays; slower than
    // resolve but still needs a floor to avoid stuck pending entries.
    window.setTimeout(() => {
      if (pending.delete(reqId)) reject(new Error("fabric publish timeout"));
    }, 45_000);
  });
}

/**
 * Pin a trust anchor ID. Fabric fetches anchors matching the id and
 * uses them to verify handle resolutions. Idempotent; calling with a
 * different id replaces the previously pinned one.
 *
 * Called from the TrustAnchor UI when the user clicks "Trust", and
 * re-called on every app startup to rehydrate the worker's Fabric
 * with the user's persisted trust anchor.
 */
export function setTrust(trustId: string): Promise<void> {
  const reqId = `ft${++reqSeq}`;
  return new Promise<void>((resolve, reject) => {
    pending.set(reqId, { kind: "trust", resolve, reject });
    ensureWorker().postMessage({ type: "fabric_trust", reqId, trustId });
    window.setTimeout(() => {
      if (pending.delete(reqId)) reject(new Error("fabric trust timeout"));
    }, 20_000);
  });
}

/**
 * Pin a SEMI-trusted anchor ID. Same wire-shape as setTrust but writes
 * to fabric's `semi_trusted` slot - so the default Spaces anchor (set
 * on app boot) can't accidentally upgrade a sovereign handle to the
 * full "orange check". Idempotent; replaces any prior semi-trusted id.
 *
 * Worker side calls `fabric.semiTrust(...)`, which fetches anchors
 * matching the id over Fabric's relay pool and computes a trust set.
 */
export function setSemiTrust(trustId: string): Promise<void> {
  const reqId = `fts${++reqSeq}`;
  return new Promise<void>((resolve, reject) => {
    pending.set(reqId, { kind: "trust", resolve, reject });
    ensureWorker().postMessage({ type: "fabric_semi_trust", reqId, trustId });
    window.setTimeout(() => {
      if (pending.delete(reqId)) reject(new Error("fabric semi-trust timeout"));
    }, 20_000);
  });
}

/**
 * Read fabric's currently-pinned trusted anchor (and its sibling pools)
 * from the worker's live state. Replaces the prior pattern of mirroring
 * the trusted hash into localStorage on the main thread - fabric now
 * persists its own state, so the worker is the single source of truth.
 * Returns `{trusted, observed, semiTrusted}` - all three may be null
 * when no anchors are loaded.
 */
export function getTrustedId(): Promise<TrustedSnapshot> {
  const reqId = `fgt${++reqSeq}`;
  return new Promise<TrustedSnapshot>((resolve, reject) => {
    pending.set(reqId, { kind: "trusted", resolve, reject });
    ensureWorker().postMessage({ type: "fabric_get_trusted", reqId });
    window.setTimeout(() => {
      if (pending.delete(reqId)) reject(new Error("fabric getTrusted timeout"));
    }, 10_000);
  });
}

/** Drop the currently-pinned trusted anchor from Fabric. */
export function clearTrust(): Promise<void> {
  const reqId = `ft${++reqSeq}`;
  return new Promise<void>((resolve, reject) => {
    pending.set(reqId, { kind: "trust", resolve, reject });
    ensureWorker().postMessage({ type: "fabric_clear_trusted", reqId });
    window.setTimeout(() => {
      if (pending.delete(reqId)) reject(new Error("fabric clearTrust timeout"));
    }, 10_000);
  });
}

/**
 * Batch-compute verification badges for a set of handles. The worker
 * looks up each handle's zone (from its in-memory cache, or fabric's
 * own cache on miss) and calls `fabric.badge(zone)` per 0.2's API.
 * Always reflects the CURRENT trust-anchor state - `badge()` is a
 * pure function over fabric's live trust pools, so nothing stale.
 */
export function getBadges(handles: string[]): Promise<Badge[]> {
  if (handles.length === 0) return Promise.resolve([]);
  const reqId = `fb${++reqSeq}`;
  return new Promise<Badge[]>((resolve, reject) => {
    pending.set(reqId, { kind: "badges", resolve, reject });
    ensureWorker().postMessage({ type: "fabric_badges_for", reqId, handles });
    window.setTimeout(() => {
      if (pending.delete(reqId)) reject(new Error("fabric badges timeout"));
    }, 10_000);
  });
}

/**
 * Convenience - resolve a single handle and return its nostr-addr npub
 * if any. Returns null when the handle isn't registered, has no record,
 * or the record value isn't a valid npub.
 */
export async function resolveNostrAddr(handle: string): Promise<string | null> {
  const zones = await resolveHandles([handle]);
  const zone = zones.find((z) => z.handle.toLowerCase() === handle.toLowerCase());
  if (!zone) return null;
  const records = zone.json?.records;
  if (!Array.isArray(records)) return null;
  for (const rec of records) {
    if (rec.type === "addr" && rec.key === "nostr") {
      const values = rec.value ?? rec.values;
      const npub = Array.isArray(values) ? values[0] : values;
      if (npub && typeof npub === "string" && npub.startsWith("npub1")) return npub;
    }
  }
  return null;
}
