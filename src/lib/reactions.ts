import { createStore } from "solid-js/store";
import { getRelay } from "./nostr";
import { activeStation, stationKey, type StationRef } from "./stations";
import type { NostrEvent } from "./keys";
import type { Signer } from "./signer";
import { saveCachedReactions, recordRecentReactions, recordRecentReaction } from "./messageCache";

// Per-emoji reaction data - list of unique reactor pubkeys, in
// arrival order. Count derives from .length, "did *I* react" derives
// from .includes(myPubkey). Carrying the pubkeys lets the UI render
// stacked avatars for small reactor sets and a count once it grows.
export interface EmojiReaction {
  pubkeys: string[];
}

// All reactions for one event, keyed by emoji
export interface EventReactions {
  emojis: Record<string, EmojiReaction>;
}

const [reactions, setReactions] = createStore<Record<string, EventReactions>>({});
export { reactions };

let myPubkey = "";
export function setMyPubkey(pk: string) {
  myPubkey = pk;
}

// Normalize reaction content to an emoji
function normalizeEmoji(content: string): string {
  const trimmed = content.trim();
  if (!trimmed || trimmed === "+") return "❤️";
  if (trimmed === "-") return "👎";
  return trimmed;
}

// --- Batch fetch ---

/**
 * Per-station pending reaction subscriptions. Keep-alive Feeds for
 * different stations can call requestReactions concurrently; if we
 * merged them into one Set + one `batchStation` variable, the
 * latest caller's station would overwrite the previous one and the
 * kind:7 sub's `#h` filter would miss reactions targeting the other
 * station's events. Keying by stationKey means each station gets
 * its own batch + its own sub.
 */
const pendingByStation = new Map<string, { station: StationRef; ids: Set<string> }>();
// Ids we've already opened a live kind:7 subscription for. Kept separate
// from the `reactions` store so cache-hydrated state (which pre-populates
// reactions[id] from snapshot/IDB) doesn't block opening the live sub -
// that's exactly how the "user A reacts, user B never sees it" bug used
// to happen: hydration filled reactions[id], requestReactions early-
// returned, no sub was ever created, relay's fresher state never arrived.
const subscribedIds = new Set<string>();
let batchTimer: number | null = null;
const BATCH_DELAY = 80;

function flushBatch() {
  batchTimer = null;
  if (pendingByStation.size === 0) return;

  // Process each station's pending batch independently - one kind:7
  // subscription per station with its correct `#h` + `#e` filter.
  const batches = Array.from(pendingByStation.values());
  pendingByStation.clear();

  for (const { station: target, ids: pendingSet } of batches) {
    if (pendingSet.size === 0) continue;
    const ids = [...pendingSet];

    // Mark each id as subscribed BEFORE kicking off the sub so repeat
    // requestReactions calls during the EOSE round-trip don't enqueue
    // them again.
    for (const id of ids) subscribedIds.add(id);

    runReactionBatch(target, ids);
  }
}

function runReactionBatch(target: StationRef, ids: string[]) {
  // Accumulate: eventId -> emoji -> { count, reacted }
  const acc = new Map<string, Record<string, EmojiReaction>>();
  // Collect raw kind:7 events so we can persist them to the cache after
  // EOSE. Subsequent station-switches will hydrate from cache without a
  // relay round-trip - no late chip pop-in.
  const rawEvents: NostrEvent[] = [];

  let gotEose = false;

  getRelay(target.relay).subscribe(
    { kinds: [7], "#e": ids, "#h": [target.id] },
    (event) => {
      const eTag = event.tags.find((t) => t[0] === "e");
      if (!eTag) return;
      const targetId = eTag[1];
      const emoji = normalizeEmoji(event.content);

      rawEvents.push(event);

      if (!gotEose) {
        // Pre-EOSE: accumulate into `acc`, batch-committed at EOSE so the
        // whole initial reaction set lands in one reactive update.
        if (!acc.has(targetId)) acc.set(targetId, {});
        const emojis = acc.get(targetId)!;
        if (!emojis[emoji]) emojis[emoji] = { pubkeys: [] };
        if (!emojis[emoji].pubkeys.includes(event.pubkey)) {
          emojis[emoji].pubkeys.push(event.pubkey);
        }
      } else {
        // Post-EOSE (live): apply directly to the reactive store so new
        // reactions from other tabs / other users propagate immediately.
        // Dedupe against current state - same pubkey + same emoji is a
        // no-op (NIP-25 doesn't forbid duplicates but we display unique).
        const current = reactions[targetId]?.emojis?.[emoji];
        if (current?.pubkeys.includes(event.pubkey)) return;
        const nextPubkeys = [...(current?.pubkeys ?? []), event.pubkey];
        setReactions(targetId, "emojis", emoji, { pubkeys: nextPubkeys });
        // Persist the live reaction too so a reload shows it without a
        // relay round-trip.
        if (target) {
          saveCachedReactions(target, [event]).catch(() => {});
          recordRecentReaction(target, event);
        }
      }
    },
    () => {
      gotEose = true;
      for (const [eventId, emojis] of acc) {
        setReactions(eventId, { emojis });
      }
      // Mark events with no reactions so we don't re-fetch
      for (const id of ids) {
        if (!acc.has(id) && !reactions[id]) {
          setReactions(id, { emojis: {} });
        }
      }
      // Persist the initial batch to BOTH IDB (full history) and the
      // sync snapshot (next-reload instant render).
      if (rawEvents.length > 0 && target) {
        saveCachedReactions(target, rawEvents).catch((e) =>
          console.warn("[reactions cache] save failed:", e),
        );
        recordRecentReactions(target, rawEvents);
      }
    }
  );
}

