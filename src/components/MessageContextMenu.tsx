import { Show, For, onMount, onCleanup, createMemo, createSignal, createEffect } from "solid-js";
import { Portal } from "solid-js/web";
import { messageContext, closeMessageContext } from "../lib/contextMenu";
import { addReaction, getReactionEntries } from "../lib/reactions";
import { setReplyingTo } from "../lib/replyState";
import { activeStation, isAdminOf, deleteMessage } from "../lib/stations";
import { getSigner } from "../lib/auth";
import { confirmDialog } from "../lib/dialog";
import { profiles, friendlyName, avatarSrc, markAvatarBroken } from "../lib/profiles";
import { removeCachedMessage } from "../lib/messageCache";
import { isPinned, pinMessage, unpinMessage } from "../lib/stationConfig";
import {
  codepointToEmoji,
  getRecents,
  addRecent,
  EmojiPicker,
  playReaction,
} from "../lib/emojiPicker.js";
import MemberActions from "./MemberActions";
import {
  IconHandsClapping,
  IconCopy,
  IconArrowBendUpLeft,
  IconTrash,
  IconPushPin,
} from "./icons";

const DEFAULT_SHELF = ["2764_fe0f", "1f525", "1f680", "1f440", "1f602", "1f44d"];
const MENU_W = 240;
const MENU_PAD = 8;
const HOVER_GRACE_MS = 120;
// Hardcoded: measuring pickerEl races the picker's async _render().
// Matches fixed height in CSS (.nr-picker.nr-embedded).
const PICKER_MODE_H = 280;

const SUMMARY_AVATAR_MAX = 4;

interface ReactorEntry {
  pubkey: string;
  emoji: string;
}

function ReactionSummary(props: {
  entries: [string, { pubkeys: string[] }][];
  flipLeft: boolean;
}) {
  const [open, setOpen] = createSignal(false);
  const [anchorRect, setAnchorRect] = createSignal<DOMRect | null>(null);
  let leaveTimer: number | null = null;
  let summaryEl: HTMLDivElement | undefined;

  function clearLeave() {
    if (leaveTimer !== null) {
      window.clearTimeout(leaveTimer);
      leaveTimer = null;
    }
  }
  function scheduleClose() {
    clearLeave();
    leaveTimer = window.setTimeout(() => setOpen(false), HOVER_GRACE_MS);
  }
  function onEnter() {
    clearLeave();
    if (summaryEl) setAnchorRect(summaryEl.getBoundingClientRect());
    setOpen(true);
  }
  onCleanup(clearLeave);

  const flat = (): ReactorEntry[] => {
    const out: ReactorEntry[] = [];
    for (const [emoji, data] of props.entries) {
      for (const pk of data.pubkeys) out.push({ pubkey: pk, emoji });
    }
    return out;
  };

  const avatarPubkeys = (): string[] => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const e of flat()) {
      if (seen.has(e.pubkey)) continue;
      seen.add(e.pubkey);
      out.push(e.pubkey);
      if (out.length >= SUMMARY_AVATAR_MAX) break;
    }
    return out;
  };

  const total = () => flat().length;
  const label = () => `${total()} ${total() === 1 ? "Reaction" : "Reactions"}`;

  // Portaled to <body> to escape .ctx-stage's overflow:hidden clipping.
  const flyoutStyle = () => {
    const r = anchorRect();
    if (!r) return {} as Record<string, string>;
    const FLYOUT_GAP = 4;
    if (props.flipLeft) {
      return {
        position: "fixed",
        top: `${r.top - 5}px`,
        right: `${window.innerWidth - r.left + FLYOUT_GAP}px`,
      };
    }
    return {
      position: "fixed",
      top: `${r.top - 5}px`,
      left: `${r.right + FLYOUT_GAP}px`,
    };
  };

  return (
    <div
      ref={summaryEl}
      class="ctx-item ctx-rxn-summary"
      onMouseEnter={onEnter}
      onMouseLeave={scheduleClose}
    >
      <span class="ctx-item-glyph" aria-hidden="true">
        <IconHandsClapping />
      </span>
      <span>{label()}</span>
      <span class="ctx-rxn-summary-avatars">
        <For each={avatarPubkeys()}>
          {(pk) => (
            <img
              class="ctx-rxn-summary-avatar"
              src={avatarSrc(pk)}
              alt=""
              loading="lazy"
              onError={() => { const u = profiles[pk]?.picture; if (u) markAvatarBroken(u); }}
            />
          )}
        </For>
      </span>
      <Show when={open()}>
        <Portal>
        <div
          class={`ctx-rxn-flyout ${props.flipLeft ? "ctx-rxn-flyout-left" : ""}`}
          style={flyoutStyle()}
          onMouseEnter={clearLeave}
          onMouseLeave={scheduleClose}
        >
          <For each={flat()}>
            {(entry) => (
              <div class="ctx-rxn-reactor">
                <img
                  class="ctx-rxn-reactor-avatar"
                  src={avatarSrc(entry.pubkey)}
                  alt=""
                  loading="lazy"
                  onError={() => { const u = profiles[entry.pubkey]?.picture; if (u) markAvatarBroken(u); }}
                />
                <span class="ctx-rxn-reactor-name">{friendlyName(entry.pubkey)}</span>
                <span class="ctx-rxn-reactor-emoji">{entry.emoji}</span>
              </div>
            )}
          </For>
        </div>
        </Portal>
      </Show>
    </div>
  );
}

