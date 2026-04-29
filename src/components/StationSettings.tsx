import { createSignal, For, Show, onMount } from "solid-js";
import type { Signer } from "../lib/signer";
import { stations, stationKey, editStationMetadata, createInvite, type StationRef } from "../lib/stations";
import { stationConfigs, editStationConfig } from "../lib/stationConfig";
import { stationToPath } from "../lib/stationUrl";
import TakeoverCard from "./TakeoverCard";

// 16 chars [a-z0-9], ~80 bits of entropy. URL-safe for `?invite=`.
function generateInviteCode(): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let out = "";
  for (let i = 0; i < bytes.length; i++) out += alphabet[bytes[i] % alphabet.length];
  return out;
}
import {
  getStationScopeSeed,
  generateRandomScopeSeed,
  applyPresetOverride,
  type ScopeSeed,
} from "../lib/stationScope";
import ScopeCanvas from "./ScopeCanvas";

type ScopeMode = "preset" | "path";
const PATH_GRID = 200;
const PATH_MIN_POINTS = 4;
const PATH_MAX_POINTS = 300;
type DrawPoint = { x: number; y: number; jump?: boolean };

/** Parse pasted SVG markup into normalized 0..1 DrawPoints; subpath restarts become `jump: true`. */
function parseSvgToPathPoints(svgText: string, maxPoints = 250): DrawPoint[] | null {
  let svgEl: SVGSVGElement | null = null;
  try {
    const doc = new DOMParser().parseFromString(svgText, "image/svg+xml");
    if (doc.querySelector("parsererror")) return null;
    svgEl = doc.querySelector("svg") as SVGSVGElement | null;
    if (!svgEl) return null;
  } catch {
    return null;
  }

  // Detached SVGPathElements fail getTotalLength in some engines; attach to a hidden host.
  const host = document.createElement("div");
  host.style.cssText = "position:absolute;visibility:hidden;width:0;height:0;overflow:hidden;pointer-events:none";
  const imported = document.importNode(svgEl, true) as SVGSVGElement;
  host.appendChild(imported);
  document.body.appendChild(host);

  try {
    const paths = Array.from(imported.querySelectorAll("path")) as SVGPathElement[];
    if (paths.length === 0) return null;

    type Sample = { x: number; y: number };
    const allRaw: Sample[] = [];
    const lengths = paths.map((p) => {
      try { return p.getTotalLength(); } catch { return 0; }
    });
    const totalLen = lengths.reduce((a, b) => a + b, 0);
    if (totalLen === 0) return null;

    for (let pi = 0; pi < paths.length; pi++) {
      const len = lengths[pi];
      if (len <= 0) continue;
      const count = Math.max(2, Math.round((len / totalLen) * maxPoints));
      for (let i = 0; i <= count; i++) {
        const t = (i / count) * len;
        try {
          const pt = paths[pi].getPointAtLength(t);
          allRaw.push({ x: pt.x, y: pt.y });
        } catch { /* skip */ }
      }
      // NaN marker = path boundary (separate stroke).
      allRaw.push({ x: NaN, y: NaN });
    }

    if (allRaw.length < 2) return null;

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of allRaw) {
      if (Number.isNaN(p.x)) continue;
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }
    const w = (maxX - minX) || 1;
    const h = (maxY - minY) || 1;
    const scale = 0.85 / Math.max(w, h);
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    const norm = (x: number, c: number) => 0.5 + (x - c) * scale;

    const result: DrawPoint[] = [];
    const stepHint = scale * Math.min(w, h) / Math.max(20, maxPoints / 4);
    const jumpThreshold = stepHint * 6;
    let pendingJump = false;
    let prev: DrawPoint | null = null;
    for (const p of allRaw) {
      if (Number.isNaN(p.x)) { pendingJump = true; continue; }
      const x = norm(p.x, cx);
      const y = norm(p.y, cy);
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      if (prev) {
        const d = Math.hypot(x - prev.x, y - prev.y);
        if (d > jumpThreshold) pendingJump = true;
        if (!pendingJump && d * PATH_GRID < 1.5) continue;
      }
      const point: DrawPoint = pendingJump
        ? { x, y, jump: true }
        : { x, y };
      pendingJump = false;
      result.push(point);
      prev = point;
      if (result.length >= PATH_MAX_POINTS) break;
    }
    if (result.length < PATH_MIN_POINTS) return null;
    return result;
  } finally {
    document.body.removeChild(host);
  }
}

function freshPresetVariants(): ScopeSeed[] {
  return Array.from({ length: 8 }, () => generateRandomScopeSeed());
}

