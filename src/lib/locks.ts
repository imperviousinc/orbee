// Trust anchor lock generator
// Takes a 32-byte hex hash, produces a unique pixel lock grid + palette

const G = 20;

const PALS_DARK = [
  // Orbee brand palette - purple pri, cyan sec accent. Tuned for dark bg.
  { pri:'#8b7aff', sec:'#00e5ff', dark:'#2a1f6a', dim:'#4a3aa8', hi:'#d8c8ff' },
  { pri:'#00e5ff', sec:'#8b7aff', dark:'#004a55', dim:'#006a7a', hi:'#e8e6e1' },
  { pri:'#ffb800', sec:'#ff6e40', dark:'#5a4000', dim:'#8a6a00', hi:'#ffe0a0' },
  { pri:'#ff3c8e', sec:'#b388ff', dark:'#550020', dim:'#8a0040', hi:'#ffc0dd' },
  { pri:'#b388ff', sec:'#00e5ff', dark:'#3a2066', dim:'#6a40aa', hi:'#e0d0ff' },
  { pri:'#76ff03', sec:'#ffb800', dark:'#2a5500', dim:'#4a8a00', hi:'#c0ffc0' },
  { pri:'#18ffff', sec:'#ff3c8e', dark:'#005555', dim:'#008888', hi:'#c0ffff' },
  { pri:'#ff6e40', sec:'#ffb800', dark:'#552200', dim:'#884400', hi:'#ffc0a0' },
];
// Same hue order as DARK so a given hash maps to the same "family" in both
// themes - just darker + less saturated so the lock reads on a white bg.
const PALS_LIGHT = [
  { pri:'#5b44d6', sec:'#007a8a', dark:'#2a1f6a', dim:'#4a3aa8', hi:'#8070d8' },
  { pri:'#007a8a', sec:'#5b44d6', dark:'#004a55', dim:'#006a7a', hi:'#308090' },
  { pri:'#a66a15', sec:'#b8463a', dark:'#5a4000', dim:'#8a6a00', hi:'#c88a30' },
  { pri:'#b82468', sec:'#6a4ac0', dark:'#550020', dim:'#8a0040', hi:'#d04080' },
  { pri:'#6a4ac0', sec:'#007a8a', dark:'#3a2066', dim:'#6a40aa', hi:'#8060d0' },
  { pri:'#4a8a2a', sec:'#a66a15', dark:'#2a5500', dim:'#4a8a00', hi:'#5ca040' },
  { pri:'#0a8a8a', sec:'#b82468', dark:'#005555', dim:'#008888', hi:'#2aa0a0' },
  { pri:'#b8463a', sec:'#a66a15', dark:'#552200', dim:'#884400', hi:'#c8604a' },
];

import { theme } from "./theme";

function palsForTheme() { return theme() === "light" ? PALS_LIGHT : PALS_DARK; }

// Export kept as dark set for legacy imports; runtime uses palsForTheme().
const PALS = PALS_DARK;

type P = [number, number, string];

