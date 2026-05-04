import { createSignal, Show, Switch, Match, For, onCleanup, onMount, createEffect } from "solid-js";
import { loadAuth, clearAuth, hexToBytes, type NostrEvent, type StoredAuth } from "./lib/keys";
import { wipeAccountData } from "./lib/cacheReset";
import {
  loadClaimedHandle,
  isHandleSkipped,
  isClaimComplete,
  pubkeyHasVerifiedHandle,
  markPubkeyVerifiedHandle,
} from "./lib/handle";
import ClaimHandle from "./components/ClaimHandle";
import { Signer } from "./lib/signer";
import type { AuthState } from "./lib/auth";
import { setMyPubkey } from "./lib/reactions";
import { setAuth as setGlobalAuth } from "./lib/auth";
import { preloadFabric, setSemiTrust, getTrustedId } from "./lib/fabric";
import { fetchDefaultAnchor } from "./lib/spacesAnchors";
import { closeMessageContext } from "./lib/contextMenu";
import { getRelay, profileRelay, STATIONS_RELAY_URL, isRelayConnected } from "./lib/nostr";
import {
  activeStation,
  setActiveStation,
  stations,
  stationKey,
  seedStations,
  subscribeStationsMetadata,
  hydrateStationMetadataFromCache,
  subscribeJoinRequests,
  unsubscribeJoinRequests,
  visiblePendingRequests,
  loadStoredStations,
  requestLeave,
  forgetStation,
  isAdminOf,
  isMemberOf,
  type StationRef,
} from "./lib/stations";
import { stationFromUrl, replaceStationUrl, inviteCodeFromUrl, pickFromUrl } from "./lib/stationUrl";
import {
  bootStationActivity,
  hydrateActivityFromCache,
  markStationRead,
  sortedJoinedStations,
} from "./lib/stationActivity";
import LeftSidebar from "./components/LeftSidebar";
import RightSidebar from "./components/RightSidebar";
import Feed from "./components/Feed";
import MessageInput from "./components/MessageInput";
import SignIn from "./components/SignIn";
import StationPreview, { type PreviewMode } from "./components/StationPreview";
import ExploreView, { ExploreList } from "./components/ExploreView";
import StationSettings from "./components/StationSettings";
import ProfileEditor from "./components/ProfileEditor";
import ProfileView from "./components/ProfileView";
import PinnedBanner from "./components/PinnedBanner";
import BackupBanner from "./components/BackupBanner";
import BackupView from "./components/BackupView";
import { hasUnbackedKey } from "./lib/backup";
import { viewingProfile, setViewingProfile } from "./lib/profileView";
import { profiles, identityParts, requestProfilesPriority } from "./lib/profiles";
import RequestAccessBanner from "./components/RequestAccessBanner";
import DialogHost from "./components/DialogHost";
import { IconDotsThreeVertical, IconX } from "./components/icons";
import MessageContextMenu from "./components/MessageContextMenu";
import ProfileCard from "./components/ProfileCard";
import { sidebarWidth, isSidebarExpanded } from "./lib/sidebarState";
import { confirmDialog } from "./lib/dialog";

