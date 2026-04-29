import { createSignal } from "solid-js";
import { createStore } from "solid-js/store";
import { getRelay } from "./nostr";
import { stationKey, type StationRef } from "./stations";
import type { Signer } from "./signer";

/**
 * Version counter - bumped on every typing-state mutation (new
 * event, user-cleared, pruned). Consumers subscribe to this for
 * *instant* re-evaluation; the time-based polling tick in Feed is
 * only needed so entries drop once their TYPING_TIMEOUT elapses
 * with no other activity.
 */
const [typingVersion, setTypingVersion] = createSignal(0);
export { typingVersion };
function bumpTyping() {
  setTypingVersion((v) => v + 1);
}

const TYPING_KIND = 20001;
const TYPING_TIMEOUT = 4000; // clear after 4s of silence
const DEBOUNCE_MS = 300;     // don't spam the relay

/**
 * Per-station typing state. Each station key maps to an object of
 * `pubkey → expiry timestamp (ms)`. Keyed this way so keep-alive
 * Feeds (one per joined station) can each subscribe independently
 * without leaking one station's typing events into another's feed.
 */
const [typingByStation, setTypingByStation] = createStore<
  Record<string, Record<string, number>>
>({});
export { typingByStation };

let cleanupTimer: number | null = null;

// Prune expired entries across every station's bucket.
function pruneExpired() {
  const now = Date.now();
  let anyActive = false;
  let anyPruned = false;
  for (const key of Object.keys(typingByStation)) {
    const bucket = typingByStation[key];
    if (!bucket) continue;
    const next: Record<string, number> = {};
    let bucketChanged = false;
    for (const [pubkey, expiry] of Object.entries(bucket)) {
      if (expiry && now < expiry) {
        next[pubkey] = expiry;
        anyActive = true;
      } else {
        bucketChanged = true;
      }
    }
    if (bucketChanged) {
      setTypingByStation(key, next);
      anyPruned = true;
    }
  }
  if (anyPruned) bumpTyping();
  if (!anyActive && cleanupTimer) {
    clearInterval(cleanupTimer);
    cleanupTimer = null;
  }
}

function ensureCleanupTimer() {
  if (!cleanupTimer) {
    cleanupTimer = window.setInterval(pruneExpired, 1000);
  }
}

// --- Subscribe to typing events for a station ---

/**
 * Per-station subscription table. Each entry tracks the subId + the
 * relay handle used to open it, so unsubscribeTyping(station) can
 * tear down a specific station without touching the others.
 */
interface TypingSubRecord {
  subId: string;
  relay: ReturnType<typeof getRelay>;
}
const typingSubs = new Map<string, TypingSubRecord>();
let myPubkey = "";

export function subscribeTyping(station: StationRef | null, pubkey: string) {
  myPubkey = pubkey;
  if (!station) return;

  const key = stationKey(station);
  // Idempotent - if already subscribed for this station, keep the
  // existing sub. Keep-alive Feeds re-call this on every re-render
  // of the createEffect; we want to open the sub exactly once per
  // station across the whole app.
  if (typingSubs.has(key)) return;

  const relay = getRelay(station.relay);
  const subId = relay.subscribe(
    { kinds: [TYPING_KIND], "#h": [station.id] },
    (event) => {
      console.log("[typing/event]", { station: station.id, from: event.pubkey.slice(0, 10), age: Math.floor(Date.now() / 1000) - event.created_at });
      if (event.pubkey === myPubkey) return;
      // Ignore stale events (older than 5s) - relay may replay on reconnect.
      const age = Math.floor(Date.now() / 1000) - event.created_at;
      if (age > 5) return;
      // Functional setter - auto-creates the per-station bucket if
      // this is the first typing event for it (plain key/subkey
      // setters sometimes don't synthesize the intermediate object
      // reliably across Solid store versions).
      setTypingByStation(key, (prev) => ({
        ...(prev || {}),
        [event.pubkey]: Date.now() + TYPING_TIMEOUT,
      }));
      bumpTyping();
      ensureCleanupTimer();
    },
  );
  console.log("[typing/subscribe]", { station: station.id, key });

  typingSubs.set(key, { subId, relay });
}

/**
 * Tear down a specific station's typing sub. Called from Feed's
 * onCleanup (which only fires when the Feed itself unmounts - e.g.
 * user leaves the station). With no argument, closes EVERYTHING
 * (used by a hard reset path if one were ever needed).
 */
export function unsubscribeTyping(station?: StationRef | null) {
  if (!station) {
    for (const { subId, relay } of typingSubs.values()) {
      relay.unsubscribe(subId);
    }
    typingSubs.clear();
    // Also blow away the state so stale names don't flash if we
    // re-subscribe later.
    for (const key of Object.keys(typingByStation)) {
      setTypingByStation(key, undefined!);
    }
    return;
  }
  const key = stationKey(station);
  const rec = typingSubs.get(key);
  if (rec) {
    rec.relay.unsubscribe(rec.subId);
    typingSubs.delete(key);
  }
  setTypingByStation(key, undefined!);
}

/**
 * Clear a specific user's typing entry for a station. Called by Feed
 * whenever a kind:9 message arrives from that user - the message
 * itself is the hard signal that they're done composing, so we
 * shouldn't wait out the 4s TYPING_TIMEOUT to drop the indicator.
 */
export function clearTypingForUser(station: StationRef | null, pubkey: string) {
  if (!station) return;
  const key = stationKey(station);
  const bucket = typingByStation[key];
  const hadEntry = !!bucket && pubkey in bucket;
  console.log("[typing/clear]", { station: station.id, pubkey: pubkey.slice(0, 10), hadEntry });
  if (!hadEntry) return;
  // Setting a key's value to undefined in a Solid store removes that
  // sub-path cleanly. The cast avoids TS complaints about
  // Record<string, number> not allowing undefined.
  setTypingByStation(key, pubkey, undefined as unknown as number);
  bumpTyping();
}

// --- Send typing events (debounced) ---

let lastSentAt = 0;
let debounceTimer: number | null = null;

export function sendTyping(station: StationRef, signer: Signer) {
  if (!station) return;
  const now = Date.now();

  if (now - lastSentAt < DEBOUNCE_MS) {
    if (!debounceTimer) {
      debounceTimer = window.setTimeout(() => {
        debounceTimer = null;
        doSendTyping(station, signer);
      }, DEBOUNCE_MS);
    }
    return;
  }

  doSendTyping(station, signer);
}

async function doSendTyping(station: StationRef, signer: Signer) {
  lastSentAt = Date.now();
  const event = await signer.signEvent({
    kind: TYPING_KIND,
    content: "typing",
    tags: [["h", station.id]],
  });
  getRelay(station.relay).publish(event).catch(() => {}); // fire-and-forget
}

// --- Get active typing pubkeys for a given station ---

export function getTypingPubkeys(station: StationRef | null): string[] {
  if (!station) return [];
  const key = stationKey(station);
  const bucket = typingByStation[key];
  if (!bucket) return [];
  const now = Date.now();
  return Object.entries(bucket)
    .filter(([, expiry]) => expiry && now < expiry)
    .map(([pubkey]) => pubkey);
}
