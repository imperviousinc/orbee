import { createSignal, createEffect, onCleanup, onMount, Show } from "solid-js";
import { assembleLock } from "../lib/locks";
import { setTrust, clearTrust, getTrustedId } from "../lib/fabric";
import { onFabricStateChange } from "../lib/nostr";
import { rebadgeAll } from "../lib/verify";
import { theme } from "../lib/theme";

const PX = 4;
const G = 20;

type Tab = "default" | "trusted";

function formatHashJSX(h: string) {
  const clean = h.replace(/[^0-9a-fA-F]/g, "");
  const first = [];
  for (let i = 0; i < 16 && i < clean.length; i += 4) first.push(clean.slice(i, i + 4));
  const last = [];
  const end = clean.length;
  for (let i = Math.max(16, end - 16); i < end; i += 4) last.push(clean.slice(i, i + 4));

  // Reading theme() makes the palette lookup reactive to theme flips.
  theme();
  const lockColor = assembleLock(clean).pal.pri;

  return (
    <pre
      class="anchor-hash-formatted"
      style={{
        color: lockColor,
        "--lock-color": lockColor,
      }}
    >
      <span class="anchor-hash-bright">{first[0]}</span>{"  "}{first[1]}{"  "}{first[2]}{"  "}<span class="anchor-hash-bright">{first[3]}</span>{"\n"}<span class="anchor-hash-dim">{last[0]}</span>{"  "}{last[1]}{"  "}{last[2]}{"  "}<span class="anchor-hash-dim">{last[3]}</span>
    </pre>
  );
}

