import { For } from "solid-js";
import type { NostrEvent } from "../lib/keys";
import MessageRow from "./MessageRow";
import { getSigner } from "../lib/auth";
import { avatarSrc, markAvatarBroken, profiles } from "../lib/profiles";
import { toggleProfileCard } from "../lib/profileCard";

/**
 * A run of consecutive messages from the same author. The avatar lives
 * inside the rail with `position: sticky` so the compositor pins it to
 * the bottom of the viewport synchronously with scroll - any JS-driven
 * positioning lags one frame because the scroll event fires after the
 * compositor has already painted the new scroll position. The meta row
 * (display-name primary, handle secondary) lives INSIDE the first
 * bubble - see MessageRow.
 */
export default function MessageGroup(props: {
  events: NostrEvent[];
  /** Group id - used by Feed/MessageRow lookups. */
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
      <div class="msg-group-rail">
        <img
          class="msg-group-avatar"
          src={avatarSrc(authorPubkey())}
          alt=""
          decoding="sync"
          loading="eager"
          onError={() => {
            const url = profiles[authorPubkey()]?.picture;
            if (url) markAvatarBroken(url);
          }}
          onClick={(e) => {
            e.stopPropagation();
            toggleProfileCard(authorPubkey(), e.clientX, e.clientY);
          }}
          data-profile-trigger
          title="View profile"
        />
      </div>
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