/** Global context menu for messages, triggered by right-click or long-press from MessageRow. */
export default function MessageContextMenu() {
  const req = () => messageContext();
  const myPubkey = () => getSigner().pubkey;
  const isMine = () => req()?.event.pubkey === myPubkey();
  const canModerate = () => isAdminOf(activeStation(), myPubkey());

  onMount(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && req()) {
        e.preventDefault();
        closeMessageContext();
      }
    }
    function onDocClick(e: MouseEvent) {
      if (!req()) return;
      const t = e.target as HTMLElement | null;
      if (!t || !t.closest(".ctx-menu")) closeMessageContext();
    }
    function onScroll(e: Event) {
      if (!req()) return;
      // Don't close when scrolling inside the menu (e.g. emoji picker grid).
      const t = e.target;
      if (t instanceof Element && t.closest(".ctx-menu")) return;
      closeMessageContext();
    }
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("scroll", onScroll, true);
    onCleanup(() => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("scroll", onScroll, true);
    });
  });

  // Reserve picker-mode height up front so morphing into picker doesn't overflow viewport.
  const pos = createMemo(() => {
    const r = req();
    if (!r) return { left: 0, top: 0 };
    const vw = window.innerWidth, vh = window.innerHeight;
    const menuH = PICKER_MODE_H + 20;
    const left = Math.min(r.x, vw - MENU_W - MENU_PAD);
    const top = Math.min(r.y, vh - menuH - MENU_PAD);
    return { left: Math.max(MENU_PAD, left), top: Math.max(MENU_PAD, top) };
  });

  const reactorFlyoutFlipsLeft = createMemo(() => {
    const FLYOUT_W = 220;
    return pos().left + MENU_W + FLYOUT_W + MENU_PAD > window.innerWidth;
  });

  const reactionEntries = () => {
    const r = req();
    return r ? getReactionEntries(r.event.id) : [];
  };

  function react(emoji: string, code?: string) {
    const r = req();
    if (!r) return;
    const eventId = r.event.id;
    addReaction(eventId, r.event.pubkey, emoji, getSigner());
    if (code) addRecent(code);
    closeMessageContext();
    if (code) playChipAnim(eventId, emoji, code);
  }

  // Wait for Solid to commit the optimistic chip to the DOM before animating.
  function playChipAnim(eventId: string, emoji: string, code: string) {
    let attempts = 0;
    const tryPlay = () => {
      const bubble = document.getElementById(`msg-${eventId}`);
      const chips = bubble?.querySelectorAll<HTMLElement>(".reaction");
      if (chips) {
        for (const chip of chips) {
          if (chip.getAttribute("data-emoji") === emoji) {
            playReaction(chip, { code }).catch(() => { /* ignored */ });
            return;
          }
        }
      }
      if (++attempts < 8) requestAnimationFrame(tryPlay);
    };
    requestAnimationFrame(tryPlay);
  }

  const shelfCodes = () => {
    const recents = getRecents();
    return [...new Set([...recents, ...DEFAULT_SHELF])].slice(0, 6);
  };

  function shelfHoverRef(code: string) {
    return (el: HTMLButtonElement) => {
      let timer: number | undefined;
      const onEnter = () => {
        timer = window.setTimeout(() => {
          playReaction(el, { code }).catch(() => { /* ignored */ });
        }, 60);
      };
      const onLeave = () => {
        if (timer) { clearTimeout(timer); timer = undefined; }
      };
      el.addEventListener("mouseenter", onEnter);
      el.addEventListener("mouseleave", onLeave);
      onCleanup(() => {
        el.removeEventListener("mouseenter", onEnter);
        el.removeEventListener("mouseleave", onLeave);
        if (timer) clearTimeout(timer);
      });
    };
  }

  const [mode, setMode] = createSignal<"actions" | "picker">("actions");
  let stageEl: HTMLDivElement | undefined;
  let actionsEl: HTMLDivElement | undefined;
  let pickerEl: HTMLDivElement | undefined;
  let pickerHost: HTMLDivElement | undefined;
  let pickerInstance: EmojiPicker | null = null;

  // On close: destroy picker instance so the mount-guard re-instantiates on next open.
  createEffect(() => {
    if (req()) return;
    try { pickerInstance?.close(); } catch { /* ignored */ }
    pickerInstance = null;
    setMode("actions");
  });

  createEffect(() => {
    if (mode() !== "picker") return;
    if (!pickerHost || pickerInstance) return;
    const r = req();
    if (!r) return;
    const target = r.event;
    const picker = new EmojiPicker({
      animateAll: false,
      previewOnHover: true,
      onPick: ({ code, emoji }: { code: string; emoji: string }) => {
        addReaction(target.id, target.pubkey, emoji, getSigner());
        addRecent(code);
        closeMessageContext();
        playChipAnim(target.id, emoji, code);
      },
    });
    picker.open(pickerHost, { container: pickerHost });
    pickerInstance = picker;
  });

  // Drive stage height in px so CSS `transition: height` has numeric endpoints.
  createEffect(() => {
    const r = req();
    const m = mode();
    if (!r || !stageEl) return;
    const from = stageEl.offsetHeight;
    const to = m === "actions"
      ? (actionsEl?.scrollHeight ?? from)
      : PICKER_MODE_H;
    stageEl.style.height = `${from}px`;
    if (from === to) return;
    // Two rAFs: first paints `from`, second applies `to` so the transition has a starting frame.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (!stageEl) return;
        stageEl.style.height = `${to}px`;
      });
    });
  });

  function openFullPicker() {
    setMode("picker");
  }

  function reply() {
    const r = req();
    if (!r) return;
    setReplyingTo(r.event);
    closeMessageContext();
  }

  async function copySelected() {
    const r = req();
    const text = r?.selectedText;
    closeMessageContext();
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
    } catch (e) {
      console.error("Clipboard write failed:", e);
    }
  }

  async function handleTogglePin() {
    const r = req();
    if (!r) return;
    const station = activeStation();
    if (!station) return;
    closeMessageContext();
    const already = isPinned(station, r.event.id);
    const result = already
      ? await unpinMessage(getSigner(), station, r.event.id)
      : await pinMessage(getSigner(), station, r.event.id);
    if (!result.ok) {
      console.error(`${already ? "Unpin" : "Pin"} rejected:`, result.message);
    }
  }

  const isCurrentlyPinned = () => {
    const r = req();
    const s = activeStation();
    return !!(r && s && isPinned(s, r.event.id));
  };

  async function handleDelete() {
    const r = req();
    if (!r) return;
    closeMessageContext();
    const station = activeStation();
    if (!station) return;
    const ok = await confirmDialog({
      title: "Delete this message?",
      body: "This can't be undone.",
      confirmLabel: "Delete",
      destructive: true,
    });
    if (!ok) return;

    // Optimistic local removal from feed signal and cache.
    (window as any).__spacesFeedRemove?.(r.event.id);
    removeCachedMessage(station, r.event.id).catch((e) =>
      console.warn("[delete] cache cleanup failed:", e),
    );

    // Unpin alongside delete so station config doesn't keep a dangling reference.
    if (canModerate() && isPinned(station, r.event.id)) {
      unpinMessage(getSigner(), station, r.event.id).catch((e) =>
        console.warn("[delete] auto-unpin failed:", e),
      );
    }

    const result = await deleteMessage(getSigner(), station, r.event.id);
    if (!result.ok) {
      console.error("Delete rejected:", result.message);
    }
  }

  return (
    <Show when={req()}>
      {(r) => (
        <div
          class="ctx-menu"
          data-mode={mode()}
          style={{
            position: "fixed",
            left: `${pos().left}px`,
            top: `${pos().top}px`,
            width: `${MENU_W}px`,
          }}
          onContextMenu={(e) => e.preventDefault()}
        >
          <div class="ctx-stage" ref={stageEl}>
            <div class="ctx-stage-view ctx-stage-actions" ref={actionsEl}>
              <div class="ctx-reactions">
                <For each={shelfCodes()}>
                  {(code, i) => {
                    const emoji = codepointToEmoji(code);
                    return (
                      <button
                        type="button"
                        class="ctx-reaction shelf-emoji"
                        style={{ "--stagger-i": i() }}
                        ref={shelfHoverRef(code)}
                        onClick={() => react(emoji, code)}
                        aria-label={`React with ${emoji}`}
                      >
                        <span class="native shelf-emoji-native">{emoji}</span>
                      </button>
                    );
                  }}
                </For>
                <button
                  type="button"
                  class="ctx-reaction shelf-chevron"
                  style={{ "--stagger-i": shelfCodes().length }}
                  aria-label="More emojis"
                  title="More emojis"
                  onClick={openFullPicker}
                >
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                    <path d="M3 4.5L6 7.5L9 4.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
                  </svg>
                </button>
              </div>

              <Show when={r().selectedText}>
                <button class="ctx-item" onClick={copySelected}>
                  <span class="ctx-item-glyph"><IconCopy /></span>
                  <span>Copy selected text</span>
                </button>
              </Show>

              <button class="ctx-item" onClick={reply}>
                <span class="ctx-item-glyph"><IconArrowBendUpLeft /></span>
                <span>Reply</span>
              </button>

              <Show when={canModerate()}>
                <button class="ctx-item" onClick={handleTogglePin}>
                  <span class="ctx-item-glyph"><IconPushPin /></span>
                  <span>{isCurrentlyPinned() ? "Unpin message" : "Pin message"}</span>
                </button>
              </Show>

              <Show when={isMine()}>
                <button class="ctx-item" onClick={handleDelete}>
                  <span class="ctx-item-glyph"><IconTrash /></span>
                  <span>Delete message</span>
                </button>
              </Show>

              <Show when={canModerate() && !isMine() && activeStation()}>
                <div class="ctx-divider" />
                <MemberActions
                  station={activeStation()!}
                  targetPubkey={r().event.pubkey}
                  onClose={closeMessageContext}
                  prepend={
                    <button class="msg-mod-item" onClick={handleDelete}>
                      Delete message
                    </button>
                  }
                />
              </Show>

              <Show when={reactionEntries().length > 0}>
                <div class="ctx-divider" />
                <ReactionSummary
                  entries={reactionEntries()}
                  flipLeft={reactorFlyoutFlipsLeft()}
                />
              </Show>
            </div>

            <div class="ctx-stage-view ctx-stage-picker" ref={pickerEl}>
              <div class="ctx-picker-host" ref={pickerHost} />
            </div>
          </div>
        </div>
      )}
    </Show>
  );
}
