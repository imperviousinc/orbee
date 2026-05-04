import { avatarSrc, markAvatarBroken, profiles } from "../lib/profiles";
import { toggleProfileCard } from "../lib/profileCard";

export const AVATAR_H = 40;
export const PIN_GAP = 8;
// .msg-group bottom padding; subtract so avatar bottom aligns with bubble bottom.
export const GROUP_BOTTOM_PAD = 10;

/** Compute the pinned Y in spacer coordinates given a group's bounds and
 *  the live viewport bottom. Pure function so the same math runs in the
 *  initial JSX render and in the imperative scroll handler. */
export function avatarPinY(groupStart: number, groupEnd: number, visibleBottom: number): number {
  const natural = groupEnd - AVATAR_H - GROUP_BOTTOM_PAD;
  const pin = visibleBottom - AVATAR_H - PIN_GAP;
  return Math.max(groupStart, Math.min(pin, natural));
}

/**
 * Sticky-bottom avatar for a message group. Replicates `position: sticky;
 * bottom: 8px` for absolutely-positioned virtualized rows (where sticky
 * doesn't apply). The transform is set inline at mount time and is then
 * updated *imperatively* by Feed's scroll handler (querying `.floating-
 * avatar` and reading the data-group-* attrs) - going through Solid's
 * reactive style binding on every scroll tick adds a microtask hop after
 * the browser has already painted, which surfaces as visible avatar
 * jitter relative to the bubbles. Group bounds change rarely (only on
 * virtualizer remeasure) so re-rendering for those is fine.
 */
export default function FloatingAvatar(props: {
  pubkey: string;
  /** Y of group top within spacer (matches virtualItem.start). */
  groupStart: number;
  /** Y of group bottom within spacer (matches start + size). */
  groupEnd: number;
  /** Initial visible bottom for first paint; later scrolls update via Feed. */
  visibleBottom: number;
}) {
  const src = () => avatarSrc(props.pubkey);

  return (
    <img
      class="floating-avatar"
      src={src()}
      alt=""
      // PNG data URLs from getCreatureAvatar need a decode pass; sync+eager
      // keeps avatars painting in the same frame as the bubbles.
      decoding="sync"
      loading="eager"
      onError={() => {
        const url = profiles[props.pubkey]?.picture;
        if (url) markAvatarBroken(url);
      }}
      onClick={(e) => {
        e.stopPropagation();
        toggleProfileCard(props.pubkey, e.clientX, e.clientY);
      }}
      data-profile-trigger
      data-group-start={props.groupStart}
      data-group-end={props.groupEnd}
      title="View profile"
      style={{
        transform: `translate3d(0, ${avatarPinY(props.groupStart, props.groupEnd, props.visibleBottom)}px, 0)`,
      }}
    />
  );
}
