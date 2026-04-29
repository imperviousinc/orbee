import { createSignal, onMount, onCleanup, Show, For, createEffect, on } from "solid-js";
import SpacesLogo from "./SpacesLogo";
import type { OrbeeExpressionName } from "../lib/orbeeExpressions";
import type { AuthState } from "../lib/auth";
import { peek, claim, fullHandle, FaucetError } from "../lib/faucet";
import {
  loadClaimedHandle,
  saveClaimedHandle,
  setHandleSkipped,
  markMappingPublished,
  clearClaimedHandle,
} from "../lib/handle";
import { publishProfile } from "../lib/profiles";
import { truncateNpubLong, pubkeyToNpub } from "../lib/keys";
import { publishZone } from "../lib/fabric";
import { invalidateHandle as invalidateResolvedHandle } from "../lib/resolvedCache";
import { forceReVerify } from "../lib/verify";
import { IconX } from "./icons";

// ITEM_H must match .claim-wheel-item height in CSS; SPACER_H lets first/last items center.
const ITEM_H = 48;
const WHEEL_ROWS = 7;
const WHEEL_H = ITEM_H * WHEEL_ROWS;
const SPACER_H = Math.floor(WHEEL_H / 2) - ITEM_H / 2;

export default function ClaimHandle(props: {
  auth: AuthState;
  /** Pre-selected handle from `/n?pick=…` deep links. Prepended to the wheel pool
   *  and scrolled into view; faucet validates availability at claim time. */
  initialPick?: string | null;
  onClaimed: (name: string) => void;
  onSkip: () => void;
}) {
  const [pool, setPool] = createSignal<string[]>([]);
  const [selected, setSelected] = createSignal<string | null>(null);
  type Phase =
    | "loading"
    | "picking"
    | "claiming"
    | "claimed"
    | "publishing-zone"
    | "publishing-nostr"
    | "done"
    | "error";
  const [phase, setPhase] = createSignal<Phase>("loading");
  const [error, setError] = createSignal("");
  const [showExplainer, setShowExplainer] = createSignal(false);
  let wheelEl!: HTMLDivElement;
  let scrollRaf: number | null = null;

  const isPicking = () =>
    phase() === "loading" || phase() === "picking" || phase() === "claiming";

  const userNpubLong = truncateNpubLong(props.auth.signer.pubkey);

  // Resume a half-finished claim (name reserved, mapping not yet published).
  const existingClaim = loadClaimedHandle();
  const hasUnfinishedClaim = !!existingClaim && !existingClaim.mappingPublished;

  const [showMappingInfo, setShowMappingInfo] = createSignal(false);

  type ArrowState = "idle" | "publishing" | "success" | "error";
  const [zoneState, setZoneState] = createSignal<ArrowState>("idle");
  const [nostrState, setNostrState] = createSignal<ArrowState>("idle");
  const [zoneError, setZoneError] = createSignal("");
  const [nostrError, setNostrError] = createSignal("");

  const zoneTooltip = () => {
    switch (zoneState()) {
      case "publishing": return "Publishing to Fabric…";
      case "success":    return "Published to Fabric ✓";
      case "error":      return zoneError() || "Fabric publish failed";
      default:           return "Queued - binds handle to your nostr key via the Spaces zone";
    }
  };
  const nostrTooltip = () => {
    switch (nostrState()) {
      case "publishing": return "Publishing kind:0…";
      case "success":    return "Published to Nostr relay ✓";
      case "error":      return nostrError() || "Nostr publish failed";
      default:           return "Queued - publishes a kind:0 so your nostr key claims this handle";
    }
  };

  const [errorActive, setErrorActive] = createSignal(false);
  createEffect(on(error, () => {
    if (!error()) return;
    setErrorActive(true);
    const t = window.setTimeout(() => setErrorActive(false), 1200);
    onCleanup(() => window.clearTimeout(t));
  }, { defer: true }));

  // Restore wheel keyboard focus after the explainer closes.
  createEffect(on(showExplainer, () => {
    if (showExplainer() || !isPicking() || !wheelEl) return;
    queueMicrotask(() => wheelEl?.focus({ preventScroll: true }));
  }, { defer: true }));

  createEffect(on(phase, () => {
    if (phase() !== "done") return;
    const t = window.setTimeout(() => {
      const name = selected();
      if (name) props.onClaimed(name);
    }, 2500);
    onCleanup(() => window.clearTimeout(t));
  }, { defer: true }));

  const expression = (): OrbeeExpressionName => {
    if (errorActive()) return "atUnavailable";
    if (phase() === "claiming") return "loading";
    if (phase() === "claimed") return "atClaimed";
    if (phase() === "publishing-zone" || phase() === "publishing-nostr") return "atIdle";
    if (phase() === "done") return "atConfirmed";
    if (phase() === "error") return "atUnavailable";
    return "atIdle";
  };

  // Must match .claim-wheel-band `top` and `scroll-padding-bottom` in CSS.
  const BAND_RATIO = 0.5;

  function updateWheel() {
    scrollRaf = null;
    const wRect = wheelEl.getBoundingClientRect();
    const center = wRect.top + wRect.height * BAND_RATIO;
    const items = wheelEl.querySelectorAll<HTMLElement>(".claim-wheel-item");
    let closestIdx = 0;
    let closestAD = Infinity;
    items.forEach((it, i) => {
      const r = it.getBoundingClientRect();
      const iCenter = r.top + r.height / 2;
      const d = (iCenter - center) / ITEM_H;
      const ad = Math.abs(d);
      const rotX = Math.max(-26, Math.min(26, -d * 5));
      const scale = Math.max(0.72, 1 - ad * 0.045);
      const opacity = Math.max(0.08, 1 - ad * 0.2);
      it.style.transform = `rotateX(${rotX.toFixed(2)}deg) scale(${scale.toFixed(3)})`;
      it.style.opacity = opacity.toFixed(3);
      it.classList.toggle("is-center", ad < 0.5);
      it.classList.toggle("is-near", ad >= 0.5 && ad < 1.5);
      if (ad < closestAD) {
        closestAD = ad;
        closestIdx = i;
      }
    });
    const name = pool()[closestIdx];
    if (name && name !== selected()) setSelected(name);
  }

  function onWheelScroll() {
    if (scrollRaf != null) return;
    scrollRaf = requestAnimationFrame(updateWheel);
  }

  // Default browser arrow-key scroll (~40px) is less than ITEM_H (48), causing
  // events to land between items. Custom handler scrolls exactly one item per press.
  function onWheelKey(e: KeyboardEvent) {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const delta = e.key === "ArrowDown" ? ITEM_H : -ITEM_H;
    wheelEl.scrollBy({ top: delta, behavior: "smooth" });
  }

  onMount(() => {
    // Register cleanup synchronously so Solid's owner tracking works.
    onCleanup(() => {
      if (scrollRaf != null) cancelAnimationFrame(scrollRaf);
    });

    if (hasUnfinishedClaim && existingClaim) {
      setSelected(existingClaim.name);
      setPhase("claimed");
      return;
    }

    (async () => {
      try {
        const names = await peek();
        const pick = props.initialPick;
        const finalPool = pick && !names.includes(pick)
          ? [pick, ...names]
          : names;
        setPool(finalPool);
        setPhase("picking");
        queueMicrotask(() => {
          const targetIdx = pick
            ? finalPool.indexOf(pick)
            : Math.floor(finalPool.length / 2);
          const idx = targetIdx >= 0 ? targetIdx : Math.floor(finalPool.length / 2);
          wheelEl.scrollTop = idx * ITEM_H;
          setSelected(finalPool[idx] ?? null);
          updateWheel();
          wheelEl.focus({ preventScroll: true });
        });
      } catch (e: any) {
        setError(e?.message || "Faucet unreachable");
        setPhase("error");
      }
    })();
  });

  async function doClaim() {
    const name = selected();
    if (!name) return;
    setError("");
    setPhase("claiming");
    try {
      const res = await claim(name);
      const full = fullHandle(res.name);
      saveClaimedHandle({
        name: res.name,
        full,
        certificate: res.certificate,
        secretKey: res.secret_key,
        claimedAt: Date.now(),
      });
      // kind:0 publish is deferred to the "Publish mapping" step so the signer
      // prompt has visual context (arrow lighting up).
      setPhase("claimed");
    } catch (e: any) {
      const status = e instanceof FaucetError ? e.status : undefined;
      if (status === 410 || status === 409) {
        setPool((p) => p.filter((n) => n !== name));
        setSelected(null);
        requestAnimationFrame(() => {
          if (wheelEl) updateWheel();
        });
        setError("This handle is gone! Pick a different one.");
      } else {
        setError(friendlyClaimError(e?.message || ""));
      }
      setPhase("picking");
    }
  }

  function doSkip() {
    // Clear any half-finished claim so `needsHandleClaim` doesn't drag the user
    // back to setup on reload. Cert is replayable from the faucet later.
    clearClaimedHandle();
    setHandleSkipped(props.auth.signer.pubkey);
    props.onSkip();
  }

  /**
   * Publish handle ↔ npub mapping in two steps:
   *   1. handle → npub: Spaces zone record signed by faucet-issued space key (no signer prompt).
   *   2. npub → handle: kind:0 with `handle: alice.genesis@key` (prompts user's Nostr signer).
   */
  async function doPublish() {
    const claimed = loadClaimedHandle();
    if (!claimed) {
      setError("Missing handle data. Try claiming again.");
      setPhase("picking");
      return;
    }
    if (!claimed.secretKey) {
      setError("Missing secret key. Try claiming again.");
      setPhase("picking");
      return;
    }

    setError("");
    setZoneError("");
    setNostrError("");
    setZoneState("publishing");
    setNostrState("idle");
    setPhase("publishing-zone");

    try {
      const certBytes = base64ToBytes(claimed.certificate);
      const npub = pubkeyToNpub(props.auth.signer.pubkey);
      await publishZone({
        cert: certBytes,
        records: [
          { type: "seq", version: 0 },
          { type: "addr", key: "nostr", value: [npub] },
        ],
        secretKey: claimed.secretKey,
      });
      setZoneState("success");
      // Drop cached entry so the next verify round sees the fresh nostr record.
      await invalidateResolvedHandle(claimed.full);
      forceReVerify(props.auth.signer.pubkey, claimed.full);
    } catch (e: any) {
      const msg = String(e?.message || e || "publish failed");
      console.error("[claim] fabric zone publish failed:", e);
      setZoneState("error");
      setZoneError(msg);
      setError(friendlyPublishError(msg));
      setPhase("claimed");
      return;
    }

    setNostrState("publishing");
    setPhase("publishing-nostr");
    try {
      await publishProfile(props.auth.signer, { handle: claimed.full });
      setNostrState("success");
      // Mark mapping published so reloads skip this page and the App gate clears.
      markMappingPublished();
      await new Promise((r) => setTimeout(r, 400));
      setPhase("done");
    } catch (e: any) {
      const msg = String(e?.message || e || "publish failed");
      console.error("[claim] nostr kind:0 publish failed:", e);
      setNostrState("error");
      setNostrError(msg);
      setError(friendlyPublishError(msg));
      setPhase("claimed");
    }
  }

  // Fabric publish API requires Uint8Array; localStorage only keeps strings.
  function base64ToBytes(b64: string): Uint8Array {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  }

  return (
    <div class="signin-backdrop is-claim">
      <div class={`signin-card is-claim ${isPicking() ? "is-picking" : "is-celebrating"} ${showExplainer() ? "is-explaining" : ""} ${error() ? "has-error" : ""}`}>
        <div class="signin-header">
          <div
            class={`signin-mascot ${isPicking() && !showExplainer() ? "is-clickable" : ""}`}
            onClick={() => {
              if (isPicking() && !showExplainer()) setShowExplainer(true);
            }}
            role={isPicking() && !showExplainer() ? "button" : undefined}
            tabIndex={isPicking() && !showExplainer() ? 0 : undefined}
            aria-label={isPicking() && !showExplainer() ? "What's a handle?" : undefined}
          >
            <SpacesLogo size={120} expression={expression()} />
          </div>
          <Show when={isPicking()}>
            <button
              type="button"
              class={`claim-help-btn ${showExplainer() ? "is-close" : ""}`}
              onClick={() => setShowExplainer((v) => !v)}
              aria-label={showExplainer() ? "Close" : "What's a handle?"}
              title={showExplainer() ? "Close" : "What's a handle?"}
            >
              <Show when={showExplainer()} fallback={<span class="claim-help-glyph">?</span>}>
                <IconX />
              </Show>
            </button>
          </Show>
          <div class="signin-header-slot">
            <Show when={error()}>
              <div class="signin-error">{error()}</div>
            </Show>
          </div>
        </div>

        <div class="signin-body">
          <Show when={isPicking() && !showExplainer()}>
            <div class="claim-picker-intro">
              <h2 class="claim-picker-headline">Pick a handle.</h2>
              <p class="claim-picker-subhead">
                Grab a sovereign <code>.genesis@key</code> from the{" "}
                <a
                  class="claim-picker-link"
                  href="https://spacesprotocol.org"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  handle faucet
                </a>

              </p>
            </div>
          </Show>

          {/* Wheel stays mounted across explainer open/close so scroll position
              + keyboard focus persist; CSS hides it when .is-explaining is set. */}
          <Show when={isPicking()}>
            <div class="claim-wheel-frame" aria-label="Available handles">
              <div class="claim-wheel-band" aria-hidden="true" />
              <div class="claim-wheel-fade-t" aria-hidden="true" />
              <div class="claim-wheel-fade-b" aria-hidden="true" />
              <div
                class="claim-wheel"
                ref={wheelEl}
                onScroll={onWheelScroll}
                onKeyDown={onWheelKey}
                role="listbox"
                tabIndex={0}
              >
                <div class="claim-wheel-spacer claim-wheel-spacer-top" />
                <Show
                  when={pool().length > 0}
                  fallback={<div class="claim-wheel-item is-center">loading…</div>}
                >
                  <For each={pool()}>
                    {(name) => (
                      <div class="claim-wheel-item">
                        <span class="claim-wheel-item-name">{name}</span>
                      </div>
                    )}
                  </For>
                </Show>
                <div class="claim-wheel-spacer claim-wheel-spacer-bottom" />
              </div>
            </div>
          </Show>

          <Show when={isPicking() && !showExplainer()}>
            <div class="claim-view">
              <button
                type="button"
                class="signin-btn claim-grab"
                onClick={doClaim}
                disabled={!selected() || phase() === "claiming"}
              >
                <Show when={phase() === "claiming"} fallback={selected() ? `Grab ${selected()}` : "Grab handle"}>
                  Broadcasting…
                </Show>
              </button>

              <div class="claim-footer">
                <button
                  type="button"
                  class="signin-link-quiet claim-skip"
                  onClick={doSkip}
                  disabled={phase() === "claiming"}
                >
                  Maybe later
                </button>
              </div>
            </div>
          </Show>

          <Show when={isPicking() && showExplainer()}>
            <div class="claim-explainer-view">
              <div class="claim-explainer-content">
                <dl class="claim-explainer-rows">
                  <div class="claim-explainer-row">
                    <dt>Readable</dt>
                    <dd>
                      <code>alice@bitcoin</code>{" "}
                      <span class="claim-explainer-hint">instead of</span>{" "}
                      <code>npub1yx7p…4k3wy</code>
                    </dd>
                  </div>
                  <div class="claim-explainer-row">
                    <dt>Sovereign</dt>
                    <dd>No platform or domain owns it - it's yours, permanently.</dd>
                  </div>
                  <div class="claim-explainer-row">
                    <dt>Permanent</dt>
                    <dd>Free, yours forever, no gatekeeper.</dd>
                  </div>
                  <div class="claim-explainer-row">
                    <dt>Portable</dt>
                    <dd>The same handle in every Nostr client, not just Orbee.</dd>
                  </div>
                </dl>
                <a
                  class="claim-explainer-link"
                  href="https://spacesprotocol.org"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Learn more at spacesprotocol.org →
                </a>
              </div>
              <button
                type="button"
                class="signin-btn claim-explainer-cta"
                onClick={() => setShowExplainer(false)}
              >
                Pick a handle
              </button>
            </div>
          </Show>

          <Show when={phase() === "claimed" || phase() === "publishing-zone" || phase() === "publishing-nostr"}>
            <div class="claim-celebrate claim-claimed">


              <div class="claim-card">

                <div class="claim-card-label">Your handle</div>
                <div class="claim-handle-hero">
                  <span class="claim-handle-hero-name">{selected()}</span>
                  <span class="claim-handle-hero-suffix">.genesis@key</span>
                </div>

                <div class="claim-binding">
                  <div class="claim-link-viz">
                    <div class="claim-bolt-wrap" data-state={zoneState()} tabindex="0" aria-label={zoneTooltip()}>
                      <svg
                        class="claim-bolt claim-bolt-down"
                        width="14" height="14" viewBox="0 0 14 14" fill="none"
                      >
                        <path d="M6 0 L6 8 L2 8 L7 14 L12 8 L8 8 L8 0 Z" fill="currentColor" />
                      </svg>
                      <span class="claim-bolt-tip">{zoneTooltip()}</span>
                    </div>
                    <span class="claim-link-viz-label">pairing</span>
                    <div class="claim-bolt-wrap" data-state={nostrState()} tabindex="0" aria-label={nostrTooltip()}>
                      <svg
                        class="claim-bolt claim-bolt-up"
                        width="14" height="14" viewBox="0 0 14 14" fill="none"
                      >
                        <path d="M6 0 L6 8 L2 8 L7 14 L12 8 L8 8 L8 0 Z" fill="currentColor" />
                      </svg>
                      <span class="claim-bolt-tip">{nostrTooltip()}</span>
                    </div>
                  </div>
                  <div class="claim-npub">{userNpubLong}</div>
                </div>
              </div>

              <div class="claim-publish-section">
                <p class="claim-publish-copy">
                  Publish identity pairings to make the mapping verifiable.
                </p>

                <button
                  type="button"
                  class="signin-btn claim-celebrate-btn"
                  onClick={doPublish}
                  disabled={phase() !== "claimed"}
                >
                  <Show
                    when={phase() === "publishing-zone" || phase() === "publishing-nostr"}
                    fallback={<Show when={error()} fallback={<>Publish</>}><>Try again</></Show>}
                  >
                    Publishing…
                  </Show>
                </button>

                <button
                  type="button"
                  class="claim-nip-link"
                  onClick={() => setShowMappingInfo((v) => !v)}
                  aria-expanded={showMappingInfo()}
                  disabled={phase() !== "claimed"}
                >
                  {showMappingInfo() ? "Hide" : "What's NIP-SPACES?"}
                </button>
                <Show when={showMappingInfo()}>
                  <p class="claim-nip-info">
                    NIP-SPACES binds your nostr identity (kind:0) to your Spaces
                    handle record. Both sides signed, so every client can verify
                    messages posted under this handle - no server to trust.
                  </p>
                </Show>
              </div>
            </div>
          </Show>

          <Show when={phase() === "done"}>
            <div class="claim-celebrate claim-claimed">

              <h2 class="claim-headline">Welcome.</h2>

              <div class="claim-card">


                <div class="claim-card-label">Your handle</div>
                <div class="claim-handle-hero">
                  <span class="claim-handle-hero-name">{selected()}</span>
                  <span class="claim-handle-hero-suffix">.genesis@key</span>
                </div>

                <div class="claim-binding">
                  <div class="claim-link-viz">
                    <div class="claim-bolt-wrap" data-state="success" aria-label="Published to Fabric">
                      <svg class="claim-bolt claim-bolt-down" width="14" height="14" viewBox="0 0 14 14" fill="none">
                        <path d="M6 0 L6 8 L2 8 L7 14 L12 8 L8 8 L8 0 Z" fill="currentColor" />
                      </svg>
                    </div>
                    <span class="claim-link-viz-label">bound</span>
                    <div class="claim-bolt-wrap" data-state="success" aria-label="Published to Nostr relay">
                      <svg class="claim-bolt claim-bolt-up" width="14" height="14" viewBox="0 0 14 14" fill="none">
                        <path d="M6 0 L6 8 L2 8 L7 14 L12 8 L8 8 L8 0 Z" fill="currentColor" />
                      </svg>
                    </div>
                  </div>
                  <div class="claim-npub">{userNpubLong}</div>
                </div>
              </div>

              <p class="claim-done-note">Entering your station…</p>
            </div>
          </Show>
        </div>
      </div>
    </div>
  );
}

function friendlyClaimError(raw: string): string {
  const s = raw.toLowerCase();
  if (s.includes("already") || s.includes("taken")) return "Someone grabbed that one first.";
  if (s.includes("rate") || s.includes("too many")) return "Slow down - try again in a moment.";
  if (!raw) return "Couldn't reach the faucet.";
  return raw;
}

function friendlyPublishError(raw: string): string {
  const s = raw.toLowerCase();
  if (s.includes("denied") || s.includes("rejected")) return "Signer denied the request. Try again?";
  if (s.includes("timeout")) return "Signer didn't respond. Try again?";
  if (!raw) return "Publish failed. Try again?";
  return raw;
}
