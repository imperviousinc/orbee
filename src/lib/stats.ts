import { createStore } from "solid-js/store";
// Stats come from Primal's NIP-85 bot (kind:30383), not the groups relay.
import { profileRelay as relay } from "./nostr";

// Primal's NIP-85 bot pubkey that publishes kind 30383 event stats
const PRIMAL_BOT = "28207d114dec1046c40ad9d8f5b2d86e0e470e4c0fc35739c17679faa8df4534";

export interface EventStats {
  reactions: number;
  replies: number;
  reposts: number;
  zaps: number;
  zapAmount: number;
}

const EMPTY: EventStats = { reactions: 0, replies: 0, reposts: 0, zaps: 0, zapAmount: 0 };

// --- Reactive store ---

const [stats, setStats] = createStore<Record<string, EventStats>>({});
export { stats };

export function getStats(eventId: string): EventStats {
  return stats[eventId] ?? EMPTY;
}

// --- Parse kind 30383 event ---

function parseStatsEvent(tags: string[][]): EventStats {
  const result = { ...EMPTY };
  for (const tag of tags) {
    if (tag.length < 2) continue;
    const val = parseInt(tag[1], 10);
    if (isNaN(val)) continue;
    switch (tag[0]) {
      case "reaction_cnt": result.reactions = val; break;
      case "comment_cnt": result.replies = val; break;
      case "repost_cnt": result.reposts = val; break;
      case "zap_cnt": result.zaps = val; break;
      case "zap_amount": result.zapAmount = val; break;
    }
  }
  return result;
}

// --- Batch fetch stats ---

const pendingIds = new Set<string>();
let batchTimer: number | null = null;
const BATCH_DELAY = 80;

function flushBatch() {
  batchTimer = null;
  if (pendingIds.size === 0) return;

  const ids = [...pendingIds];
  pendingIds.clear();

  relay.subscribe(
    { kinds: [30383], authors: [PRIMAL_BOT], "#d": ids },
    (event) => {
      // The "d" tag contains the event ID these stats are for
      const dTag = event.tags.find((t) => t[0] === "d");
      if (!dTag) return;
      const eventId = dTag[1];
      const parsed = parseStatsEvent(event.tags);
      setStats(eventId, parsed);
    },
    // EOSE - done, nothing more to do
    // If relay doesn't have kind 30383, we just get EOSE with no events
    // and stats stay undefined - graceful degradation
  );
}

export function requestStats(eventIds: string[]) {
  for (const id of eventIds) {
    if (stats[id]) continue; // already have it
    pendingIds.add(id);
  }

  if (pendingIds.size > 0 && !batchTimer) {
    batchTimer = window.setTimeout(flushBatch, BATCH_DELAY);
  }
}
