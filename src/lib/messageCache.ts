/**
 * IndexedDB-backed message cache. Hydrates feed sync from cache on
 * station switch, then opens relay sub for anything newer than tip.
 * Keyed by `${stationKey}::${eventId}` with index on [stationKey, created_at].
 */

import type { NostrEvent } from "./keys";
import { stationKey, type StationRef } from "./stations";

// DB name (not version) bumped to side-step wedged upgrades from
// long-lived connections in other tabs blocking v1→v2 transition.
const DB_NAME = "orbee-cache-v2";
const DB_VERSION = 2;
const STORE = "messages";
const REACTIONS_STORE = "reactions";
const META_STORE = "stationMeta";
const RETENTION_MS = 60 * 24 * 60 * 60 * 1000;

interface CacheRow {
  /** `${stationKey}::${eventId}` */
  k: string;
  station: string;
  eventId: string;
  created_at: number;
  event: NostrEvent;
}

let dbPromise: Promise<IDBDatabase> | null = null;

// Fire-and-forget cleanup of abandoned v1 DB.
if (typeof indexedDB !== "undefined") {
  try {
    indexedDB.deleteDatabase("orbee-cache");
  } catch { /* ignored */ }
}

// Sync localStorage snapshot mirrors most-recent ~50 events + ~200
// reactions per station so feed renders same-frame as chrome. IDB
// still backfills full history; seen-set dedup in Feed makes the
// merge a no-op.

const RECENT_KEY = "orbee-recent-v1";
const RECENT_MSG_LIMIT = 50;
const RECENT_RXN_LIMIT = 200;

interface RecentSnapshot {
  msgs: NostrEvent[];
  rxns: NostrEvent[];
}

let recentMap: Record<string, RecentSnapshot> = (() => {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
})();

let recentSaveTimer: number | null = null;
function persistRecent() {
  if (recentSaveTimer !== null) return;
  recentSaveTimer = window.setTimeout(() => {
    recentSaveTimer = null;
    try {
      localStorage.setItem(RECENT_KEY, JSON.stringify(recentMap));
    } catch (e) {
      console.warn("[recent cache] save failed:", e);
    }
  }, 500);
}

function ensureBucket(sk: string): RecentSnapshot {
  if (!recentMap[sk]) recentMap[sk] = { msgs: [], rxns: [] };
  return recentMap[sk];
}

function trimAndSort(list: NostrEvent[], limit: number): NostrEvent[] {
  list.sort((a, b) => a.created_at - b.created_at);
  return list.length > limit ? list.slice(-limit) : list;
}

/** Sync read - seeds Feed events() before first render. */
export function getRecentMessages(station: StationRef): NostrEvent[] {
  return recentMap[stationKey(station)]?.msgs ?? [];
}

/** Sync read - hydrates Feed reactions store before render. */
export function getRecentReactions(station: StationRef): NostrEvent[] {
  return recentMap[stationKey(station)]?.rxns ?? [];
}

function eventBelongsToStation(event: NostrEvent, station: StationRef): boolean {
  const h = event.tags.find((t) => t[0] === "h")?.[1];
  if (h === station.id) return true;
  console.warn(
    `[cache-leak] refused to record event ${event.id.slice(0, 12)} ` +
    `with h="${h ?? "(none)"}" into station "${station.id}".`,
  );
  return false;
}

/** Idempotent. */
export function recordRecentMessage(station: StationRef, event: NostrEvent) {
  if (!eventBelongsToStation(event, station)) return;
  const sk = stationKey(station);
  const bucket = ensureBucket(sk);
  if (bucket.msgs.some((e) => e.id === event.id)) return;
  bucket.msgs.push(event);
  bucket.msgs = trimAndSort(bucket.msgs, RECENT_MSG_LIMIT);
  persistRecent();
}

export function recordRecentMessages(station: StationRef, events: NostrEvent[]) {
  if (events.length === 0) return;
  const sk = stationKey(station);
  const bucket = ensureBucket(sk);
  const seen = new Set(bucket.msgs.map((e) => e.id));
  let changed = false;
  for (const e of events) {
    if (!eventBelongsToStation(e, station)) continue;
    if (seen.has(e.id)) continue;
    bucket.msgs.push(e);
    changed = true;
  }
  if (!changed) return;
  bucket.msgs = trimAndSort(bucket.msgs, RECENT_MSG_LIMIT);
  persistRecent();
}

