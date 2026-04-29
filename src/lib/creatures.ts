// Deterministic creature avatar generator
// Takes a hex string (pubkey), outputs a cached data URL

import { handleHue, handleLightTier } from "./colors";

const PX = 5;
const G = 20;

/**
 * HSL → #rrggbb. Inlined so the creature palette can be computed on
 * demand in one call without a dependency. Accepts h ∈ [0,360),
 * s + l ∈ [0,100].
 */
function hslToHex(h: number, s: number, l: number): string {
  s /= 100;
  l /= 100;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const c = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(255 * c)
      .toString(16)
      .padStart(2, "0");
  };
  return "#" + f(0) + f(8) + f(4);
}

/**
 * Creature palette derived from a pubkey's handle hue. Body gets a
 * saturated version of the handle color (so creature and handle-text
 * read as one identity signal); dark/dim are shadow tones of the same
 * hue; eye/eyeHi land on the complementary hue so the face reads as
 * an accent against the body. All colors work on both themes because
 * the creature is rendered into a canvas with no theme-dependent
 * opacity tricks. */
interface CreaturePalette {
  body: string;
  dark: string;
  dim: string;
  eye: string;
  eyeHi: string;
  ant: string;
}

function creaturePalette(pubkey: string): CreaturePalette {
  const h = handleHue(pubkey);
  const tier = handleLightTier(pubkey);
  // Body lightness tracks the handle's lightness tier so creature
  // and handle stay visually matched. Gentler step (±5% per tier,
  // ±10% total) for the saturated body - ±16% would push the
  // extremes toward pure black / near-white and lose color.
  const bodyL = Math.max(30, Math.min(70, 52 + tier * 5));
  const compl = (h + 175) % 360;
  return {
    body: hslToHex(h, 82, bodyL),
    dark: hslToHex(h, 70, 18),
    dim: hslToHex(h, 72, 32),
    eye: hslToHex(compl, 85, 60),
    eyeHi: hslToHex(compl, 55, 86),
    ant: hslToHex(h, 62, 30),
  };
}

// Creature palettes are now procedurally derived from the pubkey's
// handle hue - see creaturePalette() above. Removed the hardcoded
// 14-entry PALETTES table; the hue rotation is effectively unbounded.

type ColorKey = 'B'|'D'|'M'|'E'|'H'|'A';
type Pixel = [number, number, ColorKey | null];

// ===== BODY TEMPLATES =====
function bodyInvader(cx: number): Pixel[] {
  const p: Pixel[] = [];
  p.push([cx-4,4,'B'],[cx+3,4,'B']);
  p.push([cx-3,5,'B'],[cx+2,5,'B']);
  for(let i=-3;i<=2;i++) p.push([cx+i,6,'B']);
  for(let i=-4;i<=3;i++) p.push([cx+i,7,(i===-4||i===3)?'D':'B']);
  p.push([cx-5,7,'B'],[cx+4,7,'B']);
  for(let r=8;r<=10;r++) for(let i=-5;i<=4;i++) p.push([cx+i,r,(i===-5||i===4)?'D':'B']);
  for(let i=-4;i<=3;i++) p.push([cx+i,11,(i===-4||i===3)?'D':'B']);
  for(let i=-3;i<=2;i++) p.push([cx+i,12,'B']);
  return p;
}

function bodyBug(cx: number): Pixel[] {
  const p: Pixel[] = [];
  const w = [1,2,3,4,5,5,5,4,3];
  for(let r=0;r<w.length;r++){
    for(let i=-w[r];i<w[r];i++){
      const edge = i===-w[r]||i===w[r]-1;
      p.push([cx+i, 4+r, (r===0||r===w.length-1||edge)?'D':'B']);
    }
  }
  return p;
}

function bodyOrb(cx: number): Pixel[] {
  const p: Pixel[] = [];
  const w = [3,4,5,6,6,6,6,6,5,4,3];
  for(let r=0;r<w.length;r++){
    for(let i=-w[r];i<w[r];i++){
      const edge = i===-w[r]||i===w[r]-1||r===0||r===w.length-1;
      p.push([cx+i, 3+r, edge?'D':'B']);
    }
  }
  return p;
}

