import { Show, For, JSX, onCleanup } from "solid-js";
import type { NostrEvent } from "../lib/keys";
import { getSigner } from "../lib/auth";
import { profiles, friendlyName, hasHandle as profileHasHandle, avatarSrc, markAvatarBroken } from "../lib/profiles";
import { displayStateFor, identityPartsVerified } from "../lib/verify";
import { addReaction, getReactionEntries } from "../lib/reactions";
import { getParentEvent } from "../lib/replyState";
import { handleColor } from "../lib/colors";
import { setMessageContext } from "../lib/contextMenu";
import { activeStation } from "../lib/stations";
import { previewsFromTags } from "../lib/linkPreview";
import { isPinned } from "../lib/stationConfig";
import { toggleProfileCard } from "../lib/profileCard";
import LinkPreview from "./LinkPreview";
import IdentityPrimary from "./IdentityPrimary";
import { IconPushPin, IconLockSimple } from "./icons";

function formatTime(ts: number): string {
  return new Date(ts * 1000).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

const IMAGE_EXT = /\.(jpg|jpeg|png|gif|webp|svg)(\?[^\s]*)?$/i;
const URL_REGEX = /https?:\/\/[^\s<>)"]+/g;

interface ImageMeta {
  url: string;
  width?: number;
  height?: number;
}

// NIP-29 clients (e.g. chachi) inline images as data URIs when no upload
// endpoint is configured; relay event size cap keeps payloads small.
const DATA_IMAGE_REGEX = /data:image\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/=_-]+/g;

function extractImages(text: string, tags: string[][]): { cleanText: string; images: ImageMeta[] } {
  const images: ImageMeta[] = [];
  const imetaMap = new Map<string, { width?: number; height?: number }>();

  for (const tag of tags) {
    if (tag[0] !== "imeta") continue;
    let url = "";
    let width: number | undefined;
    let height: number | undefined;
    for (let i = 1; i < tag.length; i++) {
      if (tag[i].startsWith("url ")) url = tag[i].slice(4);
      if (tag[i].startsWith("dim ")) {
        const [w, h] = tag[i].slice(4).split("x").map(Number);
        width = w;
        height = h;
      }
    }
    if (url) imetaMap.set(url, { width, height });
  }

  const imageUrls = new Set<string>();
  let match;
  while ((match = URL_REGEX.exec(text)) !== null) {
    const url = match[0];
    if (IMAGE_EXT.test(url) || imetaMap.has(url)) {
      imageUrls.add(url);
      const meta = imetaMap.get(url);
      images.push({ url, width: meta?.width, height: meta?.height });
    }
  }
  while ((match = DATA_IMAGE_REGEX.exec(text)) !== null) {
    const url = match[0];
    if (imageUrls.has(url)) continue;
    imageUrls.add(url);
    images.push({ url });
  }

  let cleanText = text;
  for (const url of imageUrls) {
    cleanText = cleanText.replace(url, "").trim();
  }

  return { cleanText, images };
}

function renderContent(text: string): JSX.Element[] {
  const parts: JSX.Element[] = [];
  const codeBlockRegex = /```([\s\S]*?)```/g;
  let lastIndex = 0;
  let match;

  while ((match = codeBlockRegex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(...renderInline(text.slice(lastIndex, match.index)));
    }
    parts.push(<pre class="msg-code-block"><code>{match[1].trim()}</code></pre>);
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) {
    parts.push(...renderInline(text.slice(lastIndex)));
  }
  return parts;
}

