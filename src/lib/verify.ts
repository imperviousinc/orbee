/**
 * Handle verification via Fabric.
 *
 * Two concerns, tracked separately per pubkey:
 *
 *   1. **Match status** - does the handle in this pubkey's kind:0 profile
 *      actually list this pubkey as its nostr addr? Pure application
 *      logic; stable across trust-anchor changes.
 *
 *   2. **Badge** - Fabric's own take on the zone's trust level, derived
 *      from (sovereignty × trust-anchor pools). Live - recomputed on
 *      every batch flush because `observed()` shifts with peer gossip.
 *      One of "orange" (sovereign + trusted) / "unverified" (observed
 *      but not trusted) / "none" / null (not applicable).
 *
 * Flow per batch:
 *   - Split incoming handles into cache hits vs misses
 *   - Resolve the misses via `fabric.resolveAll()`
 *   - Persist fresh entries into the resolvedCache
 *   - Union (cache + fresh), batch-compute badges in one worker RPC
 *   - Set verifyState per pubkey
 *
 * Invalidation:
 *   - `onLiveMessage(pubkey, handle)` - Feed calls this on every post-EOSE
 *     kind:9 event; invalidates the cached zone if older than 5h.
 *   - `forceReVerify(pubkey, handle)` - ProfileView "re-verify" button.
 *   - publishZone success - clears own cached handle (handled in caller).
 */

import { createStore } from "solid-js/store";
import { resolveHandles, getBadges, type Badge } from "./fabric";
import { decodeNpub } from "./keys";
import { identityParts, type IdentityParts } from "./profiles";
import { truncateNpub, truncateNpubParts } from "./keys";
import {
  getManyResolved,
  putManyResolved,
  invalidateHandle,
  invalidateIfOlderThan,
  type CachedResolved,
} from "./resolvedCache";

export type MatchStatus =
  | "pending"     // queued, waiting to be resolved
  | "verified"    // handle resolved and npub matches pubkey
  | "no_handle"   // kind 0 has no handle property
  | "failed"      // resolve failed or npub mismatch
  | "no_record";  // handle exists but no nostr addr record

export interface VerifyRecord {
  match: MatchStatus;
  badge: Badge | null;
  /** The handle we verified - keeps the Feed's live-message
   *  invalidation path from needing to look it up again. */
  handle?: string;
}

const [verifyState, setVerifyState] = createStore<Record<string, VerifyRecord>>({});
export { verifyState };

/** Cache freshness window for the "kind:9 triggers re-verify" path. */
const LIVE_INVALIDATE_MS = 5 * 60 * 60 * 1000; // 5h

export function getVerifyRecord(pubkey: string): VerifyRecord | undefined {
  return verifyState[pubkey];
}

/** Kept for backwards compatibility - reports whether the pubkey's
 *  claimed handle actually resolves to them. Doesn't consider the
 *  Fabric badge (callers that need the badge read `verifyState[pk].badge`). */
export function isVerified(pubkey: string): boolean {
  return verifyState[pubkey]?.match === "verified";
}

/**
 * The inline display-state for a pubkey. Collapses (match × badge) into
 * one of three rendering decisions used by MessageRow / members / etc.
 *
 *   "orange"  → sovereign handle pinned to a trusted anchor → check icon
 *   "unverified" → claimed handle cannot be trusted → hide it, show npub
 *   "plain"   → no handle claimed, or pending; show whatever identityParts
 *               produces normally (handle-if-present, npub-otherwise)
 */
export type DisplayState = "plain" | "orange" | "unverified";

export function displayStateFor(pubkey: string): DisplayState {
  // No profile / kind:0 yet → treat as plain npub. The handle check runs
  // against the claimed handle in the kind:0 profile; without one there's
  // nothing to unverify.
  const rec = verifyState[pubkey];
  if (!rec) return "plain";
  // Still waiting on the network - don't misrepresent the user as
  // unverified before we've actually checked.
  if (rec.match === "pending") return "plain";
  // Mismatch (npub doesn't own the claimed handle) OR badge says
  // unverified → treat as unverified.
  if (rec.match !== "verified") return "unverified";
  if (rec.badge === "orange") return "orange";
  if (rec.badge === "unverified") return "unverified";
  return "plain";
}

