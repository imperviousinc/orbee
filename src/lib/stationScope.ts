export const SCOPE_GRID = 20;

export interface ScopePalette {
  trace: string;
  screen: string;
  grid: string;
}

const MONO_DARK: ScopePalette  = { trace: "#8a8e94", screen: "#141517", grid: "#23262b" };
const MONO_LIGHT: ScopePalette = { trace: "#6a6a70", screen: "#ece7d9", grid: "#cfc8b8" };
const ACCENT_DARK: ScopePalette  = { trace: "#d946ef", screen: "#150f17", grid: "#241b27" };
const ACCENT_LIGHT: ScopePalette = { trace: "#a21caf", screen: "#f5e5f5", grid: "#dcc4dc" };

import { theme } from "./theme";

export function monoPalette(): ScopePalette { return theme() === "light" ? MONO_LIGHT : MONO_DARK; }
export function accentPalette(): ScopePalette { return theme() === "light" ? ACCENT_LIGHT : ACCENT_DARK; }

export const MONO_PALETTE: ScopePalette = MONO_DARK;
export const ACCENT_PALETTE: ScopePalette = ACCENT_DARK;

export type TraceKind =
  | "sine" | "square" | "sawtooth" | "pulse" | "noise"
  | "dualSine" | "lissajous" | "heartbeat" | "staircase" | "damped";

const TRACES: TraceKind[] = [
  "sine", "square", "sawtooth", "pulse", "noise",
  "dualSine", "lissajous", "heartbeat", "staircase", "damped",
];

export interface ScopeSeed {
  bytes: number[];
  trace: TraceKind;
  gridDensity: 0 | 1 | 2;   // 0=none, 1=sparse, 2=dense
  traceThick: boolean;
  scrollSpeed: number;
  freq: number;
  amp: number;
  duty: number;
  freq2: number;
  amp2: number;
  lissA: number;
  lissB: number;
  lissPhase: number;
  /** Free-form path override; when set, replaces seed-derived trace rendering. Coordinates normalized 0..1. */
  path?: PathPoint[];
}

// Custom scope overrides packed into a single tag value so strict NIP-29
// relays don't choke on tag array length:
//   ["scope", "preset:trace=sine;grid=1;thick=1;speed=0.04;..."]
//   ["scope", "path:0.12,0.45;0.23,0.56;..."]

/** A drawn-path point. `jump: true` marks a pen-up so the renderer skips the connecting segment (enables multi-stroke shapes like `@`). */
export interface PathPoint { x: number; y: number; jump?: boolean; }

export type ScopeOverride =
  | { kind: "preset"; params: Partial<ScopeSeed> }
  | { kind: "path"; points: PathPoint[] };

export function parseScopeOverride(tag: string[]): ScopeOverride | null {
  if (tag[0] !== "scope" || tag.length < 2) return null;
  const payload = tag[1];
  const colon = payload.indexOf(":");
  if (colon < 0) return null;
  const mode = payload.slice(0, colon);
  const body = payload.slice(colon + 1);
  if (mode === "preset") {
    const params: Partial<ScopeSeed> = {};
    for (const part of body.split(";")) {
      const eq = part.indexOf("=");
      if (eq < 0) continue;
      const k = part.slice(0, eq);
      const v = part.slice(eq + 1);
      if (!v) continue;
      switch (k) {
        case "trace": if (TRACES.includes(v as TraceKind)) params.trace = v as TraceKind; break;
        case "grid": params.gridDensity = (Math.max(0, Math.min(2, parseInt(v, 10) || 0))) as 0 | 1 | 2; break;
        case "thick": params.traceThick = v === "1" || v === "true"; break;
        case "speed": params.scrollSpeed = parseFloat(v); break;
        case "freq": params.freq = parseFloat(v); break;
        case "amp": params.amp = parseFloat(v); break;
        case "duty": params.duty = parseFloat(v); break;
        case "freq2": params.freq2 = parseFloat(v); break;
        case "amp2": params.amp2 = parseFloat(v); break;
        case "la": params.lissA = parseFloat(v); break;
        case "lb": params.lissB = parseFloat(v); break;
        case "lp": params.lissPhase = parseFloat(v); break;
      }
    }
    return { kind: "preset", params };
  }
  if (mode === "path") {
    // Strokes separated by `|`, points within a stroke by `;`. First point of each
    // stroke after the first gets jump=true to break the connecting segment.
    const points: PathPoint[] = [];
    const strokes = body.split("|");
    for (let s = 0; s < strokes.length; s++) {
      const xys = strokes[s].split(";");
      let firstOfStroke = true;
      for (const xy of xys) {
        const [xs, ys] = xy.split(",");
        const x = parseFloat(xs); const y = parseFloat(ys);
        if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
        const point: PathPoint = (firstOfStroke && s > 0) ? { x, y, jump: true } : { x, y };
        firstOfStroke = false;
        points.push(point);
      }
    }
    if (points.length < 2) return null;
    return { kind: "path", points };
  }
  return null;
}

