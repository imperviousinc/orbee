import { For, Show, onMount, onCleanup, createSignal } from "solid-js";
import type { Signer } from "../lib/signer";
import { displayName, identityParts } from "../lib/profiles";
import {
  stations,
  stationKey,
  type StationRef,
} from "../lib/stations";
import { stationActivity, sortedJoinedStations } from "../lib/stationActivity";
import SpacesLogo from "./SpacesLogo";
import StationScope from "./StationScope";
import { sidebarWidth, setSidebarWidth } from "../lib/sidebarState";
import { isRelayConnected } from "../lib/nostr";

export default function LeftSidebar(props: {
  signer: Signer;
  activeStation: StationRef | null;
  onSelectStation: (s: StationRef) => void;
  onNewStation: () => void;
  onEditProfile: () => void;
  onOpenBackup: () => void;
  onLogout: () => void;
  open?: boolean;
  onClose?: () => void;
}) {
  const [opMenuOpen, setOpMenuOpen] = createSignal(false);

  const storedHandle = () => displayName(props.signer.pubkey);

  // display_name → handle → truncated npub.
  const opBarTitle = () => {
    const parts = identityParts(props.signer.pubkey);
    return parts.secondary || parts.primary;
  };

  onMount(() => {
    function onDocClick(e: MouseEvent) {
      if (!opMenuOpen()) return;
      const t = e.target as HTMLElement;
      if (!t.closest(".op-bar") && !t.closest(".op-menu")) {
        setOpMenuOpen(false);
      }
    }
    document.addEventListener("click", onDocClick);
    onCleanup(() => document.removeEventListener("click", onDocClick));
  });

  const stationLabel = (s: StationRef) =>
    stations[stationKey(s)]?.name || s.id;

  const isActive = (s: StationRef) => {
    const a = props.activeStation;
    return !!a && a.id === s.id && a.relay === s.relay;
  };

  // Shared with the keyboard cycler so visible order = cycle order.
  const storedRefs = sortedJoinedStations;

  // Listeners on `document` so the drag keeps tracking outside the 6px hit-zone.
  function onResizeStart(e: MouseEvent) {
    e.preventDefault();
    const startX = e.clientX;
    const startW = sidebarWidth();
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    function onMove(ev: MouseEvent) {
      const dx = ev.clientX - startX;
      setSidebarWidth(startW + dx);
    }
    function onUp() {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    }
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }

  return (
    <div class={`sidebar ${props.open ? "open" : ""}`}>

      <div class="op-bar-wrap">
        <button
          type="button"
          class={`op-bar ${opMenuOpen() ? "open" : ""}`}
          onClick={(e) => { e.stopPropagation(); setOpMenuOpen(!opMenuOpen()); }}
          aria-haspopup="menu"
          aria-expanded={opMenuOpen()}
          data-label={storedHandle()}
        >
          <SpacesLogo size={48} pubkey={props.signer.pubkey} />
          <div class="op-ident-meta">
            <div class="op-ident-handle">{opBarTitle()}</div>
          </div>
        </button>
        <Show when={opMenuOpen()}>
          <div class="op-menu" role="menu" onClick={(e) => e.stopPropagation()}>
            <button
              class="op-menu-item"
              role="menuitem"
              onClick={() => { setOpMenuOpen(false); props.onEditProfile(); }}
            >
              Edit profile
            </button>
            <button
              class="op-menu-item"
              role="menuitem"
              onClick={() => { setOpMenuOpen(false); props.onOpenBackup(); }}
            >
              Recovery keys
            </button>
            <button
              class="op-menu-item"
              role="menuitem"
              onClick={() => {
                setOpMenuOpen(false);
                const cur = document.documentElement.getAttribute("data-theme") || "dark";
                const next = cur === "light" ? "dark" : "light";
                document.documentElement.setAttribute("data-theme", next);
                try { localStorage.setItem("orbee-theme", next); } catch {}
              }}
            >
              Toggle theme
            </button>
            <div class="op-menu-sep" role="separator" aria-hidden="true" />
            <button
              class="op-menu-item"
              role="menuitem"
              onClick={() => { setOpMenuOpen(false); props.onLogout(); }}
            >
              Log out
            </button>
          </div>
        </Show>
      </div>

      <div class="sidebar-stations-header">
        <span class="sidebar-stations-label">Stations</span>
        <button
          type="button"
          class="sidebar-stations-add"
          onClick={() => props.onNewStation()}
          aria-label="Tune to a new frequency"
          title="Tune to a new frequency"
        >
          +
        </button>
      </div>

      <ul class="channels">
        <For each={storedRefs()}>
          {(s) => {
            const [hovered, setHovered] = createSignal(false);
            const activity = () => stationActivity[stationKey(s)];
            const unread = () => activity()?.unreadCount ?? 0;
            const lit = () => isActive(s) || hovered();
            const offline = () => isActive(s) && !isRelayConnected(s.relay);
            return (
              <li
                class={`channel ${isActive(s) ? "active" : ""} ${hovered() ? "hovered" : ""} ${offline() ? "is-offline" : ""}`}
                onClick={() => props.onSelectStation(s)}
                onMouseEnter={() => setHovered(true)}
                onMouseLeave={() => setHovered(false)}
                data-label={offline() ? `${stationLabel(s)} — can't reach relay` : stationLabel(s)}
              >
                <StationScope
                  stationId={s.id}
                  relay={s.relay}
                  size={40}
                  animated={lit()}
                  accent={lit()}
                  transparentBg
                  offline={offline()}
                />
                <span class="ch-freq">{stationLabel(s)}</span>
                <Show when={unread() > 0}>
                  <span class="ch-unread">{unread() > 99 ? "99+" : unread()}</span>
                </Show>
              </li>
            );
          }}
        </For>

        <li
          class="channel channel-add"
          onClick={() => props.onNewStation()}
          data-label="Tune to a new frequency"
        >
          <div class="ch-add-glyph" aria-hidden="true">+</div>
        </li>
      </ul>

      <div class="sidebar-kbd-hint" aria-hidden="true">
        <kbd>⌘</kbd><kbd>↑↓</kbd> cycle stations
      </div>

      {/* Drag past the collapse threshold (see sidebarState.ts) snaps to icon-only. */}
      <div
        class="sidebar-resize-handle"
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize sidebar"
        onMouseDown={onResizeStart}
      />
    </div>
  );
}
