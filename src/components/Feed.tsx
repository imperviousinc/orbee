import { createSignal, createEffect, createMemo, onMount, onCleanup, For, Show } from "solid-js";
import { createVirtualizer } from "@tanstack/solid-virtual";
import type { NostrEvent } from "../lib/keys";
import { getSigner } from "../lib/auth";
import { getRelay } from "../lib/nostr";
import type { StationRef } from "../lib/stations";
import { stationKey } from "../lib/stations";
import {
  requestReactions,
  hydrateReactionsFromEvents,
  markReactionsKnown,
} from "../lib/reactions";
import {
  loadCachedProfiles,
  requestProfiles,
  displayName,
  refreshStaleProfiles,
  profiles,
} from "../lib/profiles";
import { onLiveMessage } from "../lib/verify";
import { requestStats } from "../lib/stats";
import { registerEvent } from "../lib/replyState";
import StationScope from "./StationScope";
import { subscribeTyping, unsubscribeTyping, getTypingPubkeys, clearTypingForUser, typingVersion } from "../lib/typing";
import {
  loadCachedMessages,
  saveCachedMessages,
  newestCachedTs,
  oldestCachedTs,
  pruneOldMessages,
  loadCachedReactions,
  pruneOldReactions,
  recordRecentMessage,
  recordRecentMessages,
  recordRecentReactions,
  getRowHeight,
  recordRowHeight,
} from "../lib/messageCache";
import MessageGroup from "./MessageGroup";
import FloatingAvatar from "./FloatingAvatar";
import { IconArrowDown } from "./icons";

// Diagnostic instrumentation. Toggle from the browser console:
//   __feedDbg(true) | __feedDbg(false) | __feedDbg("dump") | __feedDbg("clear")
const FEED_LOG_CAP = 500;
let feedPhase = "idle";
let feedPhaseStartedAt = 0;
const g = globalThis as any;

function feedDbg(kind: string, detail: Record<string, unknown>) {
  if (!g.__feedDebug) return;
  const entry = {
    t: Math.round(performance.now() - feedPhaseStartedAt),
    phase: feedPhase,
    kind,
    ...detail,
  };
  const log = g.__feedLog ?? (g.__feedLog = []);
  log.push(entry);
  if (log.length > FEED_LOG_CAP) log.splice(0, log.length - FEED_LOG_CAP);
  console.log("[feed]", entry);
}

function setFeedPhase(phase: string) {
  if (!g.__feedDebug) return;
  feedPhase = phase;
  feedPhaseStartedAt = performance.now();
  feedDbg("phase", {});
}

console.log("[feed] module loaded; call __feedDbg(true) to enable instrumentation");

g.__feedDbg = (arg?: boolean | "dump" | "clear") => {
  if (arg === "dump") {
    console.table(g.__feedLog ?? []);
    return;
  }
  if (arg === "clear") {
    g.__feedLog = [];
    return "cleared";
  }
  const enable = arg !== false;
  g.__feedDebug = enable;
  if (enable) g.__feedLog = [];
  console.log(`[feed] debug ${enable ? "ON" : "OFF"}`);
  return enable ? "on" : "off";
};

// Group consecutive same-author messages within this window under one avatar.
const GROUP_WINDOW_SECONDS = 300;

// Per-bubble dimension estimates used before the virtualizer measures a row.
// Biased generous so first paint never under-estimates (which would cause
// absolute-positioned rows to visually stack).
const EST_CHARS_PER_LINE = 52;
const EST_LINE_PX = 22;
const EST_BUBBLE_PADDING_PX = 18;
const EST_META_ROW_PX = 22;
// Must match .msg-group CSS: padding: 6px 20px 10px → 16px total vertical.
const EST_GROUP_PADDING_PX = 16;

// Must match .day-sep CSS min-height so the virtualizer spacer doesn't wobble.
const SEP_HEIGHT_PX = 45;

function estimateGroupHeight(events: NostrEvent[]): number {
  let h = EST_GROUP_PADDING_PX + EST_META_ROW_PX;
  for (const e of events) {
    const lines = Math.max(1, Math.ceil(e.content.length / EST_CHARS_PER_LINE));
    h += lines * EST_LINE_PX + EST_BUBBLE_PADDING_PX;
  }
  return h;
}

const HYDRATE_LIMIT = 200;
const PAGE_SIZE = 100;