const FLOAT3 = (n: number) => Number.isFinite(n) ? n.toFixed(3).replace(/\.?0+$/, "") : "0";

export function serializeScopePreset(seed: ScopeSeed): string[] {
  const body = [
    `trace=${seed.trace}`,
    `grid=${seed.gridDensity}`,
    `thick=${seed.traceThick ? "1" : "0"}`,
    `speed=${FLOAT3(seed.scrollSpeed)}`,
    `freq=${FLOAT3(seed.freq)}`,
    `amp=${FLOAT3(seed.amp)}`,
    `duty=${FLOAT3(seed.duty)}`,
    `freq2=${FLOAT3(seed.freq2)}`,
    `amp2=${FLOAT3(seed.amp2)}`,
    `la=${FLOAT3(seed.lissA)}`,
    `lb=${FLOAT3(seed.lissB)}`,
    `lp=${FLOAT3(seed.lissPhase)}`,
  ].join(";");
  return ["scope", `preset:${body}`];
}

export function serializeScopePath(points: PathPoint[]): string[] {
  const strokes: string[][] = [[]];
  for (const p of points) {
    if (p.jump && strokes[strokes.length - 1].length > 0) strokes.push([]);
    strokes[strokes.length - 1].push(`${FLOAT3(p.x)},${FLOAT3(p.y)}`);
  }
  const body = strokes.map(s => s.join(";")).join("|");
  return ["scope", `path:${body}`];
}

/** Apply a preset override on top of a deterministic seed. Returns a new seed. */
export function applyPresetOverride(seed: ScopeSeed, params: Partial<ScopeSeed>): ScopeSeed {
  return { ...seed, ...params };
}

/** Generate a fresh random ScopeSeed. */
export function generateRandomScopeSeed(): ScopeSeed {
  const bytes: number[] = [];
  for (let i = 0; i < 32; i++) bytes.push(Math.floor(Math.random() * 256));
  return seedFromBytes(bytes);
}

function seedFromBytes(b: number[]): ScopeSeed {
  return {
    bytes: b,
    trace: TRACES[b[1] % TRACES.length],
    gridDensity: (b[3] % 3) as 0 | 1 | 2,
    traceThick: (b[4] % 2) === 1,
    scrollSpeed: 0.02 + (b[5] / 255) * 0.06,
    freq: 0.3 + (b[6] / 255) * 0.9,
    amp: 0.15 + (b[7] / 255) * 0.3,
    duty: 0.3 + (b[8] / 255) * 0.4,
    freq2: 0.5 + (b[9] / 255) * 0.8,
    amp2: 0.05 + (b[10] / 255) * 0.15,
    lissA: 1 + (b[6] % 4),
    lissB: 1 + (b[7] % 4),
    lissPhase: (b[8] / 255) * Math.PI,
  };
}