// ─── Hydrate from cache ─────────────────────────────────────────
// Called by Feed on station switch BEFORE setEvents fires. Replays cached
// kind:7 events through the same accumulator the live path uses, then
// commits to the reactive store in one batch - so the first render of any
// message has its chips already in place. No async pop-in.
export function hydrateReactionsFromEvents(events: NostrEvent[]) {
  if (events.length === 0) return;
  const acc = new Map<string, Record<string, EmojiReaction>>();
  for (const event of events) {
    const eTag = event.tags.find((t) => t[0] === "e");
    if (!eTag) continue;
    const targetId = eTag[1];
    const emoji = normalizeEmoji(event.content);
    if (!acc.has(targetId)) acc.set(targetId, {});
    const emojis = acc.get(targetId)!;
    if (!emojis[emoji]) emojis[emoji] = { pubkeys: [] };
    if (!emojis[emoji].pubkeys.includes(event.pubkey)) {
      emojis[emoji].pubkeys.push(event.pubkey);
    }
  }
  for (const [eventId, emojis] of acc) {
    setReactions(eventId, { emojis });
  }
}

/** Mark an event id as known-empty so requestReactions skips it. */
export function markReactionsKnown(eventIds: string[]) {
  for (const id of eventIds) {
    if (!reactions[id]) setReactions(id, { emojis: {} });
  }
}

export function requestReactions(eventIds: string[], station?: StationRef | null) {
  // Resolve the station up front - fall back to active only when the
  // caller didn't specify one (legacy calls). Keep-alive Feeds pass
  // their own station explicitly so the per-station bucket is correct
  // even when the "active" station is something different.
  const target = station || activeStation();
  if (!target) return;
  const key = stationKey(target);

  let bucket = pendingByStation.get(key);
  if (!bucket) {
    bucket = { station: target, ids: new Set<string>() };
    pendingByStation.set(key, bucket);
  }
  for (const id of eventIds) {
    // Gate on "have we opened a live sub for this id?" - NOT on whether
    // we have cached reaction data. Cache hydration seeds reactions[id]
    // but we still need the live sub to pick up anything the relay has
    // that the snapshot doesn't.
    if (subscribedIds.has(id)) continue;
    bucket.ids.add(id);
  }

  // Drop the bucket if we didn't add anything - otherwise the next
  // flushBatch would leave an empty record in the map forever.
  if (bucket.ids.size === 0) {
    pendingByStation.delete(key);
    return;
  }

  if (!batchTimer) {
    batchTimer = window.setTimeout(flushBatch, BATCH_DELAY);
  }
}

// --- React with an emoji ---

export async function addReaction(
  eventId: string,
  targetPubkey: string,
  emoji: string,
  signer: Signer
): Promise<void> {
  const normalized = normalizeEmoji(emoji);

  // Check if we already reacted with this emoji
  const current = reactions[eventId]?.emojis?.[normalized];
  if (current?.pubkeys.includes(signer.pubkey)) return;

  // Optimistic update - append our pubkey to the reactors list.
  const nextPubkeys = [...(current?.pubkeys ?? []), signer.pubkey];
  setReactions(eventId, "emojis", normalized, { pubkeys: nextPubkeys });

  // NIP-29: reaction must address the same station via the h tag, otherwise
  // the relay rejects the event. Target kind is 9 (NIP-29 chat), not 1.
  const station = activeStation();
  if (!station) return;
  const tags: string[][] = [
    ["e", eventId],
    ["p", targetPubkey],
    ["k", "9"],
    ["h", station.id],
  ];

  const event = await signer.signEvent({
    kind: 7,
    content: emoji === "❤️" ? "+" : emoji,
    tags,
  });

  const result = await getRelay(station.relay).publish(event);
  if (!result.ok) {
    // Rollback: drop our pubkey from the reactors list.
    setReactions(eventId, "emojis", normalized, {
      pubkeys: (current?.pubkeys ?? []).filter((pk) => pk !== signer.pubkey),
    });
    return;
  }
  // Persist our own reaction to BOTH IDB and the sync snapshot so it
  // survives a reload even before other clients echo it back.
  saveCachedReactions(station, [event]).catch((e) =>
    console.warn("[reactions cache] save failed:", e),
  );
  recordRecentReaction(station, event);
}

// --- Helper: get sorted emoji entries for an event ---

export function getReactionEntries(eventId: string): [string, EmojiReaction][] {
  const r = reactions[eventId];
  if (!r?.emojis) return [];
  return Object.entries(r.emojis)
    .filter(([, v]) => v.pubkeys.length > 0)
    .sort((a, b) => b[1].pubkeys.length - a[1].pubkeys.length);
}

// --- Backwards compat helper ---
export function toggleLike(eventId: string, targetPubkey: string, signer: Signer) {
  return addReaction(eventId, targetPubkey, "❤️", signer);
}