export default function TrustAnchor() {
  let rafId = 0;

  const [tab, setTab] = createSignal<Tab>("default");
  const [trustedHash, setTrustedHash] = createSignal<string | null>(null);
  const [semiTrustedHash, setSemiTrustedHash] = createSignal<string | null>(null);
  const [inputVal, setInputVal] = createSignal("");
  const [canvasEl, setCanvasEl] = createSignal<HTMLCanvasElement | null>(null);
  const [busy, setBusy] = createSignal(false);
  const [trustErr, setTrustErr] = createSignal("");

  function refreshFromFabric() {
    getTrustedId()
      .then((snap) => {
        setTrustedHash(snap.trusted);
        setSemiTrustedHash(snap.semiTrusted);
      })
      .catch((e) => console.warn("[trust] getTrustedId failed:", e));
  }

  onMount(() => {
    refreshFromFabric();
    const unsub = onFabricStateChange(() => refreshFromFabric());
    onCleanup(unsub);
  });

  const activeHash = (): string | null => {
    if (tab() === "trusted") return trustedHash();
    return semiTrustedHash();
  };

  function renderLock() {
    if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
    const canvas = canvasEl();
    const h = activeHash();
    if (!canvas || !h) return;
    const lock = assembleLock(h);
    const pal = lock.pal;
    const cmap: Record<number, string> = { 1: pal.pri, 2: pal.dark, 3: pal.dim, 4: pal.sec, 5: pal.hi };
    const ctx = canvas.getContext("2d")!;
    let frame = 0;
    let glitchT = 300;
    let isGlitch = false;
    let gOff = 0;

    // Respect OS reduced-motion preference: paint one static frame, no RAF loop
    const prefersReduced = typeof matchMedia !== "undefined"
      && matchMedia("(prefers-reduced-motion: reduce)").matches;

    function drawStatic() {
      ctx.clearRect(0, 0, G * PX, G * PX);
      for (let y = 0; y < G; y++) for (let x = 0; x < G; x++) {
        const v = lock.grid[y][x]; if (!v || !cmap[v]) continue;
        ctx.fillStyle = cmap[v];
        ctx.fillRect(x * PX, y * PX, PX, PX);
      }
    }

    if (prefersReduced) {
      drawStatic();
      return;
    }

    // The additive spread pass paints a dirty halo on light bg; skip it there.
    const isLight = document.documentElement.getAttribute("data-theme") === "light";

    function draw() {
      frame++;
      const p = frame * 0.022;
      ctx.clearRect(0, 0, G * PX, G * PX);

      glitchT++;
      if (!isGlitch && glitchT > 320 + Math.random() * 260) {
        isGlitch = true; glitchT = 0;
        setTimeout(() => { isGlitch = false; gOff = 0; }, 85);
      }
      if (isGlitch) gOff = (Math.random() - 0.5) * 6;

      if (!isLight) {
        ctx.globalAlpha = 0.18;
        for (let y = 0; y < G; y++) for (let x = 0; x < G; x++) {
          const v = lock.grid[y][x]; if (!v || !cmap[v]) continue;
          ctx.fillStyle = cmap[v];
          ctx.fillRect(x * PX - 2, y * PX - 2, PX + 4, PX + 4);
        }
      }

      for (let y = 0; y < G; y++) for (let x = 0; x < G; x++) {
        const v = lock.grid[y][x]; if (!v || !cmap[v]) continue;
        let gx = x * PX;
        if (isGlitch && y % 3 === 0) gx += gOff;
        ctx.globalAlpha = 0.92 + Math.sin(p + x * 0.28 + y * 0.22) * 0.08;
        ctx.fillStyle = cmap[v];
        ctx.fillRect(gx, y * PX, PX, PX);
        if (v === 4 || v === 5) {
          ctx.globalAlpha = 0.12;
          ctx.fillStyle = "#ff3c8e";
          ctx.fillRect(gx - 1.5, y * PX, 1.5, PX);
          ctx.fillStyle = "#4444ff";
          ctx.fillRect(gx + PX, y * PX, 1.5, PX);
        }
      }

      if (!isLight) {
        const kg = 0.04 + Math.sin(frame * 0.04) * 0.03;
        ctx.globalAlpha = kg;
        for (let y = 0; y < G; y++) for (let x = 0; x < G; x++) {
          if (lock.grid[y][x] !== 4) continue;
          ctx.fillStyle = pal.sec;
          ctx.fillRect(x * PX - 3, y * PX - 3, PX + 6, PX + 6);
        }
      }
      ctx.globalAlpha = 1;
      rafId = requestAnimationFrame(draw);
    }
    draw();
  }

  async function trustHash() {
    const val = inputVal().trim().replace(/^0x/, "").toLowerCase();
    if (!/^[0-9a-f]{16,}$/.test(val)) {
      setTrustErr("Invalid hex hash");
      return;
    }
    setBusy(true);
    setTrustErr("");
    try {
      await setTrust(val);
      setTrustedHash(val);
      setInputVal("");
      // Re-evaluate badges or stale "unverified" labels linger.
      rebadgeAll().catch((e) => console.warn("[trust] rebadge failed:", e));
    } catch (e: any) {
      console.warn("[trust] fabric.trust failed:", e);
      setTrustErr(e?.message || "Couldn't verify the trust anchor");
    } finally {
      setBusy(false);
    }
  }

  async function clearTrusted() {
    setBusy(true);
    setTrustErr("");
    try {
      await clearTrust();
      setTrustedHash(null);
      setInputVal("");
      rebadgeAll().catch((e) => console.warn("[trust] rebadge failed:", e));
    } catch (e: any) {
      console.warn("[trust] fabric.clearTrust failed:", e);
      setTrustErr(e?.message || "Couldn't remove the trust anchor");
    } finally {
      setBusy(false);
    }
  }

  // Re-render on canvas / tab / hash / theme changes.
  createEffect(() => {
    canvasEl();
    activeHash();
    theme();
    renderLock();
  });

  onCleanup(() => { if (rafId) cancelAnimationFrame(rafId); });

  return (
    <div class="anchor-card">
      <div class="anchor-title">source of truth</div>

      <div class="anchor-tabs" role="tablist">
        <button
          role="tab"
          aria-selected={tab() === "default"}
          class={`anchor-tab ${tab() === "default" ? "active" : ""}`}
          onClick={() => setTab("default")}
        >
          default
        </button>
        <button
          role="tab"
          aria-selected={tab() === "trusted"}
          class={`anchor-tab ${tab() === "trusted" ? "active" : ""}`}
          onClick={() => setTab("trusted")}
        >
          trusted
        </button>
      </div>

      <Show when={tab() === "default" && semiTrustedHash()}>
        <div class="anchor-row">
          <canvas
            ref={setCanvasEl}
            width={G * PX}
            height={G * PX}
            style={{
              width: "72px",
              height: "72px",
              "image-rendering": "pixelated",
              "flex-shrink": "0",
            }}
          />
          <div class="anchor-hash-side">
            {formatHashJSX(semiTrustedHash()!)}
          </div>
        </div>
      </Show>
      <Show when={tab() === "default" && !semiTrustedHash()}>
        <div class="anchor-row anchor-row-loading">
          <div class="anchor-desc">Fetching public anchor…</div>
        </div>
      </Show>

      <Show when={tab() === "trusted" && trustedHash()}>
        <div class="anchor-row">
          <canvas
            ref={setCanvasEl}
            width={G * PX}
            height={G * PX}
            style={{
              width: "72px",
              height: "72px",
              "image-rendering": "pixelated",
              "flex-shrink": "0",
            }}
          />
          <div class="anchor-hash-side">
            {formatHashJSX(trustedHash()!)}
            <button class="anchor-change-link" onClick={clearTrusted} disabled={busy()}>
              {busy() ? "removing…" : "remove"}
            </button>
          </div>
        </div>
      </Show>

      <Show when={tab() === "trusted" && !trustedHash()}>
        <div class="anchor-edit">
          <input
            type="text"
            class="anchor-input"
            placeholder="Paste hex root hash..."
            value={inputVal()}
            onInput={(e) => { setInputVal(e.currentTarget.value); setTrustErr(""); }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !busy()) trustHash();
            }}
            disabled={busy()}
            autofocus
          />
          <div class="anchor-edit-actions">
            <button class="anchor-trust-btn" onClick={trustHash} disabled={busy()}>
              {busy() ? "Trusting…" : "Trust"}
            </button>
          </div>
        </div>
        <Show when={trustErr()}>
          <div class="anchor-error">{trustErr()}</div>
        </Show>
        <div class="anchor-desc">
          Set your locally verified trust ID: <a target="_blank" href="https://spacesprotocol.org">install trust anchor</a>
        </div>
      </Show>
    </div>
  );
}