// FNV-1a 32-bit, expanded with rotation per slot.
function seedBytes(input: string, len = 32): number[] {
  const out: number[] = [];
  let h = 0x811c9dc5;
  for (let i = 0; i < len; i++) {
    h ^= i;
    h = Math.imul(h, 0x01000193) >>> 0;
    for (let j = 0; j < input.length; j++) {
      h ^= input.charCodeAt(j);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    out.push(h & 0xff);
  }
  return out;
}

const seedCache = new Map<string, ScopeSeed>();

export function getStationScopeSeed(stationId: string, relay: string): ScopeSeed {
  const key = `${relay}::${stationId}`;
  const hit = seedCache.get(key);
  if (hit) return hit;
  const seed = seedFromBytes(seedBytes(key));
  seedCache.set(key, seed);
  return seed;
}

// Caller provides a 2d context already scaled so 1 unit = 1 pixel of SCOPE_GRID (20×20).
const SCREEN = { l: 0, r: SCOPE_GRID, t: 0, b: SCOPE_GRID };

export interface ScopeRenderOptions {
  /** Skip screen fill + grid + scanlines; draw ONLY the trace on a transparent canvas. */
  bare?: boolean;
  /** Skip screen fill + internal crosshatch grid; container controls the bg. Also skips scanlines (they paint visible black stripes without a screen fill underneath). */
  transparentBg?: boolean;
}

export function renderScope(
  ctx: CanvasRenderingContext2D,
  seed: ScopeSeed,
  frame: number,
  pal: ScopePalette,
  options?: ScopeRenderOptions,
) {
  const t = frame * seed.scrollSpeed;

  if (!options?.bare) {
    if (!options?.transparentBg) drawScreen(ctx, pal);
    if (seed.gridDensity > 0 && !options?.transparentBg) {
      drawGrid(ctx, seed.gridDensity as 1 | 2, pal);
    }
  }
  drawTrace(ctx, seed, t, pal);
  if (!options?.bare && !options?.transparentBg) {
    drawScanlines(ctx, pal);
  }
}

function drawScreen(ctx: CanvasRenderingContext2D, pal: ScopePalette) {
  ctx.fillStyle = pal.screen;
  ctx.fillRect(0, 0, SCOPE_GRID, SCOPE_GRID);
}

function drawGrid(ctx: CanvasRenderingContext2D, density: 1 | 2, pal: ScopePalette) {
  ctx.fillStyle = pal.grid;
  const step = density === 1 ? 3 : 2;
  ctx.globalAlpha = 0.55;
  for (let gx = SCREEN.l + step; gx < SCREEN.r; gx += step) {
    for (let gy = SCREEN.t + 1; gy < SCREEN.b; gy++) {
      ctx.fillRect(gx, gy, 0.25, 1);
    }
  }
  for (let gy = SCREEN.t + step; gy < SCREEN.b; gy += step) {
    for (let gx = SCREEN.l + 1; gx < SCREEN.r; gx++) {
      ctx.fillRect(gx, gy, 1, 0.25);
    }
  }
  ctx.globalAlpha = 0.75;
  const midX = Math.floor((SCREEN.l + SCREEN.r) / 2);
  const midY = Math.floor((SCREEN.t + SCREEN.b) / 2);
  for (let gy = SCREEN.t + 1; gy < SCREEN.b; gy++) ctx.fillRect(midX, gy, 0.25, 1);
  for (let gx = SCREEN.l + 1; gx < SCREEN.r; gx++) ctx.fillRect(gx, midY, 1, 0.25);
  ctx.globalAlpha = 1;
}

function traceValue(seed: ScopeSeed, x: number, t: number): number {
  switch (seed.trace) {
    case "sine":
      return Math.sin(x * seed.freq + t) * seed.amp;
    case "square": {
      const phase = (x * seed.freq * 0.6 + t) % (Math.PI * 2);
      return phase < Math.PI * 2 * seed.duty ? seed.amp : -seed.amp;
    }
    case "sawtooth": {
      const phase = ((x * seed.freq * 0.5 + t) % (Math.PI * 2)) / (Math.PI * 2);
      return (phase * 2 - 1) * seed.amp;
    }
    case "pulse": {
      const phase = (x * seed.freq + t) % (Math.PI * 2);
      return phase < 0.4 ? seed.amp * Math.sin(phase * 8) : 0;
    }
    case "noise": {
      const v = Math.sin(x * 12.9898 + t * 0.3 + seed.bytes[6]) * 43758.5453;
      return (v - Math.floor(v) - 0.5) * seed.amp * 2;
    }
    case "dualSine":
      return Math.sin(x * seed.freq + t) * seed.amp +
             Math.sin(x * seed.freq2 + t * 1.3) * seed.amp2;
    case "heartbeat": {
      const period = 4 + (seed.bytes[6] % 6);
      const phase = ((x * 0.8 + t) % period) / period;
      if (phase < 0.1) return 0;
      if (phase < 0.15) return seed.amp * 1.5 * ((phase - 0.1) / 0.05);
      if (phase < 0.2) return -seed.amp * 0.8;
      if (phase < 0.25) return seed.amp * 0.5;
      return 0;
    }
    case "staircase": {
      const steps = 3 + (seed.bytes[6] % 5);
      const phase = ((x * seed.freq * 0.5 + t) % (Math.PI * 2)) / (Math.PI * 2);
      const step = Math.floor(phase * steps);
      return (step / steps * 2 - 1) * seed.amp;
    }
    case "damped": {
      const period = 8 + (seed.bytes[8] % 8);
      const local = (x + t * 3) % period;
      return Math.sin(local * seed.freq) * seed.amp * Math.exp(-local * 0.3);
    }
    case "lissajous":
      return 0; // handled separately in drawTrace
  }
}

function drawTrace(ctx: CanvasRenderingContext2D, seed: ScopeSeed, t: number, pal: ScopePalette) {
  if (seed.path && seed.path.length >= 2) {
    drawPathTrace(ctx, seed.path, seed.traceThick, t, pal);
    return;
  }
  const tracePixW = SCREEN.r - SCREEN.l - 1;
  const tracePixH = SCREEN.b - SCREEN.t - 1;
  const midY = (SCREEN.t + SCREEN.b) / 2;

  if (seed.trace === "lissajous") {
    // XY mode - closed figure traced incrementally with afterglow.
    const steps = 80;
    for (let i = 0; i < steps; i++) {
      const phase = (i / steps) * Math.PI * 2;
      const lx = Math.sin(seed.lissA * phase + t);
      const ly = Math.sin(seed.lissB * phase + t * 0.7 + seed.lissPhase);
      const px = SCREEN.l + 1 + Math.round((lx * 0.45 + 0.5) * tracePixW);
      const py = SCREEN.t + 1 + Math.round((ly * 0.45 + 0.5) * tracePixH);
      if (px <= SCREEN.l || px >= SCREEN.r || py <= SCREEN.t || py >= SCREEN.b) continue;
      const bright = 0.3 + (i / steps) * 0.7;
      ctx.globalAlpha = bright * 0.9;
      ctx.fillStyle = pal.trace;
      ctx.fillRect(px, py, 1, 1);
    }
    ctx.globalAlpha = 1;
    return;
  }

  let prevPy: number | null = null;
  for (let i = 0; i <= tracePixW; i++) {
    const val = traceValue(seed, i, t);
    const py = Math.round(midY + val * tracePixH);
    const px = SCREEN.l + 1 + i;
    if (px <= SCREEN.l || px >= SCREEN.r || py <= SCREEN.t || py >= SCREEN.b) {
      prevPy = null;
      continue;
    }
    ctx.globalAlpha = 0.95;
    ctx.fillStyle = pal.trace;
    ctx.fillRect(px, py, 1, 1);
    if (seed.traceThick && py + 1 < SCREEN.b) {
      ctx.globalAlpha = 0.45;
      ctx.fillRect(px, py + 1, 1, 1);
    }
    // Connect vertical jumps so square/staircase/pulse traces stay continuous.
    if (prevPy !== null) {
      const minP = Math.min(prevPy, py);
      const maxP = Math.max(prevPy, py);
      if (maxP - minP > 1) {
        ctx.globalAlpha = 0.5;
        ctx.fillStyle = pal.trace;
        for (let vy = minP + 1; vy < maxP; vy++) {
          if (vy > SCREEN.t && vy < SCREEN.b) ctx.fillRect(px, vy, 1, 1);
        }
      }
    }
    prevPy = py;
  }
  ctx.globalAlpha = 1;
}

/** Free-form polyline trace with phosphor afterglow. Strokes split at `jump:true` so the beam doesn't bridge pen-ups. frame=0 renders the full path at base brightness. */
function drawPathTrace(
  ctx: CanvasRenderingContext2D,
  points: PathPoint[],
  thick: boolean,
  t: number,
  pal: ScopePalette,
) {
  const inset = 1;
  const screenW = SCREEN.r - SCREEN.l - inset * 2;
  const screenH = SCREEN.b - SCREEN.t - inset * 2;
  const px = (n: number) => SCREEN.l + inset + Math.max(0, Math.min(1, n)) * screenW;
  const py = (n: number) => SCREEN.t + inset + Math.max(0, Math.min(1, n)) * screenH;

  const strokes: PathPoint[][] = [[]];
  for (const p of points) {
    if (p.jump && strokes[strokes.length - 1].length > 0) strokes.push([]);
    strokes[strokes.length - 1].push(p);
  }
  const validStrokes = strokes.filter(s => s.length > 0);
  if (validStrokes.length === 0) return;

  // Sample each stroke proportional to arc length for visually-constant beam speed.
  const TOTAL_SAMPLES = 96;
  const lens = validStrokes.map(strokeLength);
  const totalLen = lens.reduce((a, b) => a + b, 0) || 1;
  const samples: { x: number; y: number; strokeIdx: number }[] = [];
  for (let s = 0; s < validStrokes.length; s++) {
    const count = Math.max(1, Math.round((lens[s] / totalLen) * TOTAL_SAMPLES));
    const inner = sampleUniform(validStrokes[s], count);
    for (const pt of inner) samples.push({ ...pt, strokeIdx: s });
  }
  const total = samples.length;
  if (total === 0) return;
  const beamPos = (t * 12) % total;

  for (let i = 0; i < total; i++) {
    const p = samples[i];
    const x = px(p.x);
    const y = py(p.y);
    const dist = ((beamPos - i) + total) % total;
    let bright: number;
    if (t === 0) {
      bright = 0.55;
    } else {
      const tail = total * 0.55;
      if (dist < 1) bright = 1;
      else if (dist < tail) bright = 0.6 - (dist / tail) * 0.45;
      else bright = 0.12;
    }
    ctx.globalAlpha = bright;
    ctx.fillStyle = pal.trace;
    ctx.fillRect(x, y, 1, 1);
    if (thick) {
      ctx.globalAlpha = bright * 0.45;
      ctx.fillRect(x, y + 1, 1, 1);
    }
  }

  // Skip connections across stroke boundaries (pen-up).
  ctx.globalAlpha = t === 0 ? 0.4 : 0.5;
  ctx.fillStyle = pal.trace;
  for (let i = 1; i < total; i++) {
    const a = samples[i - 1], b = samples[i];
    if (a.strokeIdx !== b.strokeIdx) continue;
    const ax = px(a.x), ay = py(a.y);
    const bx = px(b.x), by = py(b.y);
    const dx = bx - ax, dy = by - ay;
    const steps = Math.max(Math.abs(dx), Math.abs(dy));
    for (let k = 1; k < steps; k++) {
      ctx.fillRect(ax + (dx * k) / steps, ay + (dy * k) / steps, 1, 1);
    }
  }
  ctx.globalAlpha = 1;
}

function strokeLength(stroke: PathPoint[]): number {
  let total = 0;
  for (let i = 1; i < stroke.length; i++) {
    total += Math.hypot(stroke[i].x - stroke[i - 1].x, stroke[i].y - stroke[i - 1].y);
  }
  return total;
}

function sampleUniform(points: PathPoint[], count: number): { x: number; y: number }[] {
  if (points.length === 0) return [];
  if (points.length === 1) return Array(count).fill({ x: points[0].x, y: points[0].y });
  const lens: number[] = [0];
  for (let i = 1; i < points.length; i++) {
    const dx = points[i].x - points[i - 1].x;
    const dy = points[i].y - points[i - 1].y;
    lens.push(lens[i - 1] + Math.hypot(dx, dy));
  }
  const total = lens[lens.length - 1];
  if (total === 0) return Array(count).fill({ x: points[0].x, y: points[0].y });
  const out: { x: number; y: number }[] = [];
  for (let s = 0; s < count; s++) {
    const target = (s / count) * total;
    let lo = 0, hi = lens.length - 1;
    while (lo + 1 < hi) {
      const mid = (lo + hi) >> 1;
      if (lens[mid] <= target) lo = mid;
      else hi = mid;
    }
    const segLen = lens[hi] - lens[lo] || 1;
    const f = (target - lens[lo]) / segLen;
    out.push({
      x: points[lo].x + (points[hi].x - points[lo].x) * f,
      y: points[lo].y + (points[hi].y - points[lo].y) * f,
    });
  }
  return out;
}

function drawScanlines(ctx: CanvasRenderingContext2D, _pal: ScopePalette) {
  ctx.globalAlpha = 0.08;
  ctx.fillStyle = "#000";
  for (let y = SCREEN.t; y < SCREEN.b; y += 0.75) {
    ctx.fillRect(SCREEN.l, y, SCREEN.r - SCREEN.l, 0.18);
  }
  ctx.globalAlpha = 1;
}
