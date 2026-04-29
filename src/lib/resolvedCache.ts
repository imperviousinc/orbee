/**
 * Per-handle cache of Fabric resolve results.
 *
 * Stores only `{handle, json, fetchedAt}` - Fabric 0.2's `badge(zone)`
 * is computed in the worker against the live zone object, so we no
 * longer persist sovereignty/roots alongside each cached entry. The
 * json is still kept for the main-thread's record-parsing (finding
 * the nostr addr, etc.) without requiring a Fabric round-trip.
 *
 * Cache invalidation is EVENT-DRIVEN, not time-driven:
 *   - `invalidateIfOlderThan(handle, 5h)` is called when a live kind:9
 *     message arrives post-EOSE. Active posters get re-verified every
 *     ~5h; quiet accounts stay cached indefinitely.
 *   - `invalidateHandle(handle)` is called by the user's own publishZone
 *     (fresh record) and by the ProfileView "re-verify" button.
 *
 * Badge is NEVER cached - it's a pure function of live trust state
 * and is re-computed on every verify flush.
 */

export interface CachedResolved {
  /** Primary key - normalized lowercase full handle, e.g. "alice.genesis@key". */
  handle: string;
  /** Pre-serialized zone content (same shape as ResolvedZone.json today). */
  json: any;
  /** ms epoch - only consulted by `invalidateIfOlderThan`. */
  fetchedAt: number;
}

// v3 - bumped after the fabric@0.2.0 ↔ libveritas@0.2.0 mismatch
// poisoned caches with zones whose toJson() threw silently or returned
// shells without records. Old v1/v2 entries are abandoned and harmless
// dead IDB until the user clears storage.
const DB_NAME = "orbee-fabric-cache-v3";
const DB_VERSION = 1;
const STORE = "resolved";

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "handle" });
      }
    };
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => { db.close(); dbPromise = null; };
      resolve(db);
    };
    req.onerror = () => { dbPromise = null; reject(req.error); };
  });
  return dbPromise;
}

const norm = (h: string) => h.toLowerCase();

/** Batch read. Returns a map keyed by normalized handle - only entries
 *  that exist. Missing handles simply aren't in the map. */
export async function getManyResolved(handles: string[]): Promise<Map<string, CachedResolved>> {
  const out = new Map<string, CachedResolved>();
  if (handles.length === 0) return out;
  try {
    const db = await openDb();
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE, "readonly");
      const store = tx.objectStore(STORE);
      let remaining = handles.length;
      for (const h of handles) {
        const req = store.get(norm(h));
        req.onsuccess = () => {
          const entry = req.result as CachedResolved | undefined;
          if (entry) out.set(norm(h), entry);
          if (--remaining === 0) resolve();
        };
        req.onerror = () => { if (--remaining === 0) resolve(); };
      }
    });
  } catch { /* fall through with partial */ }
  return out;
}

/** Single read. */
export async function getResolved(handle: string): Promise<CachedResolved | null> {
  const many = await getManyResolved([handle]);
  return many.get(norm(handle)) ?? null;
}

/** Write one entry. Silently swallows IDB errors - this is a cache, not
 *  a source of truth. */
export async function putResolved(entry: CachedResolved): Promise<void> {
  return putManyResolved([entry]);
}

/** Batch write. */
export async function putManyResolved(entries: CachedResolved[]): Promise<void> {
  if (entries.length === 0) return;
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      const store = tx.objectStore(STORE);
      for (const e of entries) {
        store.put({ ...e, handle: norm(e.handle) });
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (e) {
    console.warn("[resolvedCache] putMany failed:", e);
  }
}

/** Unconditional removal. Used by publishZone (own record changed) and
 *  the ProfileView re-verify button. */
export async function invalidateHandle(handle: string): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      const req = tx.objectStore(STORE).delete(norm(handle));
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } catch (e) {
    console.warn("[resolvedCache] invalidateHandle failed:", e);
  }
}

/** Conditional removal - called on every live kind:9 event from the
 *  same pubkey. Returns true if the entry was removed (stale) so the
 *  caller knows to requeue verification; false if it was kept. */
export async function invalidateIfOlderThan(handle: string, maxAgeMs: number): Promise<boolean> {
  try {
    const entry = await getResolved(handle);
    if (!entry) return false;
    if (Date.now() - entry.fetchedAt <= maxAgeMs) return false;
    await invalidateHandle(handle);
    return true;
  } catch {
    return false;
  }
}