function bodyShield(cx: number): Pixel[] {
  const p: Pixel[] = [];
  const w = [6,7,7,7,6,5,4,3,2];
  for(let r=0;r<w.length;r++){
    for(let i=-w[r];i<w[r];i++){
      const edge = i===-w[r]||i===w[r]-1||r===0||r===w.length-1;
      p.push([cx+i, 3+r, edge?'D':'B']);
    }
  }
  return p;
}

function bodyGhost(cx: number): Pixel[] {
  const p: Pixel[] = [];
  const w = [3,4,5,5,5,5,5,5,5,5];
  for(let r=0;r<w.length;r++){
    for(let i=-w[r];i<w[r];i++){
      if(r===w.length-1 && (Math.abs(i)%3===0)) continue;
      const edge = i===-w[r]||i===w[r]-1||r===0;
      p.push([cx+i, 3+r, edge?'D':'B']);
    }
  }
  return p;
}

const BODIES = [bodyInvader, bodyBug, bodyOrb, bodyShield, bodyGhost];

// ===== EYE TEMPLATES =====
function eyesClassic(cx: number, ey: number): Pixel[] {
  return [
    [cx-3,ey-1,null],[cx-2,ey-1,null],
    [cx-3,ey,'E'],[cx-2,ey,'H'],[cx-3,ey+1,'E'],[cx-2,ey+1,'E'],
    [cx-3,ey+2,null],[cx-2,ey+2,null],
    [cx+1,ey-1,null],[cx+2,ey-1,null],
    [cx+1,ey,'E'],[cx+2,ey,'H'],[cx+1,ey+1,'E'],[cx+2,ey+1,'E'],
    [cx+1,ey+2,null],[cx+2,ey+2,null],
  ];
}

function eyesSlit(cx: number, ey: number): Pixel[] {
  return [
    [cx-3,ey,null],[cx-2,ey,'E'],[cx-1,ey,'H'],
    [cx+1,ey,'E'],[cx+2,ey,'H'],[cx+3,ey,null],
  ];
}

function eyesCyclops(cx: number, ey: number): Pixel[] {
  const p: Pixel[] = [];
  for(let dx=-2;dx<=1;dx++) p.push([cx+dx,ey-1,null]);
  p.push([cx-2,ey,'E'],[cx-1,ey,'E'],[cx,ey,'H'],[cx+1,ey,'E']);
  p.push([cx-2,ey+1,'E'],[cx-1,ey+1,'E'],[cx,ey+1,'E'],[cx+1,ey+1,'E']);
  for(let dx=-2;dx<=1;dx++) p.push([cx+dx,ey+2,null]);
  return p;
}

function eyesDot(cx: number, ey: number): Pixel[] {
  return [[cx-2,ey,'E'],[cx-2,ey+1,'H'],[cx+1,ey,'E'],[cx+1,ey+1,'H']];
}

function eyesWide(cx: number, ey: number): Pixel[] {
  return [
    [cx-4,ey-1,null],[cx-3,ey-1,null],
    [cx-4,ey,'E'],[cx-3,ey,'H'],[cx-4,ey+1,'E'],[cx-3,ey+1,'E'],
    [cx+2,ey-1,null],[cx+3,ey-1,null],
    [cx+2,ey,'E'],[cx+3,ey,'H'],[cx+2,ey+1,'E'],[cx+3,ey+1,'E'],
  ];
}

const EYE_SETS = [eyesClassic, eyesSlit, eyesCyclops, eyesDot, eyesWide];

// ===== ANTENNAE =====
function antNone(): Pixel[] { return []; }
function antShort(cx: number): Pixel[] {
  return [[cx-2,1,'A'],[cx+1,1,'A'],[cx-1,2,'A'],[cx,2,'A'],[cx-2,0,'E'],[cx+1,0,'E']];
}
function antTall(cx: number): Pixel[] {
  return [[cx-1,3,'A'],[cx,3,'A'],[cx-2,2,'A'],[cx+1,2,'A'],[cx-2,1,'A'],[cx+1,1,'A'],[cx-2,0,'E'],[cx+1,0,'E']];
}
function antCurved(cx: number): Pixel[] {
  return [[cx-1,3,'A'],[cx,3,'A'],[cx-2,2,'A'],[cx+1,2,'A'],[cx-3,1,'A'],[cx+2,1,'A'],[cx-3,0,'E'],[cx+2,0,'E']];
}
function antSpike(cx: number): Pixel[] {
  return [[cx-1,3,'A'],[cx,3,'A'],[cx-1,2,'A'],[cx,2,'A'],[cx-1,1,'E'],[cx,1,'E'],[cx-1,0,'H'],[cx,0,'H']];
}