/**
 * Identity for inline rendering, verify-gated. When the pubkey's display
 * state is "unverified", the claimed handle is suppressed and we fall
 * back to the npub. The `secondary` (kind:0 display-name) is preserved
 * either way - display_name is a self-label, not a Spaces claim, so
 * it's fine to show next to an npub.
 *
 * Use this anywhere a user's identity is rendered inline (message
 * author, member row, reply quote). For the full profile card / page,
 * keep using `identityParts` + surface the unverified state explicitly.
 */
export function identityPartsVerified(pubkey: string): IdentityParts {
  const base = identityParts(pubkey);
  if (!base.hasHandle) return base;
  if (displayStateFor(pubkey) !== "unverified") return base;
  return {
    primary: truncateNpub(pubkey),
    npubParts: truncateNpubParts(pubkey),
    secondary: base.secondary,
    hasHandle: false,
  };
}

// ── Batch queue ──

const BATCH_SIZE = 5;
const BATCH_DELAY = 300;

/** Pending verifications: handle → list of pubkeys claiming that handle.
 *  Dedupes across callers so two components each requesting the same
 *  handle only trigger one network round-trip. */
const pendingHandles = new Map<string, string[]>();
let batchTimer: number | null = null;

/**
 * Request verification for a pubkey. If `handle` is undefined/empty,
 * marks as no_handle. Otherwise queues for the next batch.
 *
 * Idempotent - duplicate requests for an already-verified pubkey
 * no-op. To force a fresh check, call `forceReVerify`.
 */
export function requestVerification(pubkey: string, handle?: string) {
  if (verifyState[pubkey]) return;

  console.log("[verify/req]", { pk: pubkey.slice(0, 8), handle });

  if (!handle) {
    setVerifyState(pubkey, { match: "no_handle", badge: null });
    return;
  }

  setVerifyState(pubkey, { match: "pending", badge: null, handle });

  const existing = pendingHandles.get(handle);
  if (existing) {
    if (!existing.includes(pubkey)) existing.push(pubkey);
  } else {
    pendingHandles.set(handle, [pubkey]);
  }

  scheduleBatch();
}

/**
 * Called from Feed on every post-EOSE kind:9 event. If the author's
 * cached zone is older than 5h, drop it and requeue a fresh verify.
 * Active posters get re-verified every ~5h; quiet accounts stay
 * cached indefinitely.
 */
export async function onLiveMessage(pubkey: string, handle?: string) {
  if (!handle) return;
  const invalidated = await invalidateIfOlderThan(handle, LIVE_INVALIDATE_MS);
  if (!invalidated) return;
  // Drop our state record so requestVerification will re-queue.
  setVerifyState(pubkey, undefined as any);
  requestVerification(pubkey, handle);
}

/** Force-clear the cached zone for a pubkey+handle and re-run verify.
 *  Wired to the "re-verify" button in ProfileView. */
export async function forceReVerify(pubkey: string, handle?: string) {
  if (handle) await invalidateHandle(handle);
  setVerifyState(pubkey, undefined as any);
  requestVerification(pubkey, handle);
}

/**
 * Re-compute badges for every pubkey currently in verifyState, against
 * the live Fabric trust pools. Call after `setTrust` / `clearTrust` -
 * the zones themselves didn't change (no re-resolve needed), only the
 * trust anchor set that badgeFor evaluates against. Keeps existing
 * match status untouched.
 */
export async function rebadgeAll() {
  const entries: Array<{ pubkey: string; rec: VerifyRecord }> = [];
  for (const pubkey in verifyState) {
    const rec = verifyState[pubkey];
    if (!rec || !rec.handle) continue;
    entries.push({ pubkey, rec });
  }
  if (entries.length === 0) return;

  const handles = [...new Set(entries.map((e) => e.rec.handle!))];

  // Fabric 0.2: pass handles directly - the worker looks up zones
  // from its cache (or re-resolves from fabric's internal cache on
  // miss) and calls badge(zone) per handle.
  let badges: Badge[] = [];
  try {
    badges = await getBadges(handles);
  } catch (e) {
    console.warn("[verify] rebadgeAll failed:", e);
    return;
  }

  const badgeByHandle = new Map<string, Badge>();
  handles.forEach((h, i) => badgeByHandle.set(h.toLowerCase(), badges[i] ?? "none"));

  // Apply new badges to every affected pubkey.
  for (const { pubkey, rec } of entries) {
    const newBadge = badgeByHandle.get(rec.handle!.toLowerCase());
    if (newBadge === undefined) continue;
    if (rec.badge === newBadge) continue;
    setVerifyState(pubkey, "badge", newBadge);
  }
}

