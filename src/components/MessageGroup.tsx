import { For } from "solid-js";
import type { NostrEvent } from "../lib/keys";
import MessageRow from "./MessageRow";
import { getSigner } from "../lib/auth";

/**
 * A run of consecutive messages from the same author. The avatar is
 * rendered by Feed as a floating overlay; this wrapper owns the empty
 * rail + the bubble stack. The meta row (display-name primary, handle
 * secondary) lives INSIDE the first bubble - see MessageRow.
 */
export default function MessageGroup(props: {
  events: NostrEvent[];
  /** Group id - used by Feed to look up this group's floating avatar. */
  id?: string;
}) {
  const authorPubkey = () => props.events[0].pubkey;
  const isOwn = () => {
    try { return authorPubkey() === getSigner().pubkey; } catch { return false; }
  };

  return (
    <div
      class={`msg-group ${isOwn() ? "is-own" : ""}`}
      data-group-id={props.id ?? props.events[0].id}
    >
      {/* Empty rail - preserves the column the avatar overlay floats above. */}
      <div class="msg-group-rail" aria-hidden="true" />
      <div class="msg-group-stack">
        <For each={props.events}>
          {(event, i) => (
            <MessageRow
              event={event}
              showMeta={i() === 0}
              showTail={i() === props.events.length - 1}
            />
          )}
        </For>
      </div>
    </div>
  );
}