export default function App() {
  const stored = loadAuth();
  const [auth, setAuth] = createSignal<AuthState | null>(null);
  // Distinguishes "still spinning up the signer in the worker" from
  // "logged out". On a fresh visit (no stored auth) restore is a no-op
  // and bootDone flips immediately; on a returning visit it flips after
  // Signer.connect resolves (or fails).
  const [bootDone, setBootDone] = createSignal(stored == null);

  async function forceSignOut() {
    await wipeAccountData();
    clearAuth();
    window.location.href = "/";
  }

  // Async restore from stored auth. We don't seed a synchronous stub
  // signer first - the worker is the only place a real signer can live,
  // and its first signEvent isn't valid until Signer.connect resolves.
  if (stored) {
    (async () => {
      try {
        const a = await restoreFromStored(stored, forceSignOut);
        if (a) {
          await bootSession(a);
          setAuth(a);
        }
      } catch (e) {
        console.warn("[auth] restore failed:", e);
      } finally {
        setBootDone(true);
      }
    })();
  }

  async function handleAuth(a: AuthState) {
    await bootSession(a);
    setAuth(a);
  }

  const [handleTick, setHandleTick] = createSignal(0);
  const needsHandleClaim = (pubkey: string) => {
    handleTick(); // subscribe
    // Their kind:0 already carries a handle (published from this device,
    // another client, or a previous install) - no picker needed.
    if (pubkeyHasVerifiedHandle(pubkey)) return false;
    if (profiles[pubkey]?.handle) return false;
    if (isClaimComplete()) return false;
    if (loadClaimedHandle()) return true;
    return !isHandleSkipped(pubkey);
  };
  const bumpHandleTick = () => setHandleTick((n) => n + 1);

  // Once the signed-in user's kind:0 arrives carrying a handle, cache
  // that fact locally so future re-logins skip the relay round-trip.
  createEffect(() => {
    const a = auth();
    if (!a) return;
    const handle = profiles[a.signer.pubkey]?.handle;
    if (handle && !pubkeyHasVerifiedHandle(a.signer.pubkey)) {
      markPubkeyVerifiedHandle(a.signer.pubkey);
    }
  });

  return (
    <>
      <Show when={bootDone()} fallback={null}>
        <Show when={auth()} fallback={<SignIn onAuth={handleAuth} />}>
          {(a) => (
            <Show
              when={needsHandleClaim(a().signer.pubkey)}
              fallback={<Board auth={a()} />}
            >
              <ClaimHandle
                auth={a()}
                initialPick={pickFromUrl()}
                onClaimed={bumpHandleTick}
                onSkip={bumpHandleTick}
              />
            </Show>
          )}
        </Show>
      </Show>
      <MessageContextMenu />
      <ProfileCard />
      <DialogHost />
    </>
  );
}

function waitForNip07(timeoutMs: number): Promise<any> {
  return new Promise((resolve) => {
    const wn = (window as any).nostr;
    if (wn) return resolve(wn);
    const start = Date.now();
    const tick = () => {
      const w = (window as any).nostr;
      if (w) return resolve(w);
      if (Date.now() - start >= timeoutMs) return resolve(null);
      setTimeout(tick, 100);
    };
    setTimeout(tick, 100);
  });
}

async function restoreFromStored(
  stored: StoredAuth,
  forceSignOut: () => Promise<void>,
): Promise<AuthState | null> {
  if (stored.method === "local") {
    const signer = await Signer.connect({ type: "local", privkey: stored.keypair.privkey });
    return { handle: stored.handle, signer };
  }
  if (stored.method === "nip07") {
    // Extensions inject window.nostr asynchronously during page load - on
    // a refresh, restore can fire before injection completes. Poll briefly
    // before giving up; users without the extension installed still hit
    // the throw after the timeout.
    const wn = await waitForNip07(3000);
    if (!wn) {
      throw new Error("NIP-07 extension not found");
    }
    const pubkey = await wn.getPublicKey();
    if (pubkey !== stored.pubkey) {
      // Different account selected in the extension - that's an identity
      // change, sign out for safety.
      await forceSignOut();
      return null;
    }
    const signer = await Signer.connect({ type: "nip07", pubkey });
    return { handle: "", signer };
  }
  // Bunker: build a Signer immediately from the stored userPubkey + session
  // so the user stays in the app on refresh even if the remote signer
  // (Amber, nsec.app, etc.) is offline at boot. The worker reconnect runs
  // in the background; signEvent will fail with a clear error until it
  // succeeds, but navigation / cached views work normally - much better
  // UX than dumping the user to SignIn just because their bunker is
  // momentarily unreachable.
  const session = {
    clientSk: hexToBytes(stored.session.clientSkHex),
    signerPubkey: stored.session.signerPubkey,
    relays: stored.session.relays,
    secret: stored.session.secret,
  };
  const stubSigner = new Signer(stored.session.userPubkey, session, false);
  Signer.connect({ type: "bunker", via: "session", session })
    .then((real) => {
      if (real.pubkey !== stored.session.userPubkey) {
        // Reconnected to a different identity - that's a real sign-out.
        forceSignOut();
      }
    })
    .catch((e) => {
      console.warn("[auth] bunker reconnect failed; signing will error until the signer comes back:", e);
    });
  return { handle: "", signer: stubSigner };
}

async function bootSession(a: AuthState) {
  setMyPubkey(a.signer.pubkey);
  setGlobalAuth(a);
  profileRelay.connect();
  requestProfilesPriority([a.signer.pubkey]);
  seedStations();
  const relays = new Set(loadStoredStations().map((s) => s.relay));
  for (const url of relays) {
    hydrateStationMetadataFromCache(url);
  }
  hydrateActivityFromCache();
  // Defer kind:9 activity subs so the initial Feed render isn't
  // competing with the burst of events for OTHER stations on the same relay.
  setTimeout(bootStationActivity, 800);
  // Cross-device station rediscovery is no longer auto-run on boot - it
  // forced an AUTH prompt against groups.0xchat.com for users who may
  // not even use that relay. Triggered explicitly from the Discover
  // tab's "Import from relay" UI now.
  preloadFabric();
  ensureDefaultSemiTrust().catch((e) =>
    console.warn("[boot] default semi-trust setup failed:", e),
  );
}