const ANTENNAE = [antNone, antShort, antTall, antCurved, antSpike];

// ===== LEGS =====
function legsNone(): Pixel[] { return []; }
function legsStraight(cx: number, ly: number): Pixel[] {
  return [[cx-2,ly,'D'],[cx+1,ly,'D'],[cx-2,ly+1,'D'],[cx+1,ly+1,'D']];
}
function legsSplayed(cx: number, ly: number): Pixel[] {
  return [[cx-2,ly,'D'],[cx+1,ly,'D'],[cx-3,ly+1,'D'],[cx+2,ly+1,'D'],[cx-4,ly+2,'D'],[cx+3,ly+2,'D']];
}
function legsStubby(cx: number, ly: number): Pixel[] {
  return [[cx-3,ly,'D'],[cx-2,ly,'D'],[cx+1,ly,'D'],[cx+2,ly,'D']];
}
function legsAngled(cx: number, ly: number): Pixel[] {
  return [[cx-1,ly,'D'],[cx,ly,'D'],[cx-2,ly+1,'D'],[cx+1,ly+1,'D'],[cx-3,ly+2,'B'],[cx+2,ly+2,'B']];
}

const LEG_SETS = [legsNone, legsStraight, legsSplayed, legsStubby, legsAngled];

// ===== MOUTHS =====
function mouthNone(): Pixel[] { return []; }
function mouthSmirk(cx: number, my: number): Pixel[] { return [[cx-1,my,'M'],[cx,my,'M']]; }
function mouthWide(cx: number, my: number): Pixel[] { return [[cx-2,my,'M'],[cx-1,my,'M'],[cx,my,'M'],[cx+1,my,'M']]; }

const MOUTH_SETS = [mouthNone, mouthSmirk, mouthWide, mouthNone];

// ===== ASSEMBLE + RENDER TO DATA URL =====

function hexBytes(hex: string): number[] {
  const b: number[] = [];
  for (let i = 0; i < Math.min(hex.length, 16); i += 2) {
    b.push(parseInt(hex.substr(i, 2), 16) || 0);
  }
  // Pad if short
  while (b.length < 8) b.push(b.length * 37 & 0xff);
  return b;
}

// Expose creature data for animated rendering
export interface CreatureData {
  grid: number[][];
  colors: Record<number, string>;
}

export function getCreatureData(pubkey: string): CreatureData {
  const b = hexBytes(pubkey);
  const pal = creaturePalette(pubkey);
  const bodyFn = BODIES[b[1] % BODIES.length];
  const eyeFn = EYE_SETS[b[2] % EYE_SETS.length];
  const antFn = ANTENNAE[b[3] % ANTENNAE.length];
  const legFn = LEG_SETS[b[4] % LEG_SETS.length];
  const mouthFn = MOUTH_SETS[b[5] % MOUTH_SETS.length];

  const cx = 10;
  const grid: number[][] = Array.from({ length: G }, () => Array(G).fill(0));
  const cmap: Record<string, number> = { B:1, D:2, M:3, E:4, H:5, A:6 };

  function stamp(pixels: Pixel[]) {
    for (const [x, y, c] of pixels) {
      if (x >= 0 && x < G && y >= 0 && y < G) {
        grid[y][x] = c === null ? 0 : (cmap[c] || 0);
      }
    }
  }

  stamp(bodyFn(cx));
  stamp(eyeFn(cx, 8));
  stamp(antFn(cx));
  stamp(mouthFn(cx, 11));
  stamp(legFn(cx, 14));

  const colors: Record<number, string> = {
    1: pal.body, 2: pal.dark, 3: pal.dim, 4: pal.eye, 5: pal.eyeHi, 6: pal.ant,
  };

  return { grid, colors };
}

// Cache version - bump to invalidate after visual changes.
// v6: lightness tier expanded from 3 values to 5; body lightness
// step tightened so the saturated body doesn't wash out at extremes.
// v7: brand accent swapped from phosphor green to brand purple, and
// the per-user hue rotation's reserved band shifted from 112° (green)
// to 248° (purple). Users whose hash landed in the old band need
// their creature regenerated to pick up their new rotation slot.
// v8: avatar canvas cropped to a square that wraps the creature's
// bounding box (instead of the full 20×20 grid). Eliminates the
// dead vertical space below the legs that made avatars look
// off-center inside circular UI containers.
const CACHE_VER = 8;
const avatarCache = new Map<string, string>();

