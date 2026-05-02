import { createSignal, createMemo, createEffect, onCleanup, For, Show } from "solid-js";
import { EmojiPicker } from "../lib/emojiPicker.js";
import type { NostrEvent } from "../lib/keys";
import type { Signer } from "../lib/signer";
import { displayName, hasHandle, avatarSrc, markAvatarBroken, profiles } from "../lib/profiles";
import { getRelay } from "../lib/nostr";
import type { StationRef } from "../lib/stations";
import { replyingTo, setReplyingTo } from "../lib/replyState";
import { sendTyping } from "../lib/typing";
import { uploadToBlossom, getImageDimensions, type UploadResult } from "../lib/blossom";
import { handleColor } from "../lib/colors";
import {
  extractUrls,
  requestPreview,
  getPreviewState,
  cardToTag,
} from "../lib/linkPreview";
import LinkPreview, { LinkPreviewSkeleton } from "./LinkPreview";
import { IconX, IconWarningCircle, IconSmiley } from "./icons";

function formatSize(bytes: number): string {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / (1024 * 1024)).toFixed(1) + " MB";
}

export default function MessageInput(props: {
  signer: Signer;
  station: StationRef | null;
  stationLabel: string;
  onPublished: (event: NostrEvent) => void;
}) {
  let textareaRef!: HTMLTextAreaElement;
  const [sending, setSending] = createSignal(false);
  const [hasText, setHasText] = createSignal(false);
  const [pendingFile, setPendingFile] = createSignal<File | null>(null);
  const [previewUrl, setPreviewUrl] = createSignal<string | null>(null);
  const [uploadProgress, setUploadProgress] = createSignal(0);
  const [uploading, setUploading] = createSignal(false);
  const [dragOver, setDragOver] = createSignal(false);
  const [sendError, setSendError] = createSignal<string | null>(null);

  const [composerUrls, setComposerUrls] = createSignal<string[]>([]);
  const [dismissed, setDismissed] = createSignal<Set<string>>(new Set());
  let urlScanTimer: number | null = null;

  const MAX_PREVIEWS = 3;
  const visibleUrls = createMemo(() => {
    const dis = dismissed();
    return composerUrls().filter((u) => !dis.has(u)).slice(0, MAX_PREVIEWS);
  });

  // queueMicrotask defers past the render that mounted the replying-to bar.
  createEffect(() => {
    if (replyingTo() && textareaRef) {
      queueMicrotask(() => textareaRef?.focus());
    }
  });

  function rescanUrls() {
    if (!textareaRef) return;
    const urls = extractUrls(textareaRef.value);
    setComposerUrls(urls);
    const dis = dismissed();
    for (const u of urls.filter((x) => !dis.has(x)).slice(0, MAX_PREVIEWS)) {
      requestPreview(u);
    }
  }

  function scheduleRescan() {
    if (urlScanTimer) window.clearTimeout(urlScanTimer);
    urlScanTimer = window.setTimeout(rescanUrls, 350);
  }

  function dismissPreview(url: string) {
    setDismissed((prev) => {
      const next = new Set(prev);
      next.add(url);
      return next;
    });
  }

  function autoResize() {
    textareaRef.style.height = "auto";
    textareaRef.style.height = Math.min(textareaRef.scrollHeight, 160) + "px";
  }

  function handleFile(file: File) {
    if (!file.type.startsWith("image/")) return;
    setPendingFile(file);
    setPreviewUrl(URL.createObjectURL(file));
  }

  function clearFile() {
    const url = previewUrl();
    if (url) URL.revokeObjectURL(url);
    setPendingFile(null);
    setPreviewUrl(null);
    setUploadProgress(0);
  }

  async function handleSend() {
    const content = textareaRef.value.trim();
    const file = pendingFile();
    const s = props.station;
    if (!s) return;
    if ((!content && !file) || sending()) return;

    setSending(true);
    setSendError(null);
    try {
      let finalContent = content;
      // NIP-29: target this message at the active station via the h tag
      const tags: string[][] = [["h", s.id]];
      const reply = replyingTo();

      if (reply) {
        tags.push(["e", reply.id, "", "root"]);
        tags.push(["p", reply.pubkey]);
      }

      // Embed link previews as imeta-style tags so recipients render
      // the card without HTTP-fetching the linked host themselves.
      const dis = dismissed();
      const sendUrls = extractUrls(content).filter((u) => !dis.has(u)).slice(0, MAX_PREVIEWS);
      for (const url of sendUrls) {
        const state = getPreviewState(url);
        if (state && state !== "loading" && state !== "missing") {
          tags.push(cardToTag(state));
        }
      }

      if (file) {
        setUploading(true);
        const [result, dims] = await Promise.all([
          uploadToBlossom(file, props.signer, setUploadProgress),
          getImageDimensions(file),
        ]);
        setUploading(false);

        finalContent = finalContent ? `${finalContent}\n${result.url}` : result.url;

        tags.push([
          "imeta",
          `url ${result.url}`,
          `m ${file.type}`,
          `dim ${dims.width}x${dims.height}`,
        ]);
      }

      // NIP-29 chat messages are kind 9.
      const event = await props.signer.signEvent({ kind: 9, content: finalContent, tags });

      console.log("[msg/publish→]", {
        relay: s.relay,
        id: event.id.slice(0, 10),
        h: s.id,
        kind: event.kind,
        pubkey: event.pubkey.slice(0, 10),
        content: event.content.slice(0, 40),
        tags: event.tags,
      });

      // Optimistic: clear composer + render bubble; same-id dedup on retry.
      textareaRef.value = "";
      textareaRef.style.height = "auto";
      setHasText(false);
      setReplyingTo(null);
      clearFile();
      setComposerUrls([]);
      setDismissed(new Set<string>());
      props.onPublished(event);
      setSending(false);
      queueMicrotask(() => textareaRef?.focus());

      getRelay(s.relay).publish(event).then((publishResult) => {
        console.log("[msg/publish←]", {
          id: event.id.slice(0, 10),
          ok: publishResult.ok,
          message: publishResult.message || "",
        });
        if (!publishResult.ok) {
          setSendError("Relay rejected the message.");
        }
      }).catch((e) => {
        console.error("[msg/publish✗]", e);
        setSendError("Couldn't publish - check your connection.");
      });
    } catch (e: any) {
      console.error("Send failed:", e);
      setSendError("Couldn't publish - check your connection and try again.");
      setSending(false);
      setUploading(false);
      queueMicrotask(() => textareaRef?.focus());
    }
  }

  function handleKeyDown(e: KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
    if (e.key === "Escape") {
      if (pendingFile()) clearFile();
      else if (replyingTo()) setReplyingTo(null);
    }
  }

  function handlePaste(e: ClipboardEvent) {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of items) {
      if (item.type.startsWith("image/")) {
        e.preventDefault();
        const file = item.getAsFile();
        if (file) handleFile(file);
        return;
      }
    }
  }

  function handleDrop(e: DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer?.files[0];
    if (file?.type.startsWith("image/")) handleFile(file);
  }

  // Emoji picker. Reused across opens; torn down on cleanup.
  let emojiPicker: EmojiPicker | null = null;
  function ensureEmojiPicker(): EmojiPicker {
    if (emojiPicker) return emojiPicker;
    emojiPicker = new EmojiPicker({
      onPick: ({ emoji }: { code: string; emoji: string }) => {
        if (!textareaRef) return;
        const start = textareaRef.selectionStart ?? textareaRef.value.length;
        const end = textareaRef.selectionEnd ?? start;
        const before = textareaRef.value.slice(0, start);
        const after = textareaRef.value.slice(end);
        textareaRef.value = before + emoji + after;
        const caret = start + emoji.length;
        textareaRef.setSelectionRange(caret, caret);
        textareaRef.focus();
        autoResize();
        setHasText(textareaRef.value.trim().length > 0);
        scheduleRescan();
      },
    });
    return emojiPicker;
  }
  function toggleEmojiPicker(anchor: HTMLElement) {
    ensureEmojiPicker().toggle(anchor);
  }
  onCleanup(() => {
    try { emojiPicker?.close(); } catch { /* ignored */ }
    emojiPicker = null;
  });

  return (
    <div style={{ "flex-shrink": "0" }}>
      <Show when={sendError()}>
        <div class="send-error">
          <span class="send-error-icon"><IconWarningCircle /></span>
          <span class="send-error-msg">{sendError()}</span>
          <button class="send-error-retry" onClick={handleSend} disabled={sending()}>
            Retry
          </button>
          <button class="send-error-dismiss" onClick={() => setSendError(null)} aria-label="Dismiss">
            <IconX />
          </button>
        </div>
      </Show>

      <Show when={replyingTo()}>
        {(reply) => (
          <div class="replying-to">
            <span class="replying-to-label">Replying to</span>
            <span class="replying-to-name" style={{ color: hasHandle(reply().pubkey) ? handleColor(reply().pubkey) : "var(--text-muted)" }}>
              {displayName(reply().pubkey)}
            </span>
            <button class="replying-to-close" onClick={() => setReplyingTo(null)} aria-label="Cancel reply"><IconX /></button>
          </div>
        )}
      </Show>

      <Show when={visibleUrls().length > 0}>
        <div class="composer-link-previews">
          <For each={visibleUrls()}>
            {(url) => {
              const state = () => getPreviewState(url);
              return (
                <Show
                  when={(() => { const s = state(); return s && s !== "loading" && s !== "missing" ? s : null; })()}
                  fallback={
                    <Show when={state() === "loading"}>
                      <LinkPreviewSkeleton onDismiss={() => dismissPreview(url)} />
                    </Show>
                  }
                >
                  {(card) => <LinkPreview card={card()} onDismiss={() => dismissPreview(url)} />}
                </Show>
              );
            }}
          </For>
        </div>
      </Show>

      <Show when={pendingFile()}>
        <div class="upload-preview">
          <img src={previewUrl()!} alt="" />
          <div class="upload-preview-info">
            <div class="upload-preview-name">{pendingFile()!.name}</div>
            <div class="upload-preview-size">{formatSize(pendingFile()!.size)}</div>
            <Show when={uploading()}>
              <div class="upload-progress">
                <div class="upload-progress-bar" style={{ width: `${uploadProgress()}%` }} />
              </div>
            </Show>
          </div>
          <button class="upload-preview-remove" onClick={clearFile} aria-label="Remove image"><IconX /></button>
        </div>
      </Show>

      <div
        class="input-area"
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
      >
        <div class="input-box" style={{ "border-color": dragOver() ? "var(--accent)" : undefined }}>
          <div class="composer-avatar" aria-hidden="true">
            <img
              src={avatarSrc(props.signer.pubkey)}
              alt=""
              onError={() => {
                const u = profiles[props.signer.pubkey]?.picture;
                if (u) markAvatarBroken(u);
              }}
            />
          </div>
          <textarea
            class="input"
            ref={textareaRef}
            rows={1}
            placeholder={replyingTo() ? `Reply to ${displayName(replyingTo()!.pubkey)}...` : `Message #${props.stationLabel}`}
            onInput={() => {
              const hasContent = textareaRef.value.trim().length > 0;
              setHasText(hasContent);
              autoResize();
              if (sendError()) setSendError(null);
              if (hasContent && props.station) sendTyping(props.station, props.signer);
              scheduleRescan();
            }}
            onKeyDown={handleKeyDown}
            onPaste={(e) => {
              handlePaste(e);
              // Pasted URLs scan immediately, no debounce.
              setTimeout(rescanUrls, 0);
            }}
            disabled={sending()}
          />
          <button
            type="button"
            class="input-emoji"
            onClick={(e) => toggleEmojiPicker(e.currentTarget)}
            aria-label="Insert emoji"
            title="Emoji"
          >
            <IconSmiley />
          </button>
          <button
            class={`input-send ${hasText() || pendingFile() ? "ready" : ""}`}
            onClick={handleSend}
            disabled={(!hasText() && !pendingFile()) || sending()}
            aria-label="Send"
          >
            {uploading() ? "…" : "↑"}
          </button>
        </div>
      </div>
    </div>
  );
}