/** Admin settings card; reads kind:39000 metadata, publishes kind:9002 on save. */
export default function StationSettings(props: {
  signer: Signer;
  station: StationRef;
  onClose: () => void;
}) {
  const data = () => stations[stationKey(props.station)];

  const [name, setName] = createSignal(data()?.name || "");
  const [about, setAbout] = createSignal(data()?.about || "");
  const [openAccess, setOpenAccess] = createSignal(data()?.open !== false);
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal("");

  const [inviteUrl, setInviteUrl] = createSignal<string | null>(null);
  const [inviteBusy, setInviteBusy] = createSignal(false);
  const [inviteCopied, setInviteCopied] = createSignal(false);

  async function generateInviteLink() {
    setInviteBusy(true);
    setError("");
    try {
      const code = generateInviteCode();
      const { result } = await createInvite(props.signer, props.station, code);
      if (!result.ok) {
        // NIP-29 kind:9009 is OPTIONAL; many relays (e.g. 0xchat) reject it.
        const msg = result.message || "";
        if (/not allowed|kind 9009|invalid kind|unsupported/i.test(msg)) {
          setError(
            "This relay doesn't support invite links. Joiners will need to send a request and you'll approve them manually.",
          );
        } else {
          setError(msg ? `Relay rejected the invite: ${msg}` : "Relay rejected the invite. Try again?");
        }
        return;
      }
      const path = stationToPath(props.station, { invite: code });
      setInviteUrl(window.location.origin + path);
      setInviteCopied(false);
    } catch (e: any) {
      setError(e?.message || "Couldn't create invite. Try again?");
    } finally {
      setInviteBusy(false);
    }
  }

  async function copyInvite() {
    const url = inviteUrl();
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setInviteCopied(true);
      setTimeout(() => setInviteCopied(false), 1500);
    } catch {}
  }

  const baseSeed = () => getStationScopeSeed(props.station.id, props.station.relay);
  const initialOverride = stationConfigs[stationKey(props.station)]?.config.scope;
  const [scopeMode, setScopeMode] = createSignal<ScopeMode>(
    initialOverride?.kind === "path" ? "path" : "preset",
  );
  // Slot 0 = current/auto seed; slots 1-7 = random pool. Selection is by INDEX.
  const initialSlot0: ScopeSeed = initialOverride?.kind === "preset"
    ? applyPresetOverride(baseSeed(), initialOverride.params)
    : baseSeed();
  const [randomPool, setRandomPool] = createSignal<ScopeSeed[]>(
    freshPresetVariants().slice(0, 7),
  );
  const variants = (): ScopeSeed[] => [initialSlot0, ...randomPool()];
  const [chosenIdx, setChosenIdx] = createSignal(0);
  const chosenSeed = (): ScopeSeed => variants()[chosenIdx()] || initialSlot0;
  function reroll() {
    setRandomPool(freshPresetVariants().slice(0, 7));
  }
  // Multi-stroke path; `jump: true` marks pen-up between strokes.
  const [pathPoints, setPathPoints] = createSignal<DrawPoint[]>(
    initialOverride?.kind === "path" ? initialOverride.points : [],
  );
  let pathCanvasRef!: HTMLCanvasElement;
  let drawing = false;
  let nextSampleIsJump = false;
  function clearCanvas() {
    const ctx = pathCanvasRef?.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, PATH_GRID, PATH_GRID);
    ctx.fillStyle = "rgba(255,255,255,0.04)";
    for (let x = 25; x < PATH_GRID; x += 25) ctx.fillRect(x, 0, 1, PATH_GRID);
    for (let y = 25; y < PATH_GRID; y += 25) ctx.fillRect(0, y, PATH_GRID, 1);
  }
  function pathToCanvas() {
    clearCanvas();
    const ctx = pathCanvasRef?.getContext("2d");
    if (!ctx) return;
    const pts = pathPoints();
    if (pts.length === 0) return;
    ctx.strokeStyle = "#d946ef";
    ctx.fillStyle = "#d946ef";
    ctx.lineWidth = 2.5;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    let started = false;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      if (i === 0 || p.jump) {
        if (started) ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(p.x * PATH_GRID, p.y * PATH_GRID);
        started = true;
      } else {
        ctx.lineTo(p.x * PATH_GRID, p.y * PATH_GRID);
      }
    }
    if (started) ctx.stroke();
    if (pts.length === 1) {
      ctx.beginPath();
      ctx.arc(pts[0].x * PATH_GRID, pts[0].y * PATH_GRID, 3, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  function drawStart(e: PointerEvent) {
    drawing = true;
    nextSampleIsJump = pathPoints().length > 0;
    addDrawSample(e);
    pathCanvasRef.setPointerCapture(e.pointerId);
  }
  function drawMove(e: PointerEvent) {
    if (!drawing) return;
    addDrawSample(e);
  }
  function drawEnd(e: PointerEvent) {
    if (!drawing) return;
    drawing = false;
    addDrawSample(e);
    try { pathCanvasRef.releasePointerCapture(e.pointerId); } catch {}
  }
  function addDrawSample(e: PointerEvent) {
    const rect = pathCanvasRef.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const y = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
    setPathPoints((prev) => {
      if (prev.length >= PATH_MAX_POINTS) return prev;
      const last = prev[prev.length - 1];
      if (last && !nextSampleIsJump) {
        const dx = (x - last.x) * PATH_GRID;
        const dy = (y - last.y) * PATH_GRID;
        if (dx * dx + dy * dy < 4) return prev;
      }
      const point: DrawPoint = nextSampleIsJump
        ? { x, y, jump: true }
        : { x, y };
      nextSampleIsJump = false;
      return [...prev, point];
    });
    pathToCanvas();
  }
  function clearPath() {
    setPathPoints([]);
    nextSampleIsJump = false;
    clearCanvas();
  }

  const [svgPanelOpen, setSvgPanelOpen] = createSignal(false);
  const [svgText, setSvgText] = createSignal("");
  const [svgError, setSvgError] = createSignal<string | null>(null);
  function applySvg() {
    setSvgError(null);
    const result = parseSvgToPathPoints(svgText());
    if (!result) {
      setSvgError("Couldn't parse - needs an <svg> with at least one <path>.");
      return;
    }
    setPathPoints(result);
    pathToCanvas();
    setSvgPanelOpen(false);
    setSvgText("");
  }
  const previewSeed = (): ScopeSeed => {
    if (scopeMode() === "preset") return chosenSeed();
    if (scopeMode() === "path") return { ...baseSeed(), path: pathPoints() };
    return baseSeed();
  };

  onMount(() => {
    pathToCanvas();
  });

  async function handleSave() {
    setBusy(true);
    setError("");
    try {
      // NIP-29 kind:9002 on the group relay.
      const metaResult = await editStationMetadata(props.signer, props.station, {
        name: name().trim(),
        about: about().trim(),
        open: openAccess(),
      });
      if (!metaResult.ok) {
        setError(metaResult.message
          ? `Relay rejected: ${metaResult.message}`
          : "Couldn't save settings.");
        return;
      }

      // Orbee-specific config (scope, later: pinned) → 30078 on the
      // general Nostr relay. Merge with existing config so we don't wipe
      // fields we're not editing (e.g., pinned message ids).
      const scopeOverride =
        scopeMode() === "path" && pathPoints().length >= PATH_MIN_POINTS
          ? { kind: "path" as const, points: pathPoints() }
        : { kind: "preset" as const, params: { ...chosenSeed() } };
      const currentConfig = stationConfigs[stationKey(props.station)]?.config;
      const configResult = await editStationConfig(props.signer, props.station, {
        ...currentConfig,
        scope: scopeOverride,
      });
      if (!configResult.ok) {
        setError(configResult.message
          ? `Config relay rejected: ${configResult.message}`
          : "Couldn't save scope.");
        return;
      }
      props.onClose();
    } catch (e: any) {
      setError(e?.message || "Couldn't save settings.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <TakeoverCard onClose={props.onClose}>
        <div class="station-preview-label">Station settings</div>
        <div class="station-preview-frequency">
          <span class="station-preview-hash">#</span>{props.station.id}
        </div>

        <div class="station-preview-row">
          <label class="station-preview-relay-label">NAME</label>
          <input
            type="text"
            class="station-preview-relay"
            placeholder="display name for the station"
            value={name()}
            onInput={(e) => { setName(e.currentTarget.value); setError(""); }}
            disabled={busy()}
          />
        </div>

        <div class="station-preview-row">
          <label class="station-preview-relay-label">SCOPE</label>
          <div class="scope-picker-head">
            <div class="scope-picker-modes">
              <button
                type="button"
                class={`scope-picker-mode ${scopeMode() === "preset" ? "active" : ""}`}
                onClick={() => setScopeMode("preset")}
              >Preset</button>
              <button
                type="button"
                class={`scope-picker-mode ${scopeMode() === "path" ? "active" : ""}`}
                onClick={() => setScopeMode("path")}
              >Draw</button>
            </div>
            <div class="scope-picker-preview">
              <ScopeCanvas seed={previewSeed()} size={48} animated accent transparentBg />
            </div>
          </div>

          <Show when={scopeMode() === "preset"}>
            <div class="scope-picker-grid">
              <For each={variants()}>
                {(s, i) => {
                  const isSelected = () => i() === chosenIdx();
                  return (
                    <button
                      type="button"
                      class={`scope-picker-thumb ${isSelected() ? "selected" : ""}`}
                      onClick={() => setChosenIdx(i())}
                      title="Pick this scope"
                    >
                      <ScopeCanvas seed={s} size={40} animated={isSelected()} accent={isSelected()} transparentBg />
                    </button>
                  );
                }}
              </For>
            </div>
            <button type="button" class="scope-picker-action" onClick={reroll}>
              🎲 Reroll
            </button>
          </Show>

          <Show when={scopeMode() === "path"}>
            <div class="scope-picker-draw">
              <canvas
                ref={pathCanvasRef}
                class="scope-draw-canvas"
                width={PATH_GRID}
                height={PATH_GRID}
                onPointerDown={drawStart}
                onPointerMove={drawMove}
                onPointerUp={drawEnd}
                onPointerCancel={drawEnd}
              />
              <div class="scope-draw-hint">
                Draw your station's signature - `@`, your initials, anything.
                Lift the pen and draw again to add disjoint strokes.
              </div>
            </div>
            <div class="scope-draw-actions">
              <button type="button" class="scope-picker-action" onClick={clearPath}>
                Clear
              </button>
              <button
                type="button"
                class="scope-picker-action"
                onClick={() => { setSvgError(null); setSvgPanelOpen(!svgPanelOpen()); }}
              >
                📋 Paste SVG
              </button>
            </div>
            <Show when={svgPanelOpen()}>
              <div class="scope-svg-panel">
                <textarea
                  class="scope-svg-input"
                  placeholder='<svg viewBox="0 0 24 24"><path d="..."/></svg>'
                  value={svgText()}
                  onInput={(e) => { setSvgText(e.currentTarget.value); setSvgError(null); }}
                  rows={6}
                  spellcheck={false}
                  autocapitalize="off"
                />
                <Show when={svgError()}>
                  <div class="scope-svg-error">{svgError()}</div>
                </Show>
                <div class="scope-svg-actions">
                  <button
                    type="button"
                    class="scope-picker-action"
                    onClick={() => { setSvgPanelOpen(false); setSvgError(null); }}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    class="scope-picker-action"
                    onClick={applySvg}
                    disabled={!svgText().trim()}
                  >
                    Apply
                  </button>
                </div>
              </div>
            </Show>
          </Show>
        </div>

        <div class="station-preview-row">
          <label class="station-preview-relay-label">ABOUT</label>
          <textarea
            class="station-preview-relay station-settings-textarea"
            placeholder="what's this station for?"
            value={about()}
            onInput={(e) => { setAbout(e.currentTarget.value); setError(""); }}
            disabled={busy()}
            rows={3}
          />
        </div>

        <div class="station-preview-row">
          <label class="station-preview-relay-label">ACCESS</label>
          <div class="station-preview-access">
            <button
              type="button"
              class={`station-preview-access-opt ${openAccess() ? "active" : ""}`}
              onClick={() => setOpenAccess(true)}
              disabled={busy()}
            >
              <span class="station-preview-access-name">Open</span>
              <span class="station-preview-access-desc">Anyone can join</span>
            </button>
            <button
              type="button"
              class={`station-preview-access-opt ${!openAccess() ? "active" : ""}`}
              onClick={() => setOpenAccess(false)}
              disabled={busy()}
            >
              <span class="station-preview-access-name">Request access</span>
              <span class="station-preview-access-desc">You approve each join</span>
            </button>
          </div>
        </div>

        {/* NIP-29 kind:9009 invite; relay auto-emits 9000 admitting holder. */}
        <Show when={!openAccess()}>
          <div class="station-preview-row">
            <label class="station-preview-relay-label">INVITE LINK</label>
            <Show when={inviteUrl()} fallback={
              <button
                type="button"
                class="station-preview-cancel"
                onClick={generateInviteLink}
                disabled={inviteBusy() || busy()}
              >
                {inviteBusy() ? "Creating…" : "Generate invite link"}
              </button>
            }>
              <div class="station-preview-id-row">
                <code class="station-preview-id">{inviteUrl()}</code>
                <button
                  type="button"
                  class="station-preview-id-regen"
                  onClick={copyInvite}
                  title="Copy"
                >
                  {inviteCopied() ? "✓" : "⎘"}
                </button>
              </div>
              <p class="station-preview-hint">
                Anyone with this link bypasses the approval queue. Send a new one to revoke (some relays only honor the latest).
              </p>
            </Show>
          </div>
        </Show>

        <Show when={error()}>
          <div class="station-preview-error">{error()}</div>
        </Show>

        <div class="station-preview-actions">
          <button
            type="button"
            class="station-preview-cancel"
            onClick={props.onClose}
            disabled={busy()}
          >
            Cancel
          </button>
          <button
            type="button"
            class="station-preview-join"
            onClick={handleSave}
            disabled={busy()}
          >
            {busy() ? "Saving…" : "Save settings"}
          </button>
        </div>
    </TakeoverCard>
  );
}