export function getCreatureAvatar(pubkey: string): string {
  const key = pubkey + "_v" + CACHE_VER;
  const cached = avatarCache.get(key);
  if (cached) return cached;

  const b = hexBytes(pubkey);
  // Body color matches the user's handle hue (see colors.ts). Body
  // shape / eyes / antennae / legs / mouth still vary per-byte so
  // two users at similar hues still look distinct in silhouette.
  const pal = creaturePalette(pubkey);
  const bodyFn = BODIES[b[1] % BODIES.length];
  const eyeFn = EYE_SETS[b[2] % EYE_SETS.length];
  const antFn = ANTENNAE[b[3] % ANTENNAE.length];
  const legFn = LEG_SETS[b[4] % LEG_SETS.length];
  const mouthFn = MOUTH_SETS[b[5] % MOUTH_SETS.length];

  const cx = 10;
  const grid: number[][] = Array.from({ length: G }, () => Array(G).fill(0));
  const cmap: Record<string, number> = { B:1, D:2, M:3, E:4, H:5, A:6 };

  function stamp(pixels: Pixel[]) {
    for (const [x, y, c] of pixels) {
      if (x >= 0 && x < G && y >= 0 && y < G) {
        grid[y][x] = c === null ? 0 : (cmap[c] || 0);
      }
    }
  }

  stamp(bodyFn(cx));
  stamp(eyeFn(cx, 8));
  stamp(antFn(cx));
  stamp(mouthFn(cx, 11));
  stamp(legFn(cx, b[1] % BODIES.length === 4 ? 14 : 14)); // ghost vs others
  // slight variation on leg row based on body

  const colors: Record<number, string> = {
    1: pal.body, 2: pal.dark, 3: pal.dim, 4: pal.eye, 5: pal.eyeHi, 6: pal.ant,
  };

  // Compute the creature's actual bounding box. The 20×20 grid is much
  // bigger than any single creature shape - without cropping the
  // canvas to the bbox, the PNG ships with asymmetric whitespace
  // (more below the legs than above the antennae) that makes the
  // avatar look like it's floating up-and-left inside its container.
  let minX = G, maxX = -1, minY = G, maxY = -1;
  for (let y = 0; y < G; y++) {
    for (let x = 0; x < G; x++) {
      if (grid[y][x]) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  const cellW = Math.max(1, maxX - minX + 1);
  const cellH = Math.max(1, maxY - minY + 1);
  // Square canvas sized to the larger bbox dim, with the bbox centered
  // inside it. Adds 1 cell of breathing room on each side so the glow
  // pass (which paints ±2px outside each cell) doesn't get clipped at
  // the canvas edge.
  const cellSize = Math.max(cellW, cellH) + 2;
  const offX = Math.floor((cellSize - cellW) / 2) - minX;
  const offY = Math.floor((cellSize - cellH) / 2) - minY;

  const canvas = document.createElement("canvas");
  canvas.width = cellSize * PX;
  canvas.height = cellSize * PX;
  const ctx = canvas.getContext("2d")!;

  // Glow pass
  ctx.globalAlpha = 0.15;
  for (let y = 0; y < G; y++) {
    for (let x = 0; x < G; x++) {
      const v = grid[y][x];
      if (!v || !colors[v]) continue;
      ctx.fillStyle = colors[v];
      ctx.fillRect((x + offX) * PX - 2, (y + offY) * PX - 2, PX + 4, PX + 4);
    }
  }

  // Main pixels
  ctx.globalAlpha = 1;
  for (let y = 0; y < G; y++) {
    for (let x = 0; x < G; x++) {
      const v = grid[y][x];
      if (!v || !colors[v]) continue;
      ctx.fillStyle = colors[v];
      ctx.fillRect((x + offX) * PX, (y + offY) * PX, PX, PX);
    }
  }

  const url = canvas.toDataURL("image/png");
  avatarCache.set(key, url);
  return url;
}

// Get the palette color for a pubkey (for colored borders, etc.)
export function getCreatureColor(pubkey: string): string {
  return creaturePalette(pubkey).body;
}