export function recordRecentReaction(station: StationRef, event: NostrEvent) {
  const sk = stationKey(station);
  const bucket = ensureBucket(sk);
  if (bucket.rxns.some((e) => e.id === event.id)) return;
  bucket.rxns.push(event);
  bucket.rxns = trimAndSort(bucket.rxns, RECENT_RXN_LIMIT);
  persistRecent();
}

export function recordRecentReactions(station: StationRef, events: NostrEvent[]) {
  if (events.length === 0) return;
  const sk = stationKey(station);
  const bucket = ensureBucket(sk);
  const seen = new Set(bucket.rxns.map((e) => e.id));
  let changed = false;
  for (const e of events) {
    if (seen.has(e.id)) continue;
    bucket.rxns.push(e);
    changed = true;
  }
  if (!changed) return;
  bucket.rxns = trimAndSort(bucket.rxns, RECENT_RXN_LIMIT);
  persistRecent();
}

// Persisted virtualizer row heights keyed by group key (= first event
// id) so TanStack Virtual can seed estimateSize on first frame without
// the measure-then-resize round-trip.
// v2 bump: bubble widths changed (rail 60→40px) so v1 heights mismatch.
const HEIGHT_KEY = "orbee-row-heights-v2";
const HEIGHT_LIMIT = 5000;

let heightCache: Record<string, number> = (() => {
  try {
    const raw = localStorage.getItem(HEIGHT_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
})();

let heightSaveTimer: number | null = null;
function persistHeights() {
  if (heightSaveTimer !== null) return;
  heightSaveTimer = window.setTimeout(() => {
    heightSaveTimer = null;
    try {
      const entries = Object.entries(heightCache);
      if (entries.length > HEIGHT_LIMIT) {
        // Object.entries preserves insertion order; last set wins.
        heightCache = Object.fromEntries(entries.slice(-HEIGHT_LIMIT));
      }
      localStorage.setItem(HEIGHT_KEY, JSON.stringify(heightCache));
    } catch (e) {
      console.warn("[height cache] save failed:", e);
    }
  }, 1000);
}

export function getRowHeight(key: string): number | undefined {
  return heightCache[key];
}


export function recordRowHeight(key: string, height: number) {
  if (height <= 0) return;
  const h = Math.round(height);
  if (heightCache[key] === h) return;
  heightCache[key] = h;
  persistHeights();
}

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: "k" });
        store.createIndex("by_station_time", ["station", "created_at"]);
      }
      if (!db.objectStoreNames.contains(REACTIONS_STORE)) {
        const r = db.createObjectStore(REACTIONS_STORE, { keyPath: "k" });
        r.createIndex("by_station_time", ["station", "created_at"]);
      }
      if (!db.objectStoreNames.contains(META_STORE)) {
        // Replaceable metadata: one row per (station, kind), keyed
        // `${stationKey}::${kind}`, indexed by relay.
        const m = db.createObjectStore(META_STORE, { keyPath: "k" });
        m.createIndex("by_relay", "relay");
      }
    };
    req.onsuccess = () => {
      const db = req.result;
      // Close on versionchange so future upgrades aren't blocked.
      db.onversionchange = () => {
        db.close();
        dbPromise = null;
      };
      resolve(db);
    };
    req.onerror = () => reject(req.error);
    req.onblocked = () => {
      console.warn(
        "[messageCache] IDB upgrade blocked - close other Orbee tabs to continue.",
      );
    };
  });
  return dbPromise;
}

function tx(db: IDBDatabase, mode: IDBTransactionMode, store = STORE): IDBObjectStore {
  return db.transaction(store, mode).objectStore(store);
}

/**
 * Range-load events oldest-first within window. `since`/`until` are
 * unix-second (inclusive lower, exclusive upper) - matches Nostr filter semantics.
 */
export async function loadCachedMessages(
  station: StationRef,
  opts: { since?: number; until?: number; limit?: number } = {},
): Promise<NostrEvent[]> {
  const db = await openDb();
  const sk = stationKey(station);
  const lower = opts.since ?? 0;
  const upper = opts.until ?? Number.MAX_SAFE_INTEGER;
  const range = IDBKeyRange.bound(
    [sk, lower],
    [sk, upper],
    false,
    true,
  );
  const limit = opts.limit ?? Infinity;

  return new Promise((resolve, reject) => {
    const out: NostrEvent[] = [];
    // Newest-first cursor so limit cuts oldest first; reversed before return.
    const req = tx(db, "readonly").index("by_station_time").openCursor(range, "prev");
    req.onsuccess = () => {
      const cursor = req.result;
      if (!cursor || out.length >= limit) {
        resolve(out.reverse());
        return;
      }
      out.push((cursor.value as CacheRow).event);
      cursor.continue();
    };
    req.onerror = () => reject(req.error);
  });
}