function scheduleBatch() {
  if (batchTimer) return;
  batchTimer = window.setTimeout(flushBatch, BATCH_DELAY);
}

async function flushBatch() {
  batchTimer = null;
  if (pendingHandles.size === 0) return;

  // Take up to BATCH_SIZE handles for this flush; reschedule if there's more.
  const batch: [string, string[]][] = [];
  for (const entry of pendingHandles) {
    batch.push(entry);
    if (batch.length >= BATCH_SIZE) break;
  }
  for (const [handle] of batch) pendingHandles.delete(handle);
  if (pendingHandles.size > 0) scheduleBatch();

  const handles = batch.map(([h]) => h);

  // 1. Read cache (json only - no more sovereignty/roots per 0.2).
  const cached = await getManyResolved(handles);

  // 2. Resolve misses via Fabric.
  const missing = handles.filter((h) => !cached.has(h.toLowerCase()));
  console.log("[verify/flush]", {
    handles,
    cachedHits: handles.length - missing.length,
    missing,
    cachedSample: cached.size > 0
      ? { handle: [...cached.keys()][0], jsonKeys: Object.keys([...cached.values()][0].json || {}), records: ([...cached.values()][0].json?.records || []).length }
      : null,
  });
  if (missing.length > 0) {
    try {
      // Fabric 0.2: resolveHandles returns the zones array directly.
      const zones = await resolveHandles(missing);
      const now = Date.now();
      const fresh: CachedResolved[] = zones.map((z) => ({
        handle: z.handle,
        json: z.json,
        fetchedAt: now,
      }));
      await putManyResolved(fresh);
      for (const entry of fresh) cached.set(entry.handle.toLowerCase(), entry);
      // Handles Fabric didn't return are silently missing - they'll
      // fall through to the "failed" path below.
    } catch (e) {
      console.error("[verify] batch resolve failed:", e);
      // Leave pubkeys in "pending" - next requestVerification will retry.
      for (const [, pubkeys] of batch) {
        for (const pk of pubkeys) {
          if (verifyState[pk]?.match === "pending") {
            setVerifyState(pk, "match", "failed");
          }
        }
      }
      return;
    }
  }

  // 3. Batch badges for every handle we've seen. The worker's zone cache
  //    was populated by the resolveHandles call above; for handles that
  //    came straight from our main-thread cache (no fresh resolve), the
  //    worker re-resolves on demand (hits fabric's own cache - fast).
  const handlesWithZone = handles.filter((h) => cached.has(h.toLowerCase()));
  let badges: Badge[] = [];
  if (handlesWithZone.length > 0) {
    try {
      badges = await getBadges(handlesWithZone);
    } catch (e) {
      console.warn("[verify] badges failed:", e);
      badges = handlesWithZone.map(() => "none" as Badge);
    }
  }
  const badgeByHandle = new Map<string, Badge>();
  handlesWithZone.forEach((h, i) => badgeByHandle.set(h.toLowerCase(), badges[i] ?? "none"));

  // 4. Decide match + badge per pubkey.
  for (const [handle, pubkeys] of batch) {
    const entry = cached.get(handle.toLowerCase());
    const badge = badgeByHandle.get(handle.toLowerCase()) ?? null;

    if (!entry) {
      // Handle wasn't in cache AND didn't resolve - unregistered or network flake.
      for (const pk of pubkeys) setVerifyState(pk, { match: "failed", badge, handle });
      continue;
    }

    const records = entry.json?.records;
    let foundNpub: string | null = null;
    if (records && Array.isArray(records)) {
      for (const rec of records) {
        if (rec.type === "addr" && rec.key === "nostr") {
          const values = rec.value ?? rec.values;
          const npub = Array.isArray(values) ? values[0] : values;
          if (npub && typeof npub === "string" && npub.startsWith("npub1")) {
            foundNpub = npub;
          }
          break;
        }
      }
    }

    if (!foundNpub) {
      for (const pk of pubkeys) setVerifyState(pk, { match: "no_record", badge, handle });
      continue;
    }

    const npubHex = decodeNpub(foundNpub);
    for (const pk of pubkeys) {
      const match = npubHex && npubHex === pk ? "verified" : "failed";
      setVerifyState(pk, { match, badge, handle });
    }
  }
}