// ===== SHACKLES =====
const SHACKLES = [
  (cx: number, sm: boolean): P[] => {
    const p: P[] = [], t = sm ? 4 : 3;
    [[cx-2,t],[cx-3,t+1],[cx-3,t+2],[cx-3,t+3],[cx+2,t],[cx+3,t+1],[cx+3,t+2],[cx+3,t+3]].forEach(([x,y]) => p.push([x,y,'P']));
    [[cx-1,t-1],[cx,t-1],[cx+1,t-1]].forEach(([x,y]) => p.push([x,y,'H']));
    return p;
  },
  (cx: number, sm: boolean): P[] => {
    const p: P[] = [], t = sm ? 4 : 2;
    for(let x=cx-3;x<=cx+3;x++) p.push([x,t,x===cx-3||x===cx+3?'P':'H']);
    for(let y=t+1;y<=t+4;y++) { p.push([cx-3,y,'P']); p.push([cx+3,y,'P']); }
    return p;
  },
  (cx: number, sm: boolean): P[] => {
    const p: P[] = [], t = sm ? 3 : 1;
    [[cx-1,t],[cx,t],[cx+1,t]].forEach(([x,y]) => p.push([x,y,'H']));
    [[cx-2,t+1],[cx+2,t+1]].forEach(([x,y]) => p.push([x,y,'P']));
    for(let y=t+2;y<=t+5;y++) { p.push([cx-2,y,'P']); p.push([cx+2,y,'P']); }
    return p;
  },
  (cx: number, sm: boolean): P[] => {
    const p: P[] = [], t = sm ? 4 : 2;
    [[cx-1,t],[cx,t]].forEach(([x,y]) => p.push([x,y,'H']));
    [[cx-2,t+1],[cx+1,t+1]].forEach(([x,y]) => p.push([x,y,'P']));
    for(let y=t+2;y<=t+4;y++) p.push([cx-2,y,'P']);
    for(let y=t+1;y<=t+4;y++) p.push([cx+2,y,'P']);
    p.push([cx+2,t+2,'M']);
    return p;
  },
  (cx: number, sm: boolean): P[] => {
    const p: P[] = [], t = sm ? 3 : 1;
    [[cx-1,t],[cx,t],[cx+1,t]].forEach(([x,y]) => p.push([x,y,'H']));
    [[cx-2,t+1],[cx+2,t+1]].forEach(([x,y]) => p.push([x,y,'P']));
    for(let y=t+2;y<=t+5;y++) { p.push([cx-3,y,'D']); p.push([cx+3,y,'D']); }
    [[cx-1,t+2],[cx+1,t+2]].forEach(([x,y]) => p.push([x,y,'P']));
    for(let y=t+3;y<=t+5;y++) { p.push([cx-1,y,'P']); p.push([cx+1,y,'P']); }
    return p;
  },
  (cx: number, sm: boolean): P[] => {
    const p: P[] = [], t = sm ? 3 : 2;
    for(let x=cx-2;x<=cx+2;x++) p.push([x,t,'H']);
    for(let y=t+1;y<=t+4;y++) { p.push([cx-3,y,'P']); p.push([cx-2,y,'D']); p.push([cx+2,y,'D']); p.push([cx+3,y,'P']); }
    return p;
  },
  (cx: number, sm: boolean): P[] => {
    const p: P[] = [], t = sm ? 3 : 1;
    [[cx-1,t],[cx,t]].forEach(([x,y]) => p.push([x,y,'H']));
    p.push([cx-2,t+1,'P']);
    for(let y=t+2;y<=t+5;y++) p.push([cx-2,y,'P']);
    p.push([cx+2,t+3,'P'],[cx+2,t+4,'P'],[cx+3,t+2,'M'],[cx+3,t+1,'M']);
    return p;
  },
];

// ===== BODIES =====
const BODIES = [
  (cx: number): P[] => {
    const p: P[] = [];
    for(let y=7;y<=14;y++) for(let x=cx-4;x<=cx+4;x++) p.push([x,y,(x===cx-4||x===cx+4||y===7||y===14)?'D':'P']);
    return p;
  },
  (cx: number): P[] => {
    const p: P[] = [], w=[3,4,4,4,4,4,4,3];
    w.forEach((hw,i) => { for(let dx=-hw;dx<=hw;dx++) p.push([cx+dx,7+i,(Math.abs(dx)===hw||i===0||i===w.length-1)?'D':'P']); });
    return p;
  },
  (cx: number): P[] => {
    const p: P[] = [];
    for(let i=0;i<8;i++) { const w=3+Math.min(i,3); for(let dx=-w;dx<=w;dx++) p.push([cx+dx,7+i,(Math.abs(dx)===w||i===0||i===7)?'D':'P']); }
    return p;
  },
  (cx: number): P[] => {
    const p: P[] = [], w=[3,4,5,5,5,5,4,3];
    w.forEach((hw,i) => { for(let dx=-hw;dx<=hw;dx++) p.push([cx+dx,7+i,(Math.abs(dx)===hw||i===0||i===w.length-1)?'D':'P']); });
    return p;
  },
  (cx: number): P[] => {
    const p: P[] = [];
    for(let y=6;y<=15;y++) for(let x=cx-3;x<=cx+3;x++) p.push([x,y,(x===cx-3||x===cx+3||y===6||y===15)?'D':'P']);
    return p;
  },
  (cx: number): P[] => {
    const p: P[] = [];
    for(let y=8;y<=14;y++) for(let x=cx-5;x<=cx+5;x++) p.push([x,y,(x===cx-5||x===cx+5||y===8||y===14)?'D':'P']);
    return p;
  },
];