async function ensureDefaultSemiTrust(): Promise<void> {
  const snap = await getTrustedId();
  if (snap.semiTrusted) return;
  const anchor = await fetchDefaultAnchor();
  await setSemiTrust(anchor.trust_id);
}

function Board(props: { auth: AuthState }) {
  // Read signer through a getter, not by destructuring at component init.
  // The Signer instance can be replaced if the auth flow ever reissues one
  // (e.g. on reconnect); a captured const would freeze on the original.
  const signer = () => props.auth.signer;
  const [feedEvents, setFeedEvents] = createSignal<NostrEvent[]>([]);
  const [leftOpen, setLeftOpen] = createSignal(false);
  const [rightOpen, setRightOpen] = createSignal(false);
  const [showStationMenu, setShowStationMenu] = createSignal(false);
  const [showPinnedPanel, setShowPinnedPanel] = createSignal(false);
  const [editingStation, setEditingStation] = createSignal<StationRef | null>(null);
  const [editingProfile, setEditingProfile] = createSignal(false);
  const [showingBackup, setShowingBackup] = createSignal(false);
  const [previewStation, setPreviewStation] = createSignal<{ ref: StationRef; mode: PreviewMode | null; inviteCode?: string | null } | null>(null);
  const [pickerTab, setPickerTab] = createSignal<"add" | "discover">("add");

  {
    const fromUrl = stationFromUrl();
    const stored = loadStoredStations();
    const isJoined = (s: StationRef) =>
      stored.some((j) => j.id === s.id && j.relay === s.relay);
    if (fromUrl && isJoined(fromUrl)) {
      setActiveStation(fromUrl);
    } else if (fromUrl) {
      setPreviewStation({ ref: fromUrl, mode: "tune", inviteCode: inviteCodeFromUrl() });
    } else if (stored.length > 0) {
      setActiveStation(stored[0]);
    }
  }

  createEffect(() => {
    if (previewStation()) return;
    replaceStationUrl(activeStation());
  });

  function startPreview(ref: StationRef, mode: PreviewMode | null) {
    setPreviewStation({ ref, mode });
    setLeftOpen(false);
  }

  function startNewStation() {
    startPreview({ id: "", relay: STATIONS_RELAY_URL }, null);
  }

  function startEditProfile() {
    setEditingProfile(true);
    setLeftOpen(false);
  }

  async function handleLogout() {
    if (hasUnbackedKey(signer().pubkey)) {
      const ok = await confirmDialog({
        title: "Sign out without backing up?",
        body: "You haven't saved your recovery key yet. If you sign out now, you won't be able to get back into this account.",
        confirmLabel: "Sign out anyway",
        destructive: true,
      });
      if (!ok) return;
    } else {
      const ok = await confirmDialog({
        title: "Sign out?",
        body: "You'll need your recovery key to sign back in on this device.",
        confirmLabel: "Sign out",
      });
      if (!ok) return;
    }
    await wipeAccountData();
    clearAuth();
    window.location.href = "/";
  }

  function handlePreviewJoined(s: StationRef) {
    // Update activeStation BEFORE unmounting the preview, otherwise Feed
    // mounts reading the previous activeStation for one tick.
    setActiveStation(s);
    setPreviewStation(null);
    setLeftOpen(false);
  }

  function cancelPreview() {
    setPreviewStation(null);
    setPickerTab("add");
  }

  createEffect(() => {
    const s = activeStation();
    if (!s) return;
    const r = getRelay(s.relay);
    r.connect();
    subscribeStationsMetadata(s.relay);
  });

  let activeBootGuard = true;
  createEffect(() => {
    activeStation();
    if (activeBootGuard) { activeBootGuard = false; return; }
    setEditingStation(null);
    setPreviewStation(null);
    setEditingProfile(false);
  });

  createEffect(() => {
    const s = activeStation();
    if (s) markStationRead(s);
  });

  // kind:9021 inbox sub for admins; re-runs as admin status flips.
  createEffect(() => {
    const s = activeStation();
    if (!s) return;
    if (!isAdminOf(s, signer().pubkey)) return;
    subscribeJoinRequests(s);
    onCleanup(() => unsubscribeJoinRequests(s));
  });

  async function handleLeaveStation() {
    setShowStationMenu(false);
    const s = activeStation();
    if (!s) return;
    const label = stations[stationKey(s)]?.name || s.id;
    if (!await confirmDialog({
      title: `Leave ${label}?`,
      body: `You can rejoin later from "Tune in".`,
      confirmLabel: "Leave",
      destructive: true,
    })) return;
    await requestLeave(signer(), s);
    forgetStation(s);
    const remaining = loadStoredStations();
    setActiveStation(remaining[0] || null);
  }

  const currentStation = () => {
    const s = activeStation();
    return s ? stations[stationKey(s)] : undefined;
  };
  const currentLabel = () =>
    currentStation()?.name || activeStation()?.id || "no station";

  const headerLabel = () => {
    const vp = viewingProfile();
    if (vp) return identityParts(vp).primary;
    if (editingProfile()) return "your profile";
    const p = previewStation();
    if (p) {
      if (p.ref.id) return p.ref.id;
      return p.mode === "mint" ? "new broadcast" : "add station";
    }
    return editingStation()?.id || currentLabel();
  };
  const headerDesc = () => {
    if (viewingProfile()) return "operator profile";
    if (editingProfile()) return "Edit your name, picture, and recovery key";
    const p = previewStation();
    if (p) {
      if (p.ref.id) return p.mode === "mint" ? "New broadcast preview" : "Pre-join preview";
      return p.mode === "mint" ? "Pick a frequency to broadcast on" : "Tune in to a frequency";
    }
    if (editingStation()) return "Editing station settings";
    return currentStation()?.about || "The public square";
  };

  const anyDrawerOpen = () => leftOpen() || rightOpen();

  function closeDrawers() {
    setLeftOpen(false);
    setRightOpen(false);
  }

  function selectStation(s: StationRef) {
    setActiveStation(s);
    setLeftOpen(false);
    closeMessageContext();
    setViewingProfile(null);
    setShowPinnedPanel(false);
  }

  const inTakeoverMode = () =>
    !!(previewStation() || editingStation() || editingProfile() || viewingProfile() || showingBackup());

  // True when the user is reading/writing in a station — i.e. the chat is
  // the foreground surface. False during onboarding takeovers (preview /
  // settings / profile / backup) and the empty/no-station state. Drives
  // the wallpaper-pattern toggle on .app-wrap so the grid only shows when
  // it acts as scaffolding (between things), not as chat noise.
  const inChat = () => !inTakeoverMode() && !!activeStation();

  function closeTakeover() {
    if (previewStation()) { cancelPreview(); return; }
    if (editingStation()) { setEditingStation(null); return; }
    if (editingProfile()) { setEditingProfile(false); return; }
    if (viewingProfile()) { setViewingProfile(null); return; }
    if (showingBackup()) { setShowingBackup(false); return; }
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === "Escape") {
      if (anyDrawerOpen()) closeDrawers();
      if (showStationMenu()) setShowStationMenu(false);
      closeMessageContext();
      if (inTakeoverMode()) closeTakeover();
      return;
    }
    if ((e.altKey || e.metaKey) && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
      // Skip when typing - don't hijack arrows inside composer/forms.
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      const list = sortedJoinedStations();
      if (list.length === 0) return;
      e.preventDefault();
      const cur = activeStation();
      const idx = cur ? list.findIndex((s) => s.id === cur.id && s.relay === cur.relay) : -1;
      const next = e.key === "ArrowDown"
        ? (idx + 1) % list.length
        : (idx - 1 + list.length) % list.length;
      selectStation(list[next]);
    }
  }

  function onDocClick(e: MouseEvent) {
    if (!showStationMenu()) return;
    const t = e.target as HTMLElement;
    if (!t.closest(".mh-actions") && !t.closest(".mh-channel-menu")) {
      setShowStationMenu(false);
    }
  }

  function onPopState() {
    const fromUrl = stationFromUrl();
    if (!fromUrl) {
      setPreviewStation(null);
      setActiveStation(null);
      return;
    }
    const stored = loadStoredStations();
    if (stored.some((j) => j.id === fromUrl.id && j.relay === fromUrl.relay)) {
      setPreviewStation(null);
      setActiveStation(fromUrl);
    } else {
      setPreviewStation({ ref: fromUrl, mode: "tune", inviteCode: inviteCodeFromUrl() });
    }
  }

  onMount(() => {
    window.addEventListener("keydown", onKey);
    document.addEventListener("click", onDocClick);
    window.addEventListener("popstate", onPopState);
    onCleanup(() => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("click", onDocClick);
      window.removeEventListener("popstate", onPopState);
    });
  });

  return (
    <div class={`app-wrap ${inChat() ? "is-in-chat" : ""}`}>
      <BackupBanner signer={signer()} onOpen={() => { setShowingBackup(true); setLeftOpen(false); }} />
      <div
        class={`app-grid ${leftOpen() ? "left-open" : ""} ${rightOpen() ? "right-open" : ""} ${isSidebarExpanded() ? "sidebar-expanded" : ""}`}
        style={{ "--sidebar-width": isSidebarExpanded() ? `${sidebarWidth()}px` : "68px" }}
      >
      <LeftSidebar
        signer={signer()}
        activeStation={activeStation()}
        onSelectStation={selectStation}
        onNewStation={startNewStation}
        onEditProfile={startEditProfile}
        onOpenBackup={() => { setShowingBackup(true); setLeftOpen(false); }}
        onLogout={handleLogout}
        open={leftOpen()}
        onClose={() => setLeftOpen(false)}
      />

      <div class="main">
        <div class="main-header">
          <button
            class="mh-menu"
            onClick={() => setLeftOpen(true)}
            aria-label="Open stations"
          >
            CH
          </button>
          <Show when={inTakeoverMode()} fallback={<span class="mh-hash">#</span>}>
            <button
              class="mh-back"
              onClick={closeTakeover}
              aria-label="Back to station"
              title="Back (Esc)"
            >
              <span class="mh-back-arrow" aria-hidden="true">←</span>
              <span class="mh-back-label">back</span>
            </button>
          </Show>
          <span class="mh-name">{headerLabel()}</span>
          <Show when={activeStation() && !previewStation() && !editingStation() && !editingProfile() && !viewingProfile() && !showingBackup()}>
            <button
              class="mh-actions"
              onClick={(e) => { e.stopPropagation(); setShowStationMenu(!showStationMenu()); }}
              title="Station actions"
              aria-label="Station actions"
            >
              <IconDotsThreeVertical />
            </button>
            <Show when={showStationMenu()}>
              <div class="mh-channel-menu" onClick={(e) => e.stopPropagation()}>
                <div class="msg-mod-heading">Station</div>
                <Show when={isAdminOf(activeStation(), signer().pubkey)}>
                  <button class="msg-mod-item" onClick={() => { setShowStationMenu(false); setEditingStation(activeStation()); }}>
                    Station settings
                  </button>
                </Show>
                <button class="msg-mod-item" onClick={handleLeaveStation}>
                  Leave station
                </button>
              </div>
            </Show>
          </Show>
          <span class="mh-sep" />
          <span class="mh-desc">{headerDesc()}</span>
          <Show when={activeStation() && !previewStation() && !editingStation() && !editingProfile() && !viewingProfile() && !showingBackup()}>
            {(() => {
              const onAir = () => {
                const s = activeStation();
                return s ? isRelayConnected(s.relay) : false;
              };
              return (
                <span
                  class={`mh-ident ${onAir() ? "is-on-air" : "is-off-air"}`}
                  data-tip={onAir() ? undefined : `Can't reach ${activeStation()?.relay}`}
                >
                  <span class="mh-onair-dot" />
                  <span class="mh-onair-text">{onAir() ? "ON AIR" : "Reconnecting…"}</span>
                </span>
              );
            })()}
          </Show>
          <button
            class="mh-station"
            onClick={() => setRightOpen(true)}
            aria-label="Open station panel"
          >
            SIG
            <Show when={visiblePendingRequests(activeStation(), signer().pubkey).length > 0}>
              <span
                class="mh-station-dot"
                title={`${visiblePendingRequests(activeStation(), signer().pubkey).length} pending request${visiblePendingRequests(activeStation(), signer().pubkey).length === 1 ? "" : "s"}`}
              />
            </Show>
          </button>
        </div>

        <Show when={activeStation() && !inTakeoverMode()}>
          <PinnedBanner
            station={activeStation()!}
            open={showPinnedPanel()}
            onToggle={() => setShowPinnedPanel(!showPinnedPanel())}
            onClose={() => setShowPinnedPanel(false)}
          />
        </Show>

        <Show when={viewingProfile() || showingBackup()}>
          <button
            class="takeover-close"
            onClick={closeTakeover}
            aria-label="Close"
            title="Close (Esc)"
          >
            <IconX />
          </button>
        </Show>

        {/* Feed pool stays mounted outside this switch so opening a
            takeover doesn't tear down keep-alive Feeds. */}
        <Show when={inTakeoverMode()}>
          <Switch>
            <Match when={previewStation()}>
              <Show when={previewStation()!.ref.id === "" && previewStation()!.mode === null}>
                <div class="picker-tabs">
                  <div class="picker-tabs-inner" role="tablist">
                    <button
                      type="button"
                      role="tab"
                      class={`picker-tab ${pickerTab() === "add" ? "active" : ""}`}
                      aria-selected={pickerTab() === "add"}
                      onClick={() => setPickerTab("add")}
                    >
                      Add
                    </button>
                    <button
                      type="button"
                      role="tab"
                      class={`picker-tab ${pickerTab() === "discover" ? "active" : ""}`}
                      aria-selected={pickerTab() === "discover"}
                      onClick={() => setPickerTab("discover")}
                    >
                      Discover
                    </button>
                  </div>
                </div>
              </Show>
              <Show
                when={pickerTab() === "discover" && previewStation()!.ref.id === ""}
                fallback={
                  <StationPreview
                    signer={signer()}
                    initial={previewStation()!.ref}
                    mode={previewStation()!.mode}
                    inviteCode={previewStation()!.inviteCode}
                    onJoined={handlePreviewJoined}
                    onCancel={cancelPreview}
                  />
                }
              >
                <div class="explore-view">
                  <div class="explore-content">
                    <ExploreList
                      onPick={(ref) => {
                        setPickerTab("add");
                        startPreview(ref, "tune");
                      }}
                    />
                  </div>
                </div>
              </Show>
            </Match>
            <Match when={editingStation()}>
              <StationSettings
                signer={signer()}
                station={editingStation()!}
                onClose={() => setEditingStation(null)}
              />
            </Match>
            <Match when={editingProfile()}>
              <ProfileEditor
                signer={signer()}
                onClose={() => setEditingProfile(false)}
              />
            </Match>
            <Match when={viewingProfile()}>
              <ProfileView
                pubkey={viewingProfile()!}
                onClose={() => setViewingProfile(null)}
              />
            </Match>
            <Match when={showingBackup()}>
              <BackupView
                signer={signer()}
                onClose={() => setShowingBackup(false)}
              />
            </Match>
          </Switch>
        </Show>

        {/* Keep-alive feed pool: every joined station's Feed stays mounted;
            only the active slot is display:flex. */}

        <div
          class="feed-pool"
          style={{ display: inTakeoverMode() ? "none" : "flex" }}
        >
          <For each={sortedJoinedStations()}>
            {(s) => {
              const isActive = () => {
                const a = activeStation();
                return !!a && a.id === s.id && a.relay === s.relay;
              };
              return (
                <div
                  class="feed-slot"
                  style={{ display: isActive() ? "flex" : "none" }}
                >
                  <Feed
                    station={s}
                    visible={isActive()}
                    onEventsChange={setFeedEvents}
                  />
                </div>
              );
            }}
          </For>

          <Show when={sortedJoinedStations().length === 0}>
            <ExploreView
              lede="You haven't joined any stations yet - pick one of these to get started, or hit the dial in the sidebar to create your own."
              onTune={(ref) => startPreview(ref, "tune")}
            />
          </Show>
        </div>

        <Show when={!inTakeoverMode()}>
          <Show
            when={(() => {
              const s = activeStation();
              if (!s) return true;
              const data = stations[stationKey(s)];
              if (!data || data.open !== false) return true;
              return isAdminOf(s, signer().pubkey) || isMemberOf(s, signer().pubkey);
            })()}
            fallback={
              <RequestAccessBanner signer={signer()} station={activeStation()!} />
            }
          >
            <MessageInput
              signer={signer()}
              station={activeStation()}
              stationLabel={currentLabel()}
              onPublished={(event) => {
                const s = activeStation();
                if (!s) return;
                const adders = (window as any).__spacesFeedAdders;
                adders?.[stationKey(s)]?.(event);
              }}
            />
          </Show>
        </Show>
      </div>

      <RightSidebar
        events={feedEvents()}
        station={activeStation()}
        open={rightOpen()}
        onClose={() => setRightOpen(false)}
      />

      <div
        class={`drawer-scrim ${anyDrawerOpen() ? "visible" : ""}`}
        onClick={closeDrawers}
        aria-hidden="true"
      />

      </div>
    </div>
  );
}