let _feedMountCount = 0;

export default function Feed(props: {
  station: StationRef | null;
  onEventsChange?: (events: NostrEvent[]) => void;
  /** True when this Feed is the one currently visible to the user.
   *  In the keep-alive pool, all joined-station Feeds stay mounted
   *  (to keep subs + virtualizer state alive for instant switching)
   *  but only the visible one should publish its events upward. */
  visible?: boolean;
}) {
  const mountNo = ++_feedMountCount;
  feedDbg("feed-mount", { mountNo, station: props.station?.id });
  const [events, setEvents] = createSignal<NostrEvent[]>([]);
  const [loading, setLoading] = createSignal(true);

  const TUNING_MIN_MS = 280;
  const TUNING_MAX_MS = 900;
  const [tuningHold, setTuningHold] = createSignal(false);
  const [tuningExpired, setTuningExpired] = createSignal(false);
  let tuningMinTimer: number | null = null;
  let tuningMaxTimer: number | null = null;
  function clearTuningTimers() {
    if (tuningMinTimer !== null) { clearTimeout(tuningMinTimer); tuningMinTimer = null; }
    if (tuningMaxTimer !== null) { clearTimeout(tuningMaxTimer); tuningMaxTimer = null; }
  }
  function triggerTuningHold() {
    clearTuningTimers();
    setTuningHold(true);
    setTuningExpired(false);
    tuningMinTimer = window.setTimeout(() => { setTuningHold(false); tuningMinTimer = null; }, TUNING_MIN_MS);
    tuningMaxTimer = window.setTimeout(() => { setTuningExpired(true); tuningMaxTimer = null; }, TUNING_MAX_MS);
  }
  onCleanup(clearTuningTimers);

  const isTuning = createMemo(() => {
    if (!props.station) return false;
    if (tuningExpired()) return false;
    return loading() || tuningHold();
  });

  // Toggle .is-tuning on .app-grid so the viewport-level backdrop fades in.
  createEffect(() => {
    const el = document.querySelector(".app-grid");
    if (!el) return;
    if (isTuning()) el.classList.add("is-tuning");
    else el.classList.remove("is-tuning");
  });
  onCleanup(() => {
    document.querySelector(".app-grid")?.classList.remove("is-tuning");
  });
  const [loadingOlder, setLoadingOlder] = createSignal(false);
  const [hasMoreHistory, setHasMoreHistory] = createSignal(true);

  let subId: string | null = null;
  let activeRelay: ReturnType<typeof getRelay> | null = null;
  let messagesEnd: HTMLDivElement | undefined;
  let scrollContainer: HTMLDivElement | undefined;
  let messagesVirtual: HTMLDivElement | undefined;
  const seen = new Set<string>();
  const [newBelow, setNewBelow] = createSignal(0);
  let wasAtBottom = true;
  const [scrolledUp, setScrolledUp] = createSignal(false);

  // Viewport bottom in the spacer's local coordinate space (px from top of
  // `.messages-virtual`). Drives FloatingAvatar pin position.
  const [visibleBottomY, setVisibleBottomY] = createSignal(0);

  function updateVisibleBottom() {
    if (!scrollContainer || !messagesVirtual) return;
    const cRect = scrollContainer.getBoundingClientRect();
    const sRect = messagesVirtual.getBoundingClientRect();
    const next = cRect.bottom - sRect.top;
    if (next === visibleBottomY()) return;
    setVisibleBottomY(next);
  }

  function isScrolledToBottom(): boolean {
    if (!scrollContainer) return true;
    const { scrollTop, scrollHeight, clientHeight } = scrollContainer;
    return scrollHeight - scrollTop - clientHeight < 80;
  }

  // Looser threshold (6 viewports) for the "Jump to present" pill.
  function isFarFromBottom(): boolean {
    if (!scrollContainer) return false;
    const { scrollTop, scrollHeight, clientHeight } = scrollContainer;
    return scrollHeight - scrollTop - clientHeight > clientHeight * 6;
  }

  /** Reject events whose `h` tag doesn't match the station. Invariant: an
   *  event from station A must never appear in station B's view. */
  function eventBelongsTo(event: NostrEvent, station: StationRef): boolean {
    const h = event.tags.find((t) => t[0] === "h")?.[1];
    if (h === station.id) return true;
    console.warn(
      `[feed-leak] dropped event ${event.id.slice(0, 12)} ` +
      `with h="${h ?? "(none)"}" - feed is showing "${station.id}". ` +
      `Likely an orphaned sub callback or relay filter slip.`,
    );
    return false;
  }

  function scrollToBottom() {
    // Instant only: smooth scroll lands stale when the spacer is still
    // growing from concurrent hydration.
    setTimeout(() => {
      messagesEnd?.scrollIntoView({ block: "end" });
    }, 30);
  }

  /** Add one event from the live subscription. Two gates: event must carry
   *  the station's `h` tag, and the Feed must currently show that same
   *  station (orphaned-sub-callback guard). */
  function addLiveEvent(event: NostrEvent, station: StationRef) {
    if (!eventBelongsTo(event, station)) return;
    const cur = props.station;
    if (!cur || cur.id !== station.id || cur.relay !== station.relay) return;
    if (seen.has(event.id)) return;
    seen.add(event.id);
    registerEvent(event);

    const wasAtBottom = isScrolledToBottom();

    setEvents((prev) => {
      const next = [...prev, event];
      next.sort((a, b) => a.created_at - b.created_at);
      return next;
    });

    if (wasAtBottom) {
      scrollToBottom();
    } else {
      setNewBelow((n) => n + 1);
    }

    saveCachedMessages(station, [event]).catch((e) =>
      console.warn("[cache] save live event failed:", e),
    );
    recordRecentMessage(station, event);
  }

  /** Bulk insert from IDB hydration on station switch. Always pins to bottom. */
  function ingestBulk(batch: NostrEvent[], station: StationRef) {
    if (batch.length === 0) return;
    // Cache-pollution defense: drop cached events without the station's `h` tag.
    const fresh: NostrEvent[] = [];
    for (const e of batch) {
      if (!eventBelongsTo(e, station)) continue;
      if (seen.has(e.id)) continue;
      seen.add(e.id);
      registerEvent(e);
      fresh.push(e);
    }
    if (fresh.length === 0) return;

    const sc = scrollContainer;
    const wasBottom = sc
      ? (sc.scrollHeight - sc.scrollTop - sc.clientHeight) < 80
      : true;

    setEvents((prev) => {
      const next = [...prev, ...fresh];
      next.sort((a, b) => a.created_at - b.created_at);
      return next;
    });

    // CRITICAL: queueMicrotask runs after Solid's DOM commit but BEFORE paint.
    // rAF would fire after paint, producing one frame of wrong position.
    queueMicrotask(() => {
      if (!sc) return;
      if (wasBottom) {
        sc.scrollTop = sc.scrollHeight;
        feedDbg("ingest-pin", { sh: sc.scrollHeight, st: sc.scrollTop });
      }
    });
  }

  // Register live-event sink in a station-keyed map (keep-alive pool support).
  if (props.station) {
    const key = stationKey(props.station);
    const s = props.station;
    const adder = (event: NostrEvent) => {
      addLiveEvent(event, s);
      scrollToBottom();
    };
    const reg = ((window as any).__spacesFeedAdders ||= {} as Record<string, (e: NostrEvent) => void>);
    reg[key] = adder;
    onCleanup(() => {
      if (reg[key] === adder) delete reg[key];
    });
  }

  (window as any).__spacesFeedAdd = (event: NostrEvent) => {
    const s = props.station;
    if (!s) return;
    addLiveEvent(event, s);
    scrollToBottom();
  };

  (window as any).__spacesFeedRemove = (eventId: string) => {
    seen.delete(eventId);
    setEvents((prev) => prev.filter((e) => e.id !== eventId));
  };

  /** Pull older history: cache first, then relay with `until: oldest`. */
  async function loadOlder() {
    const s = props.station;
    if (!s || loadingOlder() || !hasMoreHistory()) return;
    const current = events();
    if (current.length === 0) return;
    const oldest = current[0].created_at;

    setLoadingOlder(true);
    try {
      const fromCache = await loadCachedMessages(s, {
        until: oldest,
        limit: PAGE_SIZE,
      });
      if (fromCache.length > 0) {
        prependBatch(fromCache, s);
        setLoadingOlder(false);
        return;
      }

      const relay = getRelay(s.relay);
      await relay.connect();
      const collected: NostrEvent[] = [];
      await new Promise<void>((resolve) => {
        const id = relay.subscribe(
          { "#h": [s.id], kinds: [9], until: oldest, limit: PAGE_SIZE },
          (event) => collected.push(event),
          () => {
            relay.unsubscribe(id);
            resolve();
          },
        );
      });
      if (props.station !== s) return;
      if (collected.length === 0) {
        setHasMoreHistory(false);
      } else {
        await saveCachedMessages(s, collected);
        if (props.station !== s) return;
        prependBatch(collected, s);
        if (collected.length < PAGE_SIZE) setHasMoreHistory(false);
      }
    } catch (e) {
      console.warn("[feed] loadOlder failed:", e);
    } finally {
      setLoadingOlder(false);
    }
  }

  /** Prepend older events while preserving the user's visual scroll position.
   *  Bails if station switched mid-flight (cross-contamination guard). */
  function prependBatch(batch: NostrEvent[], station: StationRef) {
    const cur = props.station;
    if (!cur || cur.id !== station.id || cur.relay !== station.relay) {
      feedDbg("prepend-bail", { expected: station.id, got: cur?.id ?? "(none)" });
      return;
    }
    const fresh: NostrEvent[] = [];
    for (const e of batch) {
      if (!eventBelongsTo(e, station)) continue;
      if (seen.has(e.id)) continue;
      seen.add(e.id);
      registerEvent(e);
      fresh.push(e);
    }
    feedDbg("prepend-start", {
      fresh: fresh.length,
      sh: scrollContainer?.scrollHeight,
      st: scrollContainer?.scrollTop,
    });
    if (fresh.length === 0) return;

    const sc = scrollContainer;
    const prevScrollHeight = sc?.scrollHeight ?? 0;
    const prevScrollTop = sc?.scrollTop ?? 0;

    setEvents((prev) => {
      const next = [...fresh, ...prev];
      next.sort((a, b) => a.created_at - b.created_at);
      return next;
    });

    // After commit, compensate for the height delta to keep the viewport stable.
    requestAnimationFrame(() => {
      if (!sc) return;
      const delta = sc.scrollHeight - prevScrollHeight;
      const before = sc.scrollTop;
      sc.scrollTop = prevScrollTop + delta;
      feedDbg("prepend-compensate", {
        sh: sc.scrollHeight, prevSh: prevScrollHeight, delta,
        stBefore: before, stAfter: sc.scrollTop, expected: prevScrollTop + delta,
      });
    });

    requestProfiles([...new Set(fresh.map((e) => e.pubkey))]);
    if (props.station) requestReactions(fresh.map((e) => e.id), props.station);
  }

  let _effectRun = 0;
  createEffect(() => {
    const s = props.station;
    _effectRun++;
    console.log("[feed/effect]", { station: s?.id ?? "(none)", relay: s?.relay, run: _effectRun });
    setFeedPhase("station-switch");
    feedDbg("station", { id: s?.id ?? "(none)", effectRun: _effectRun, mountNo });

    if (subId && activeRelay) activeRelay.unsubscribe(subId);
    subId = null;
    activeRelay = null;
    seen.clear();
    setHasMoreHistory(true);

    if (!s) {
      setEvents([]);
      setLoading(false);
      return;
    }

    triggerTuningHold();

    wasAtBottom = true;
    setScrolledUp(false);
    setEvents([]);
    setLoading(true);
    setFeedPhase("loader-on");

    // IIFE so createEffect tracks props.station synchronously (no await).
    (async () => {
      pruneOldMessages(s).catch(() => {});
      pruneOldReactions(s).catch(() => {});

      // Hydrate messages + reactions + profiles in parallel before ingest so
      // the first render of every bubble has chips and display names ready.
      const [cached, cachedReactions] = await Promise.all([
        loadCachedMessages(s, { limit: HYDRATE_LIMIT }),
        loadCachedReactions(s, { limit: HYDRATE_LIMIT * 5 }),
        loadCachedProfiles(),
      ]);
      console.log("[feed/hydrated]", { id: s.id, cached: cached.length });
      if (props.station !== s) {
        console.log("[feed/bail] station changed during hydrate", { expected: s.id, got: props.station?.id });
        return;
      }
      hydrateReactionsFromEvents(cachedReactions);
      recordRecentMessages(s, cached);
      recordRecentReactions(s, cachedReactions);
      markReactionsKnown(cached.map((e) => e.id));
      ingestBulk(cached, s);
      setLoading(false);
      setFeedPhase("post-idb");
      feedDbg("ingest", { count: cached.length });

      // Live sub only needs events newer than the newest cached one.
      const newest = await newestCachedTs(s);
      if (props.station !== s) {
        console.log("[feed/bail] station changed before newest-ts");
        return;
      }

      activeRelay = getRelay(s.relay);
      await activeRelay.connect();
      if (props.station !== s) {
        console.log("[feed/bail] station changed during connect", { relay: s.relay });
        return;
      }
      console.log("[feed/connected]", { relay: s.relay, id: s.id, newest });

      let gotEose = false;
      const batchPubkeys: string[] = [];
      const batchEventIds: string[] = [];

      const filter: Record<string, unknown> = {
        "#h": [s.id],
        kinds: [9],
        limit: HYDRATE_LIMIT,
      };
      if (newest !== null) filter.since = newest + 1;

      console.log("[feed/subscribe]", { relay: s.relay, id: s.id, filter });

      subId = activeRelay.subscribe(
        filter as any,
        (event) => {
          console.log("[feed/event]", {
            kind: event.kind,
            id: event.id.slice(0, 10),
            pubkey: event.pubkey.slice(0, 10),
            content: event.content.slice(0, 40),
            h: event.tags.find((t: string[]) => t[0] === "h")?.[1],
          });
          addLiveEvent(event, s);
          if (!gotEose) {
            batchPubkeys.push(event.pubkey);
            batchEventIds.push(event.id);
          } else {
            requestProfiles([event.pubkey]);
            requestReactions([event.id], s);
            // Drop their typing entry immediately rather than waiting on TYPING_TIMEOUT.
            clearTypingForUser(s, event.pubkey);
            const handle = profiles[event.pubkey]?.handle;
            if (handle) onLiveMessage(event.pubkey, handle);
          }
        },
        () => {
          console.log("[feed/eose]", { id: s.id, livePreEose: batchEventIds.length });
          gotEose = true;
          setLoading(false);
          setFeedPhase("post-eose");
          feedDbg("eose", { livePreEose: batchEventIds.length });

          const uniquePubkeys = [...new Set(batchPubkeys)];
          requestProfiles(uniquePubkeys);
          requestStats(batchEventIds);
          requestReactions(batchEventIds, s);
          setTimeout(refreshStaleProfiles, 5000);

          if (cached.length === 0) scrollToBottom();

          subscribeTyping(s, getSigner().pubkey);
        },
      );

      // Background refresh for cached events to pick up stale display names.
      if (cached.length > 0) {
        requestProfiles([...new Set(cached.map((e) => e.pubkey))]);
        requestReactions(cached.map((e) => e.id), s);
      }
    })();
  });

  // Only the visible Feed publishes events upward (keep-alive pool guard).
  createEffect(() => {
    if (props.visible === false) return;
    props.onEventsChange?.(events());
  });

  // Bucket consecutive same-author messages within GROUP_WINDOW_SECONDS.
  const messageGroups = createMemo<NostrEvent[][]>(() => {
    const out: NostrEvent[][] = [];
    let current: NostrEvent[] = [];
    let last: NostrEvent | null = null;
    for (const e of events()) {
      if (
        last &&
        last.pubkey === e.pubkey &&
        e.created_at - last.created_at < GROUP_WINDOW_SECONDS
      ) {
        current.push(e);
      } else {
        if (current.length) out.push(current);
        current = [e];
      }
      last = e;
    }
    if (current.length) out.push(current);
    return out;
  });

  type FeedItem =
    | { kind: "sep"; label: string; ts: number }
    | { kind: "group"; events: NostrEvent[] };

  function dayKeyOf(tsSec: number): string {
    const d = new Date(tsSec * 1000);
    return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
  }
  function dayLabelOf(tsSec: number): string {
    const d = new Date(tsSec * 1000);
    const now = new Date();
    const todayKey = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}`;
    const yesterday = new Date(now.getTime() - 86_400_000);
    const yKey = `${yesterday.getFullYear()}-${yesterday.getMonth()}-${yesterday.getDate()}`;
    const dKey = dayKeyOf(tsSec);
    if (dKey === todayKey) return "Today";
    if (dKey === yKey) return "Yesterday";
    if (d.getFullYear() === now.getFullYear()) {
      return d.toLocaleDateString([], { month: "long", day: "numeric" });
    }
    return d.toLocaleDateString([], { year: "numeric", month: "long", day: "numeric" });
  }

  const renderItems = createMemo<FeedItem[]>(() => {
    const out: FeedItem[] = [];
    let lastDay = "";
    for (const group of messageGroups()) {
      const ts = group[0].created_at;
      const day = dayKeyOf(ts);
      if (day !== lastDay) {
        out.push({ kind: "sep", label: dayLabelOf(ts), ts });
        lastDay = day;
      }
      out.push({ kind: "group", events: group });
    }
    return out;
  });

  // Avatars live in a sibling overlay (FloatingAvatar), not inside virtual
  // rows, to avoid `position: sticky` quirks within absolute ancestors.
  const rowVirtualizer = createVirtualizer({
    get count() {
      return renderItems().length;
    },
    getScrollElement: () => scrollContainer ?? null,
    // When at the bottom, suppress TanStack's auto-scroll-adjustment - its
    // internal scrollOffset lags our scrollIntoView and would park the user
    // mid-feed. virtualRo handles bottom pinning instead. When reading
    // history we let it through to keep visible items anchored.
    scrollToFn: (offset, { adjustments = 0, behavior }, instance) => {
      const el = instance.scrollElement as HTMLElement | null;
      if (!el) return;
      const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
      if (distFromBottom < 80) return;
      el.scrollTo?.({ top: offset + adjustments, behavior });
    },
    // Option exists on the Virtualizer class at runtime but is missing from
    // VirtualizerOptions typings (library declaration bug).
    // @ts-expect-error  see comment above
    shouldAdjustScrollPositionOnItemSizeChange: () => {
      const el = scrollContainer;
      if (!el) return false;
      return (el.scrollHeight - el.scrollTop - el.clientHeight) >= 80;
    },
    estimateSize: (index) => {
      const it = renderItems()[index];
      if (!it) return 80;
      if (it.kind === "sep") return SEP_HEIGHT_PX;
      const cached = getRowHeight(it.events[0].id);
      if (cached) return cached;
      return estimateGroupHeight(it.events);
    },
    overscan: 6,
    getItemKey: (index) => {
      const it = renderItems()[index];
      if (!it) return `__idx_${index}`;
      return it.kind === "sep" ? `sep_${it.ts}` : it.events[0].id;
    },
    measureElement: (el, entry) => {
      const size = entry?.borderBoxSize?.[0]?.blockSize
        ?? el.getBoundingClientRect().height;
      if (size > 0) {
        const idx = Number(el.getAttribute("data-index"));
        if (Number.isFinite(idx)) {
          const it = renderItems()[idx];
          if (it && it.kind === "group") {
            const key = it.events[0].id;
            const rounded = Math.round(size);
            const prev = getRowHeight(key);
            if (prev === undefined) {
              const est = estimateGroupHeight(it.events);
              feedDbg("row-first", {
                k: key.slice(0, 10),
                size: rounded,
                est,
                vsEst: rounded - est,
                preview: it.events[0].content.slice(0, 32),
              });
            } else if (prev !== rounded) {
              feedDbg("row-delta", {
                k: key.slice(0, 10),
                prev,
                size: rounded,
                delta: rounded - prev,
                preview: it.events[0].content.slice(0, 32),
              });
            }
            recordRowHeight(key, size);
          }
        }
      }
      if (size === 0) {
        const idx = Number(el.getAttribute("data-index"));
        const it = Number.isFinite(idx) ? renderItems()[idx] : undefined;
        if (it) {
          if (it.kind === "sep") return SEP_HEIGHT_PX;
          const cached = getRowHeight(it.events[0].id);
          if (cached) return cached;
        }
        return 80;
      }
      // Force separator constant to avoid sub-pixel measurement wobble.
      const idx = Number(el.getAttribute("data-index"));
      if (Number.isFinite(idx)) {
        const it = renderItems()[idx];
        if (it && it.kind === "sep") return SEP_HEIGHT_PX;
      }
      return size;
    },
  });

  // Hidden tabs return 0 from getBoundingClientRect; remeasure on
  // visibilitychange to recover collapsed-spacer state.
  onMount(() => {
    if (!scrollContainer) return;
    const ro = new ResizeObserver(() => {
      updateVisibleBottom();
      remeasureAllRows();
    });
    ro.observe(scrollContainer);

    // When the virtual spacer grows due to late measurements, re-pin to
    // bottom in the same frame iff the user was there.
    let lastVirtualHeight = 0;
    const virtualRo = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const h = entry.contentRect.height;
      const grew = h > lastVirtualHeight;
      const delta = Math.round(h - lastVirtualHeight);
      if (delta !== 0) {
        feedDbg("spacer", {
          prev: Math.round(lastVirtualHeight),
          size: Math.round(h),
          delta,
          atBottom: wasAtBottom,
          rePinned: !!(grew && wasAtBottom && messagesEnd),
        });
      }
      lastVirtualHeight = h;
      if (grew && wasAtBottom && messagesEnd) {
        messagesEnd.scrollIntoView({ block: "end" });
      }
      updateVisibleBottom();
    });

    function attachVirtualRo() {
      if (messagesVirtual) {
        lastVirtualHeight = messagesVirtual.getBoundingClientRect().height;
        virtualRo.observe(messagesVirtual);
      }
    }
    attachVirtualRo();
    // messagesVirtual is conditionally rendered; re-attach when it appears.
    createEffect(() => {
      events();
      if (messagesVirtual && lastVirtualHeight === 0) attachVirtualRo();
    });

    function onVisibilityChange() {
      if (document.hidden) return;
      remeasureAllRows();
      updateVisibleBottom();
    }
    document.addEventListener("visibilitychange", onVisibilityChange);

    requestAnimationFrame(() => {
      remeasureAllRows();
      updateVisibleBottom();
    });

    onCleanup(() => {
      ro.disconnect();
      virtualRo.disconnect();
      document.removeEventListener("visibilitychange", onVisibilityChange);
    });
  });

  function remeasureAllRows() {
    if (!scrollContainer) return;
    scrollContainer
      .querySelectorAll<HTMLElement>(".messages-virtual > div[data-index]")
      .forEach((el) => rowVirtualizer.measureElement(el));
  }

  // Remeasure after appends so estimate-height rows correct before paint.
  let prevEventCount = 0;
  createEffect(() => {
    const count = events().length;
    if (count > prevEventCount) {
      prevEventCount = count;
      requestAnimationFrame(() => remeasureAllRows());
    } else {
      prevEventCount = count;
    }
  });

  // typingVersion() re-evaluates on any mutation; typingTick is a 500ms
  // poll so entries drop after TYPING_TIMEOUT (store doesn't self-invalidate).
  const [typingTick, setTypingTick] = createSignal(0);
  const typingInterval = setInterval(() => setTypingTick(t => t + 1), 500);

  const typingNames = () => {
    typingVersion();
    typingTick();
    return getTypingPubkeys(props.station).map(pk => displayName(pk));
  };

  onCleanup(() => {
    if (subId && activeRelay) activeRelay.unsubscribe(subId);
    // Tear down only this station's typing sub - other keep-alive Feeds need theirs.
    unsubscribeTyping(props.station);
    clearInterval(typingInterval);
  });

  function handleScroll() {
    updateVisibleBottom();
    wasAtBottom = isScrolledToBottom();
    setScrolledUp(isFarFromBottom());
    if (wasAtBottom) setNewBelow(0);
    if (
      scrollContainer &&
      scrollContainer.scrollTop < 200 &&
      hasMoreHistory() &&
      !loadingOlder() &&
      events().length > 0
    ) {
      feedDbg("load-older-trigger", {
        st: scrollContainer.scrollTop,
        sh: scrollContainer.scrollHeight,
      });
      loadOlder();
    }
  }

  function jumpToBottom() {
    setNewBelow(0);
    if (!scrollContainer) return;
    // Instant + repeat across frames: virtualizer measurements grow the
    // spacer mid-scroll, so smooth scrolls land short.
    scrollContainer.scrollTop = scrollContainer.scrollHeight;
    let frames = 0;
    function repin() {
      if (!scrollContainer) return;
      scrollContainer.scrollTop = scrollContainer.scrollHeight;
      if (++frames < 6) requestAnimationFrame(repin);
    }
    requestAnimationFrame(repin);
  }

  // Suppress unused-import lint until a "load history from cache" affordance lands.
  void oldestCachedTs;

  return (
    <>
    <div class={`feed-stage ${isTuning() ? "is-tuning" : ""}`}>
    <Show when={isTuning()}>
      <div class="feed-fallback feed-tuning">
        <div class="feed-tuning-scope">
          <StationScope
            stationId={props.station!.id}
            relay={props.station!.relay}
            size={140}
            animated
            accent
            bare
          />
        </div>
        <div class="feed-tuning-label">TUNING IN</div>
      </div>
    </Show>

    <div class="messages" ref={scrollContainer} onScroll={handleScroll}>
      <Show when={!props.station}>
        <div class="feed-fallback feed-empty">
          <div class="feed-empty-title">No station tuned in</div>
          <div class="feed-empty-text">
            Use the dial in the stations rail to tune to an existing frequency,
            or mint a new one to start broadcasting.
          </div>
        </div>
      </Show>

      <Show when={props.station && !isTuning() && events().length === 0}>
        <div class="feed-fallback feed-empty">
          <div class="feed-empty-title">Quiet on this frequency</div>
          <div class="feed-empty-text">No transmissions yet - be the first to broadcast.</div>
        </div>
      </Show>

      <div class="feed-content">

      <Show when={events().length > 0}>
        <div
          class="messages-virtual"
          ref={(el) => {
            messagesVirtual = el;
            // Compute visibleBottom on spacer mount so FloatingAvatar's
            // first render has a real value (avoids an extra repaint).
            updateVisibleBottom();
          }}
          style={{
            position: "relative",
            height: `${rowVirtualizer.getTotalSize()}px`,
            width: "100%",
          }}
        >
          <For each={rowVirtualizer.getVirtualItems()}>
            {(vi) => {
              const item = () => (vi ? renderItems()[vi.index] : undefined);
              return (
                <Show when={vi && item()}>
                  <div
                    ref={(el) => {
                      el.setAttribute("data-index", String(vi.index));
                      rowVirtualizer.measureElement(el);
                    }}
                    style={{
                      position: "absolute",
                      top: "0",
                      left: "0",
                      width: "100%",
                      transform: `translateY(${vi.start}px)`,
                    }}
                  >
                    <Show
                      when={item()!.kind === "group"}
                      fallback={
                        <div class="day-sep">
                          <div class="day-sep-line" />
                          <div class="day-sep-text">{(item() as { label: string }).label}</div>
                          <div class="day-sep-line" />
                        </div>
                      }
                    >
                      {(() => {
                        const g = (item() as { events: NostrEvent[] }).events;
                        return <MessageGroup events={g} id={g[0].id} />;
                      })()}
                    </Show>
                  </div>
                </Show>
              );
            }}
          </For>

          {/* Floating avatar overlay - sibling of bubble rows (not child),
              to recreate sticky-avatar behavior outside an absolute ancestor. */}
          <For each={rowVirtualizer.getVirtualItems()}>
            {(vi) => {
              const item = () => (vi ? renderItems()[vi.index] : undefined);
              return (
                <Show when={vi && item()?.kind === "group"}>
                  <FloatingAvatar
                    pubkey={(item() as { events: NostrEvent[] }).events[0].pubkey}
                    groupStart={vi.start}
                    groupEnd={vi.start + vi.size}
                    visibleBottom={visibleBottomY()}
                  />
                </Show>
              );
            }}
          </For>
        </div>
      </Show>
      </div>

      <div ref={messagesEnd} />
    </div>
    </div>

    <Show when={newBelow() > 0 || scrolledUp()}>
      <button class="new-below-pill" onClick={jumpToBottom}>
        <IconArrowDown />
        <Show
          when={newBelow() > 0}
          fallback={<span>Jump to present</span>}
        >
          <span>{newBelow()} new message{newBelow() === 1 ? "" : "s"}</span>
        </Show>
      </button>
    </Show>

    <div class="typing-bar">
      <Show when={typingNames().length > 0}>
        <span class="typing-dots">
          <span /><span /><span />
        </span>
        <span>
          <span class="typing-names">{typingNames().join(", ")}</span>
          {" " + (typingNames().length === 1 ? "is" : "are") + " typing…"}
        </span>
      </Show>
    </div>
    </>
  );
}
