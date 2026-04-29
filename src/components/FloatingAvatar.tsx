import { createMemo } from "solid-js";
import { avatarSrc, markAvatarBroken, profiles } from "../lib/profiles";
import { toggleProfileCard } from "../lib/profileCard";

const AVATAR_H = 40;
const PIN_GAP = 8;
// .msg-group bottom padding; subtract so avatar bottom aligns with bubble bottom.
const GROUP_BOTTOM_PAD = 10;

/**
 * Sticky-bottom avatar for a message group. Replicates `position: sticky;
 * bottom: 8px` for absolutely-positioned virtualized rows (where sticky
 * doesn't apply). Layout in CSS; only Y is set inline.
 */
export default function FloatingAvatar(props: {
  pubkey: string;
  /** Y of group top within spacer (matches virtualItem.start). */
  groupStart: number;
  /** Y of group bottom within spacer (matches start + size). */
  groupEnd: number;
  /** Live scroll-derived bottom edge in spacer coordinates. */
  visibleBottom: number;
}) {
  const src = () => avatarSrc(props.pubkey);

  const y = createMemo(() => {
    const natural = props.groupEnd - AVATAR_H - GROUP_BOTTOM_PAD;
    const pin = props.visibleBottom - AVATAR_H - PIN_GAP;
    return Math.max(props.groupStart, Math.min(pin, natural));
  });

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
      title="View profile"
      style={{ transform: `translate3d(0, ${y()}px, 0)` }}
    />
  );
}