function renderInline(text: string): JSX.Element[] {
  const parts: JSX.Element[] = [];
  const regex = /(\*\*(.+?)\*\*|`([^`]+?)`|(https?:\/\/[^\s<>)"]+)|(\b\w+@\w+\b))/g;
  let lastIndex = 0;
  let match;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(...textWithNewlines(text.slice(lastIndex, match.index)));
    }
    if (match[2]) {
      parts.push(<strong class="msg-bold">{match[2]}</strong>);
    } else if (match[3]) {
      parts.push(<code class="msg-inline-code">{match[3]}</code>);
    } else if (match[4]) {
      const url = match[4];
      parts.push(<a class="msg-link" href={url} target="_blank" rel="noopener noreferrer">{url.length > 60 ? url.slice(0, 60) + "..." : url}</a>);
    } else if (match[5]) {
      parts.push(<span class="mention">{match[5]}</span>);
    }
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) {
    parts.push(...textWithNewlines(text.slice(lastIndex)));
  }
  return parts;
}

function textWithNewlines(text: string): JSX.Element[] {
  const lines = text.split("\n");
  const parts: JSX.Element[] = [];
  lines.forEach((line, i) => {
    if (i > 0) parts.push(<br />);
    if (line) parts.push(<>{line}</>);
  });
  return parts;
}

function renderImages(images: ImageMeta[]): JSX.Element[] {
  return images.map((img) => (
    <div class="msg-image">
      <img
        src={img.url}
        alt=""
        width={img.width}
        height={img.height}
        loading="lazy"
        onClick={() => window.open(img.url, "_blank")}
      />
    </div>
  ));
}

const AVATAR_THRESHOLD = 3;

function ReactionChip(props: {
  eventId: string;
  targetPubkey: string;
  emoji: string;
  pubkeys: string[];
}) {
  const me = () => getSigner().pubkey;
  const reacted = () => props.pubkeys.includes(me());
  const titleText = () => props.pubkeys.map((pk) => friendlyName(pk)).join(", ");
  const showAvatars = () => props.pubkeys.length > 0 && props.pubkeys.length <= AVATAR_THRESHOLD;
  return (
    <span
      class={`reaction ${reacted() ? "active" : ""}`}
      data-emoji={props.emoji}
      data-reactors={titleText()}
      onClick={() => addReaction(props.eventId, props.targetPubkey, props.emoji, getSigner())}
    >
      {/* `.native` is the hook notoReactions' playReaction() targets. */}
      <span class="native">{props.emoji}</span>
      <Show
        when={showAvatars()}
        fallback={<span class="reaction-count">{props.pubkeys.length}</span>}
      >
        <span class="reaction-avatars">
          <For each={props.pubkeys}>
            {(pk) => (
              <img
                class="reaction-avatar"
                src={avatarSrc(pk)}
                alt=""
                decoding="sync"
                loading="eager"
                onError={() => { const u = profiles[pk]?.picture; if (u) markAvatarBroken(u); }}
              />
            )}
          </For>
        </span>
      </Show>
    </span>
  );
}

const LONG_PRESS_MS = 450;
const LONG_PRESS_TOLERANCE = 10;

export default function MessageRow(props: {
  event: NostrEvent;
  /** First message of an author run - render the meta row (handle + badges). */
  showMeta?: boolean;
  /** Last message of an author run - render the bubble tail toward the avatar. */
  showTail?: boolean;
}) {
  const color = () => handleColor(props.event.pubkey);
  const hasH = () => profileHasHandle(props.event.pubkey);
  // Unverified handles are never surfaced inline; identityPartsVerified()
  // falls back to the npub instead.
  const displayState = () => displayStateFor(props.event.pubkey);
  const entries = () => getReactionEntries(props.event.id);
  const parentEvent = () => getParentEvent(props.event);
  const isOwn = () => props.event.pubkey === getSigner().pubkey;
  const { cleanText, images } = extractImages(props.event.content, props.event.tags);
  // Previews come from imeta-style tags pre-fetched at compose time
  // (see lib/linkPreview.ts) - no recipient fetches.
  const linkPreviews = previewsFromTags(props.event.tags);

  const showMeta = () => props.showMeta !== false;
  const showTail = () => props.showTail !== false;

  function scrollToParent() {
    const parent = parentEvent();
    if (!parent) return;
    const el = document.getElementById(`msg-${parent.id}`);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      el.style.background = "var(--accent-dim)";
      setTimeout(() => { el.style.background = ""; }, 1500);
    }
  }

  function openMenu(x: number, y: number) {
    // Only attach selected text when the selection lives inside THIS bubble.
    let selectedText: string | undefined;
    const sel = window.getSelection?.();
    if (sel && !sel.isCollapsed) {
      const text = sel.toString().trim();
      if (text) {
        const bubble = document.getElementById(`msg-${props.event.id}`)?.querySelector(".msg-content");
        const inside = bubble && sel.anchorNode && bubble.contains(sel.anchorNode);
        if (inside) selectedText = text;
      }
    }
    setMessageContext({ event: props.event, x, y, selectedText });
  }

  function onContext(e: MouseEvent) {
    const t = e.target as HTMLElement | null;
    if (!t || !t.closest(".msg-content")) return;
    // Defer to the browser for links/images so "Open in new tab" /
    // "Save image" stay available.
    if (t.closest("a, .msg-image img")) return;
    e.preventDefault();
    openMenu(e.clientX, e.clientY);
  }

  let pressTimer: number | null = null;
  let pressStart: { x: number; y: number } | null = null;
  function clearPress() {
    if (pressTimer !== null) {
      window.clearTimeout(pressTimer);
      pressTimer = null;
    }
    pressStart = null;
  }
  function onTouchStart(e: TouchEvent) {
    const t = e.target as HTMLElement | null;
    if (!t || !t.closest(".msg-content")) return;
    if (t.closest("a, button, .reaction, .msg-image, .reply-ref")) return;
    if (e.touches.length !== 1) return;
    const touch = e.touches[0];
    pressStart = { x: touch.clientX, y: touch.clientY };
    pressTimer = window.setTimeout(() => {
      pressTimer = null;
      if (!pressStart) return;
      if (typeof navigator !== "undefined" && "vibrate" in navigator) {
        try { (navigator as any).vibrate?.(10); } catch { /* ignored */ }
      }
      openMenu(pressStart.x, pressStart.y);
      pressStart = null;
    }, LONG_PRESS_MS);
  }
  function onTouchMove(e: TouchEvent) {
    if (!pressStart || pressTimer === null) return;
    const t = e.touches[0];
    const dx = t.clientX - pressStart.x;
    const dy = t.clientY - pressStart.y;
    if (Math.hypot(dx, dy) > LONG_PRESS_TOLERANCE) clearPress();
  }
  onCleanup(clearPress);

  const tailColor = () =>
    !isOwn() && displayState() === "orange" && hasH() ? color() : undefined;

  return (
    <div
      class={`msg ${showMeta() && !isOwn() ? "" : "msg-no-meta"} ${showTail() ? "msg-with-tail" : ""}`}
      id={`msg-${props.event.id}`}
      onContextMenu={onContext}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={clearPress}
      onTouchCancel={clearPress}
    >
      <div
        class={`msg-content ${isOwn() ? "is-own" : ""}`}
        style={isOwn() ? { "--own-border-color": color() } : undefined}
      >
        <Show when={showMeta() && !isOwn()}>
          {(() => {
            const identity = () => identityPartsVerified(props.event.pubkey);
            const handleInlineColor = () => identity().hasHandle ? color() : "var(--text-secondary)";
            const openCard = (e: MouseEvent) => {
              e.stopPropagation();
              toggleProfileCard(props.event.pubkey, e.clientX, e.clientY);
            };
            return (
              <div
                class={`handle-label ${identity().secondary ? "has-name" : ""}`}
                data-display-state={displayState()}
              >
                <span
                  class={`handle ${identity().hasHandle ? "" : "is-npub"}`}
                  style={{ color: handleInlineColor() }}
                  onClick={openCard}
                  data-profile-trigger
                  title="View profile"
                >
                  <IdentityPrimary identity={identity()} />
                </span>
                <Show when={identity().secondary}>
                  <span
                    class="handle-label-name-wrap"
                    data-tip="Display names are not verified - don't trust them for identity. Verify via the handle."
                  >
                    <span class="handle-label-name">
                      {identity().secondary}
                    </span>
                  </span>
                </Show>
              </div>
            );
          })()}
        </Show>

        <Show when={parentEvent()}>
          {(parent) => {
            const quoteIdentity = () => identityPartsVerified(parent().pubkey);
            return (
              <div class="msg-quote" onClick={scrollToParent}>
                <span
                  class="msg-quote-author"
                  style={
                    isOwn()
                      ? undefined
                      : { color: quoteIdentity().hasHandle ? handleColor(parent().pubkey) : "var(--text-muted)" }
                  }
                >
                  <IdentityPrimary identity={quoteIdentity()} />
                </span>
                <span class="msg-quote-text">
                  {parent().content.replace(/https?:\/\/\S+/g, "").trim().slice(0, 80) || "📷 image"}
                </span>
              </div>
            );
          }}
        </Show>

        <div class="msg-body">{renderContent(cleanText)}</div>

        {renderImages(images)}

        <Show when={linkPreviews.length > 0}>
          <div class="msg-link-previews">
            <For each={linkPreviews}>
              {(card) => <LinkPreview card={card} />}
            </For>
          </div>
        </Show>

        <Show when={entries().length > 0}>
          <div class="msg-reactions">
            <For each={entries()}>
              {([emoji, data]) => (
                <ReactionChip
                  eventId={props.event.id}
                  targetPubkey={props.event.pubkey}
                  emoji={emoji}
                  pubkeys={data.pubkeys}
                />
              )}
            </For>
          </div>
        </Show>

        <span class="msg-time">
          <Show when={(() => {
            const s = activeStation();
            return s ? isPinned(s, props.event.id) : false;
          })()}>
            <span class="msg-time-pin" title="Pinned" aria-label="Pinned">
              <IconPushPin />
            </span>
          </Show>
          {formatTime(props.event.created_at)}
          <Show when={displayState() === "orange"}>
            <span
              class="msg-time-verified"
              title="Sovereign handle pinned to a trusted anchor"
              aria-label="Verified"
            >
              <svg viewBox="0 0 8 8" aria-hidden="true">
                <path d="M1.7 4.2 L3.2 5.6 L6.3 2.5" />
              </svg>
            </span>
          </Show>
        </span>

        <Show when={showTail()}>
          {/* Canonical .them path; CSS mirrors via scaleX(-1) for own
              tails on mobile (right side). Desktop own-tails sit on the
              left, so the mirror is dropped there. */}
          <span
            class={`msg-tail ${isOwn() ? "msg-tail-me" : "msg-tail-them"}`}
            style={tailColor() ? { "--tail-color": tailColor() } : undefined}
            aria-hidden="true"
          >
            <svg viewBox="0 0 6 6">
              <path d="M0,6 L6,6 L6,0 L3,0 L3,3 L0,3 Z" />
            </svg>
          </span>
        </Show>
      </div>
    </div>
  );
}
