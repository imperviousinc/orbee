import { createSignal } from "solid-js";
import { createStore } from "solid-js/store";
import type { NostrEvent } from "./keys";

// Currently replying to
const [replyingTo, setReplyingTo] = createSignal<NostrEvent | null>(null);
export { replyingTo, setReplyingTo };

// Event lookup - all events by ID for reply references
const [eventMap, setEventMap] = createStore<Record<string, NostrEvent>>({});
export { eventMap };

export function registerEvent(event: NostrEvent) {
  if (!eventMap[event.id]) {
    setEventMap(event.id, event);
  }
}

export function getParentEvent(event: NostrEvent): NostrEvent | undefined {
  const eTag = event.tags.find((t) => t[0] === "e");
  if (!eTag) return undefined;
  return eventMap[eTag[1]];
}

export function getParentId(event: NostrEvent): string | undefined {
  const eTag = event.tags.find((t) => t[0] === "e");
  return eTag?.[1];
}
