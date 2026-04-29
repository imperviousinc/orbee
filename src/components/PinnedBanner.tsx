import { For, Show, onCleanup, onMount, createMemo } from "solid-js";
import { eventMap } from "../lib/replyState";
import { stationConfigs, missingPinIds } from "../lib/stationConfig";
import { stationKey, type StationRef } from "../lib/stations";
import MessageRow from "./MessageRow";

function previewLine(body: string, max = 140): string {
  const flat = body.replace(/https?:\/\/\S+/g, "").replace(/\s+/g, " ").trim();
  if (flat.length <= max) return flat;
  return flat.slice(0, max - 1) + "…";
}

export default function PinnedBanner(props: {
  station: StationRef;
  open: boolean;
  onToggle: () => void;
  onClose: () => void;
}) {
  const rawPinnedIds = () => stationConfigs[stationKey(props.station)]?.config.pinned ?? [];

  // Drop ids confirmed missing; keep in-flight ids so UI can render "loading…".
  const pinnedIds = createMemo(() => {
    const missing = missingPinIds();
    return rawPinnedIds().filter((id) => eventMap[id] || !missing.has(id));
  });

  const sortedEntries = createMemo(() => {
    const ids = pinnedIds();
    const resolved = ids.map((id) => ({ id, event: eventMap[id] }));
    return resolved.sort((a, b) => {
      if (a.event && b.event) return b.event.created_at - a.event.created_at;
      if (a.event) return -1;
      if (b.event) return 1;
      return 0;
    });
  });

  const latest = () => sortedEntries()[0];
  const moreCount = () => Math.max(0, pinnedIds().length - 1);

  onMount(() => {
    function onKey(e: KeyboardEvent) {
      if (!props.open) return;
      if (e.key === "Escape") props.onClose();
    }
    function onDocClick(e: MouseEvent) {
      if (!props.open) return;
      const t = e.target as HTMLElement | null;
      if (!t) return;
      if (t.closest(".pinned-banner-wrap")) return;
      props.onClose();
    }
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDocClick);
    onCleanup(() => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDocClick);
    });
  });

  return (
    <Show when={pinnedIds().length > 0}>
      <div class="pinned-banner-wrap">
        <button
          type="button"
          class={`pinned-banner ${props.open ? "open" : ""}`}
          onClick={props.onToggle}
          aria-haspopup="dialog"
          aria-expanded={props.open}
        >
          <span class="pinned-banner-icon" aria-hidden="true">📌 PINNED</span>
          <span class="pinned-banner-body">
            <Show
              when={latest()?.event}
              fallback={<span class="pinned-banner-pending">loading pinned message…</span>}
            >
              {(ev) => (
                <span class="pinned-banner-text">{previewLine(ev().content)}</span>
              )}
            </Show>
          </span>
          <Show when={moreCount() > 0}>
            <span class="pinned-banner-more">+{moreCount()}</span>
          </Show>
        </button>

        <Show when={props.open}>
          <div class="pinned-drawer" role="dialog" aria-label="Pinned messages">
            <div class="pinned-drawer-head">
              <span class="pinned-drawer-title">Pinned</span>
              <span class="pinned-drawer-count">{pinnedIds().length}</span>
            </div>
            <div class="pinned-drawer-list">
              <For each={sortedEntries()}>
                {(entry) => (
                  <Show
                    when={entry.event}
                    fallback={
                      <div class="pinned-item-pending">
                        <span class="pinned-item-pending-dot" />
                        <span>loading…</span>
                      </div>
                    }
                  >
                    {(ev) => <MessageRow event={ev()} showMeta={true} showTail={false} />}
                  </Show>
                )}
              </For>
            </div>
          </div>
        </Show>
      </div>
    </Show>
  );
}
