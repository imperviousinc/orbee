import { createStore } from "solid-js/store";
import { getRelay } from "./nostr";
import {
  loadStoredStations,
  stationKey,
  joinedStations,
  type StationRef,
} from "./stations";
import type { NostrEvent } from "./keys";

// Per-station activity: latest kind:9 + how many of those are unread for the
// current viewer. Drives the sidebar rows (snippet + badge).

export interface StationActivity {
  lastEvent?: NostrEvent;
  unreadCount: number;
}

export const [stationActivity, setStationActivity] =
  createStore<Record<string, StationActivity>>({});

// ── Read-state persistence ──────────────────────────────────────
//
// localStorage shape: { [stationKey]: lastReadCreatedAt }
// Anything strictly newer than lastReadCreatedAt counts as unread.
// Survives reloads so the badge doesn't reset every session.

const READS_KEY = "orbee-station-reads";

function loadReads(): Record<string, number> {
  try {
    const raw = localStorage.getItem(READS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function saveReads(reads: Record<string, number>) {
  localStorage.setItem(READS_KEY, JSON.stringify(reads));
}

let reads: Record<string, number> = loadReads();

// ── Last-activity persistence ───────────────────────────────────
//
// Cache the most-recent kind:9 event per station so the sidebar's
// recency sort (and the snippet preview) is stable across reloads.
// Without this the sidebar reshuffles for ~500ms after every refresh
// as live activity events stream in.

const ACTIVITY_KEY = "orbee-station-activity";

function loadActivityCache(): Record<string, NostrEvent> {
  try {
    const raw = localStorage.getItem(ACTIVITY_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

let activityCache: Record<string, NostrEvent> = loadActivityCache();
let activitySaveTimer: number | null = null;

function persistActivityCache() {
  if (activitySaveTimer !== null) return;
  activitySaveTimer = window.setTimeout(() => {
    activitySaveTimer = null;
    try {
      localStorage.setItem(ACTIVITY_KEY, JSON.stringify(activityCache));
    } catch (e) {
      console.warn("[activity cache] save failed:", e);
    }
  }, 250);
}

/** Hydrate the in-memory store from localStorage on boot. */
export function hydrateActivityFromCache() {
  for (const [k, event] of Object.entries(activityCache)) {
    setStationActivity(k, (prev) => ({
      lastEvent: event,
      unreadCount: prev?.unreadCount ?? 0,
    }));
  }
}

function isUnread(ref: StationRef, ts: number): boolean {
  return ts > (reads[stationKey(ref)] || 0);
}

/**
 * Mark a station as fully read up to its latest known message.
 * Called when the user activates a station (via App.tsx createEffect).
 */
export function markStationRead(ref: StationRef) {
  const k = stationKey(ref);
  const current = stationActivity[k];
  const latest = current?.lastEvent?.created_at || Math.floor(Date.now() / 1000);
  reads[k] = latest;
  saveReads(reads);
  setStationActivity(k, { ...current, unreadCount: 0 });
}

// ── Per-relay subscriptions ─────────────────────────────────────
//
// One sub per relay covers ALL the user's joined stations on that relay
// (filter `#h: [...ids]`). Re-emitted as `joinedStations` changes so a
// freshly minted/joined station starts being tracked immediately.

const activitySubs = new Map<string, string>();

export function subscribeStationActivity(relayUrl: string) {
  const ids = loadStoredStations()
    .filter((s) => s.relay === relayUrl)
    .map((s) => s.id);

  const prev = activitySubs.get(relayUrl);
  if (prev) getRelay(relayUrl).unsubscribe(prev);
  activitySubs.delete(relayUrl);
  if (ids.length === 0) return;

  const r = getRelay(relayUrl);
  // Limit caps the historical replay. We only need the most recent
  // message per station for the sidebar - keeping this small avoids
  // flooding the activity store with hundreds of events on boot, which
  // was triggering LeftSidebar re-renders and starving the Feed.
  const sub = r.subscribe(
    { kinds: [9], "#h": ids, limit: Math.max(20, ids.length * 3) },
    (event) => handleMessage(relayUrl, event),
  );
  activitySubs.set(relayUrl, sub);
}

function handleMessage(relayUrl: string, event: NostrEvent) {
  const h = event.tags.find((t) => t[0] === "h")?.[1];
  if (!h) return;
  const ref: StationRef = { id: h, relay: relayUrl };
  const k = stationKey(ref);

  const current = stationActivity[k];
  // History arrives out of order - only swap lastEvent if this one is newer.
  const isNewer = !current?.lastEvent || event.created_at > current.lastEvent.created_at;
  // The unread bump fires only on truly-unread events, so an old replay
  // that doesn't change either field is a no-op here too.
  const wouldBumpUnread = isUnread(ref, event.created_at);
  if (!isNewer && !wouldBumpUnread) return;

  const lastEvent = isNewer ? event : current?.lastEvent;
  // Count toward unread if it post-dates lastReadAt. App.tsx clears the
  // counter via markStationRead when the user actually views the station.
  const unreadCount =
    (current?.unreadCount || 0) + (wouldBumpUnread ? 1 : 0);
  setStationActivity(k, { lastEvent, unreadCount });

  // Persist newest event per station so the sidebar order survives reload.
  if (isNewer) {
    activityCache[k] = event;
    persistActivityCache();
  }
}

/** Open one activity sub per unique relay across the user's joined list. */
export function bootStationActivity() {
  const relays = new Set(joinedStations().map((s) => s.relay));
  for (const url of relays) {
    getRelay(url).connect();
    subscribeStationActivity(url);
  }
}

/** Lookup helper - returns a stable empty activity if the station has no data yet. */
export function getActivity(ref: StationRef): StationActivity {
  return stationActivity[stationKey(ref)] || { unreadCount: 0 };
}

/** Drop activity, reads, and cached last-event for a station. Used when
 *  the user leaves a station so its entry doesn't resurrect in the
 *  sidebar's recency sort on next reload. */
export function clearStationActivity(ref: StationRef) {
  const k = stationKey(ref);
  setStationActivity(k, undefined as any);
  delete activityCache[k];
  persistActivityCache();
  if (reads[k] !== undefined) {
    delete reads[k];
    saveReads(reads);
  }
}

/**
 * Joined stations sorted by most-recent activity desc. Used in the sidebar
 * for the visible order AND by the keyboard cycler in App.tsx - keeping the
 * order shared means ⌥↑/↓ moves through stations in the order the user sees.
 */
export function sortedJoinedStations(): StationRef[] {
  const refs = joinedStations();
  return [...refs].sort((a, b) => {
    const ta = stationActivity[stationKey(a)]?.lastEvent?.created_at || 0;
    const tb = stationActivity[stationKey(b)]?.lastEvent?.created_at || 0;
    return tb - ta;
  });
}