/** Append events. Dedupes by (station, eventId) via PK collision. */
export async function saveCachedMessages(
  station: StationRef,
  events: NostrEvent[],
): Promise<void> {
  if (events.length === 0) return;
  // Defense in depth: drop wrong-`h` events before write so a poisoned
  // cache can't resurface them on every hydration.
  const safe = events.filter((e) => {
    const h = e.tags.find((t) => t[0] === "h")?.[1];
    if (h === station.id) return true;
    console.warn(
      `[cache-leak] refused to save event ${e.id.slice(0, 12)} ` +
      `with h="${h ?? "(none)"}" into station "${station.id}".`,
    );
    return false;
  });
  if (safe.length === 0) return;
  const db = await openDb();
  const sk = stationKey(station);
  const store = tx(db, "readwrite");
  for (const e of safe) {
    const row: CacheRow = {
      k: `${sk}::${e.id}`,
      station: sk,
      eventId: e.id,
      created_at: e.created_at,
      event: e,
    };
    store.put(row);
  }
  return new Promise((resolve, reject) => {
    store.transaction.oncomplete = () => resolve();
    store.transaction.onerror = () => reject(store.transaction.error);
  });
}

export async function newestCachedTs(station: StationRef): Promise<number | null> {
  const db = await openDb();
  const sk = stationKey(station);
  const range = IDBKeyRange.bound([sk, 0], [sk, Number.MAX_SAFE_INTEGER]);
  return new Promise((resolve, reject) => {
    const req = tx(db, "readonly")
      .index("by_station_time")
      .openCursor(range, "prev");
    req.onsuccess = () => {
      const cursor = req.result;
      resolve(cursor ? (cursor.value as CacheRow).created_at : null);
    };
    req.onerror = () => reject(req.error);
  });
}

/** Used as `until` floor for pagination. */
export async function oldestCachedTs(station: StationRef): Promise<number | null> {
  const db = await openDb();
  const sk = stationKey(station);
  const range = IDBKeyRange.bound([sk, 0], [sk, Number.MAX_SAFE_INTEGER]);
  return new Promise((resolve, reject) => {
    const req = tx(db, "readonly")
      .index("by_station_time")
      .openCursor(range, "next");
    req.onsuccess = () => {
      const cursor = req.result;
      resolve(cursor ? (cursor.value as CacheRow).created_at : null);
    };
    req.onerror = () => reject(req.error);
  });
}

export async function pruneOldMessages(station: StationRef): Promise<void> {
  const db = await openDb();
  const sk = stationKey(station);
  const cutoffSec = Math.floor((Date.now() - RETENTION_MS) / 1000);
  const range = IDBKeyRange.bound([sk, 0], [sk, cutoffSec], false, true);
  return new Promise((resolve, reject) => {
    const store = tx(db, "readwrite");
    const req = store.index("by_station_time").openCursor(range);
    req.onsuccess = () => {
      const cursor = req.result;
      if (!cursor) {
        resolve();
        return;
      }
      cursor.delete();
      cursor.continue();
    };
    req.onerror = () => reject(req.error);
  });
}

/** Removes from BOTH IDB and sync snapshot. Snapshot first so a refresh
 *  right after delete won't resurrect the row from localStorage. */