// ===== KEYHOLES =====
const KEYHOLES = [
  (cx: number): P[] => [[cx,9,'S'],[cx-1,9,'D'],[cx+1,9,'D'],[cx,10,'S'],[cx,11,'S'],[cx,12,'M']],
  (cx: number): P[] => [[cx-1,9,'D'],[cx,9,'S'],[cx+1,9,'D'],[cx-1,10,'D'],[cx,10,'S'],[cx+1,10,'D'],[cx,11,'S']],
  (cx: number): P[] => [[cx,9,'S'],[cx-1,10,'S'],[cx,10,'D'],[cx+1,10,'S'],[cx,11,'S'],[cx,12,'M']],
  (cx: number): P[] => [[cx,9,'S'],[cx,10,'S'],[cx,11,'S'],[cx,12,'M']],
  (cx: number): P[] => [[cx,9,'S'],[cx-1,10,'S'],[cx,10,'D'],[cx+1,10,'S'],[cx,11,'S']],
  (cx: number): P[] => [[cx-1,9,'S'],[cx+1,9,'S'],[cx-1,10,'D'],[cx+1,10,'D'],[cx,11,'S'],[cx,12,'M']],
  (cx: number): P[] => [[cx-1,9,'S'],[cx,9,'H'],[cx+1,9,'S'],[cx-2,10,'D'],[cx-1,10,'S'],[cx,10,'D'],[cx+1,10,'S'],[cx+2,10,'D'],[cx,11,'S'],[cx,12,'S']],
];

// ===== RIVETS =====
const RIVETS = [
  (): P[] => [],
  (cx: number): P[] => [[cx-3,8,'H'],[cx+3,8,'H'],[cx-3,14,'H'],[cx+3,14,'H']],
  (cx: number): P[] => [[cx-3,10,'H'],[cx-3,11,'H'],[cx+3,10,'H'],[cx+3,11,'H']],
  (cx: number): P[] => { const p: P[] = []; for(let x=cx-3;x<=cx+3;x++) p.push([x,8,'M']); return p; },
  (cx: number): P[] => [[cx-3,8,'H'],[cx-2,9,'H'],[cx+3,14,'H'],[cx+2,12,'H']],
  (cx: number): P[] => {
    const p: P[] = [];
    for(let x=cx-3;x<=cx+3;x+=2) { p.push([x,8,'H']); p.push([x,14,'H']); }
    for(let y=9;y<=12;y+=2) { p.push([cx-3,y,'H']); p.push([cx+3,y,'H']); }
    return p;
  },
  (cx: number): P[] => [[cx-1,12,'H'],[cx,12,'H'],[cx+1,12,'H'],[cx-1,14,'H'],[cx,14,'M'],[cx+1,14,'H']],
];

function hexBytes(hex: string): number[] {
  const b: number[] = [];
  for (let i = 0; i < Math.min(hex.length, 16); i += 2) b.push(parseInt(hex.substr(i, 2), 16) || 0);
  while (b.length < 8) b.push(b.length * 37 & 0xff);
  return b;
}

export interface LockData {
  grid: number[][];
  pal: typeof PALS[0];
}

export function assembleLock(hashHex: string): LockData {
  const b = hexBytes(hashHex);
  const pool = palsForTheme();
  const pal = pool[b[0] % pool.length];
  const shackle = SHACKLES[b[1] % SHACKLES.length];
  const body = BODIES[b[2] % BODIES.length];
  const keyhole = KEYHOLES[b[3] % KEYHOLES.length];
  const rivet = RIVETS[b[4] % RIVETS.length];
  const isSmall = b[5] % 2 === 1;

  const cx = 10;
  const grid: number[][] = Array.from({ length: G }, () => Array(G).fill(0));
  const cmap: Record<string, number> = { P:1, D:2, M:3, S:4, H:5 };

  function stamp(pixels: P[]) {
    for (const [x, y, c] of pixels) {
      if (x >= 0 && x < G && y >= 0 && y < G && c) grid[y][x] = cmap[c] || 0;
    }
  }

  stamp(body(cx));
  stamp(shackle(cx, isSmall));
  stamp(keyhole(cx));
  stamp(rivet(cx));

  return { grid, pal };
}