export async function removeCachedMessage(
  station: StationRef,
  eventId: string,
): Promise<void> {
  const sk = stationKey(station);
  const bucket = recentMap[sk];
  if (bucket) {
    bucket.msgs = bucket.msgs.filter((e) => e.id !== eventId);
    persistRecent();
  }
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const store = tx(db, "readwrite");
    const req = store.delete(`${sk}::${eventId}`);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

export async function clearStationCache(station: StationRef): Promise<void> {
  const db = await openDb();
  const sk = stationKey(station);
  const range = IDBKeyRange.bound([sk, 0], [sk, Number.MAX_SAFE_INTEGER]);
  return new Promise((resolve, reject) => {
    const store = tx(db, "readwrite");
    const req = store.index("by_station_time").openCursor(range);
    req.onsuccess = () => {
      const cursor = req.result;
      if (!cursor) {
        resolve();
        return;
      }
      cursor.delete();
      cursor.continue();
    };
    req.onerror = () => reject(req.error);
  });
}

/** Clear sync snapshot bucket on leave so hydration doesn't resurrect
 *  messages for a station the user no longer belongs to. */
export function clearStationRecentSnapshot(station: StationRef): void {
  const sk = stationKey(station);
  if (!recentMap[sk]) return;
  delete recentMap[sk];
  persistRecent();
}

// kind:7 reactions (NIP-25) cache.

export async function loadCachedReactions(
  station: StationRef,
  opts: { since?: number; until?: number; limit?: number } = {},
): Promise<NostrEvent[]> {
  const db = await openDb();
  const sk = stationKey(station);
  const lower = opts.since ?? 0;
  const upper = opts.until ?? Number.MAX_SAFE_INTEGER;
  const range = IDBKeyRange.bound([sk, lower], [sk, upper], false, true);
  const limit = opts.limit ?? Infinity;

  return new Promise((resolve, reject) => {
    const out: NostrEvent[] = [];
    const req = tx(db, "readonly", REACTIONS_STORE)
      .index("by_station_time")
      .openCursor(range, "prev");
    req.onsuccess = () => {
      const cursor = req.result;
      if (!cursor || out.length >= limit) {
        resolve(out);
        return;
      }
      out.push((cursor.value as CacheRow).event);
      cursor.continue();
    };
    req.onerror = () => reject(req.error);
  });
}

export async function saveCachedReactions(
  station: StationRef,
  events: NostrEvent[],
): Promise<void> {
  if (events.length === 0) return;
  const db = await openDb();
  const sk = stationKey(station);
  const store = tx(db, "readwrite", REACTIONS_STORE);
  for (const e of events) {
    const row: CacheRow = {
      k: `${sk}::${e.id}`,
      station: sk,
      eventId: e.id,
      created_at: e.created_at,
      event: e,
    };
    store.put(row);
  }
  return new Promise((resolve, reject) => {
    store.transaction.oncomplete = () => resolve();
    store.transaction.onerror = () => reject(store.transaction.error);
  });
}

// NIP-29 replaceable station metadata (kinds 39000–39003).

interface MetaRow {
  /** `${stationKey}::${kind}` */
  k: string;
  relay: string;
  station: string;
  kind: number;
  event: NostrEvent;
}

export async function loadCachedStationMeta(
  relayUrl: string,
): Promise<NostrEvent[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const out: NostrEvent[] = [];
    const req = tx(db, "readonly", META_STORE)
      .index("by_relay")
      .openCursor(IDBKeyRange.only(relayUrl));
    req.onsuccess = () => {
      const cursor = req.result;
      if (!cursor) {
        resolve(out);
        return;
      }
      out.push((cursor.value as MetaRow).event);
      cursor.continue();
    };
    req.onerror = () => reject(req.error);
  });
}

export async function saveCachedStationMeta(
  station: StationRef,
  event: NostrEvent,
): Promise<void> {
  const db = await openDb();
  const sk = stationKey(station);
  const row: MetaRow = {
    k: `${sk}::${event.kind}`,
    relay: station.relay,
    station: sk,
    kind: event.kind,
    event,
  };
  const store = tx(db, "readwrite", META_STORE);
  store.put(row);
  return new Promise((resolve, reject) => {
    store.transaction.oncomplete = () => resolve();
    store.transaction.onerror = () => reject(store.transaction.error);
  });
}

export async function pruneOldReactions(station: StationRef): Promise<void> {
  const db = await openDb();
  const sk = stationKey(station);
  const cutoffSec = Math.floor((Date.now() - RETENTION_MS) / 1000);
  const range = IDBKeyRange.bound([sk, 0], [sk, cutoffSec], false, true);
  return new Promise((resolve, reject) => {
    const store = tx(db, "readwrite", REACTIONS_STORE);
    const req = store.index("by_station_time").openCursor(range);
    req.onsuccess = () => {
      const cursor = req.result;
      if (!cursor) {
        resolve();
        return;
      }
      cursor.delete();
      cursor.continue();
    };
    req.onerror = () => reject(req.error);
  });
}

export async function clearStationReactions(station: StationRef): Promise<void> {
  const db = await openDb();
  const sk = stationKey(station);
  const range = IDBKeyRange.bound([sk, 0], [sk, Number.MAX_SAFE_INTEGER]);
  return new Promise((resolve, reject) => {
    const store = tx(db, "readwrite", REACTIONS_STORE);
    const req = store.index("by_station_time").openCursor(range);
    req.onsuccess = () => {
      const cursor = req.result;
      if (!cursor) {
        resolve();
        return;
      }
      cursor.delete();
      cursor.continue();
    };
    req.onerror = () => reject(req.error);
  });
}
