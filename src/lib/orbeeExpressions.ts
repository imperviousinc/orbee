export type OrbeeExpressionName =
  | "idle"
  | "happy"
  | "happyTalking"
  | "talking"
  | "friendlyTalking"
  | "angry"
  | "pokerFace"
  | "sideEye"
  | "glasses"
  | "glassesHappy"
  | "surprised"
  | "orbeeAt"
  | "nodding"
  | "waving"
  | "looking"
  | "thinking"
  | "error"
  | "celebrate"
  | "sleeping"
  | "loading"
  | "pirateHat"
  | "pirateHappy"
  | "pirateHappyTalking"
  | "pirateSurprised"
  | "atIdle"
  | "atClaimed"
  | "atUnavailable"
  | "atConfirmed"
  | "pirateLoading"
  | "pirateCool"
  | "pirateCoolHappy";

export type OrbeeBehavior = "idle" | "nod" | "wave" | "look" | "bounce" | "shake" | "sleep";

export interface OrbeeExpressionConfig {
  /** Per-frame sprite. Return null to use BASE_GRID. */
  getSprite: (frame: number) => number[][] | null;
  behavior: OrbeeBehavior;
  noBlink?: boolean;
}

export const GRID = 20;

export const ORBEE_PALETTE: Record<number, string> = {
  1: "#d946ef", // body
  2: "#3a0a3a", // mouth/brow shadow
  3: "#ffffff", // eyes
  4: "#e8e6e1", // teeth/sparkle fill
  5: "#8b1a8b", // feet/hat trim/thinking dots
  6: "#222222", // glasses/hat
  7: "#ffb800", // celebrate sparkles
  8: "#ff3c8e", // heart/X eyes/error
  9: "#ff8833", // @ symbol
  10: "#39ff14", // verified/signed mark
};

/** MUST be GRID x GRID (20x20). All sprite generators clone this. */
export const BASE_GRID: number[][] = [
  [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
  [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
  [0,0,0,0,0,0,1,0,0,0,0,0,0,1,0,0,0,0,0,0],
  [0,0,0,0,0,0,0,1,0,0,0,0,1,0,0,0,0,0,0,0],
  [0,0,0,0,0,0,1,1,1,1,1,1,1,1,0,0,0,0,0,0],
  [0,0,0,0,0,1,1,0,1,1,1,1,0,1,1,0,0,0,0,0],
  [0,0,0,0,1,1,1,1,1,1,1,1,1,1,1,1,0,0,0,0],
  [0,0,0,0,1,0,1,1,1,1,1,1,1,1,0,1,0,0,0,0],
  [0,0,0,0,1,0,1,0,0,1,1,0,0,1,0,1,0,0,0,0],
  [0,0,0,0,1,0,1,0,3,1,1,3,0,1,0,1,0,0,0,0],
  [0,0,0,0,1,0,1,0,0,1,1,0,0,1,0,1,0,0,0,0],
  [0,0,0,0,1,1,1,1,1,1,1,1,1,1,1,1,0,0,0,0],
  [0,0,0,0,0,1,1,1,1,5,5,1,1,1,1,0,0,0,0,0],
  [0,0,0,0,0,0,1,1,1,1,1,1,1,1,0,0,0,0,0,0],
  [0,0,0,0,0,0,0,1,0,0,0,0,1,0,0,0,0,0,0,0],
  [0,0,0,0,0,0,1,0,0,0,0,0,0,1,0,0,0,0,0,0],
  [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
  [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
  [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
  [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
];

const clone = (s: number[][]): number[][] => s.map((r) => [...r]);

function makeBlink() {
  const s = clone(BASE_GRID);
  s[9] = [0,0,0,0,1,0,1,0,0,1,1,0,0,1,0,1,0,0,0,0];
  return s;
}
function makeHappy() {
  const s = clone(BASE_GRID);
  s[8] = [0,0,0,0,1,0,1,0,3,1,1,0,3,1,0,1,0,0,0,0];
  s[9] = [0,0,0,0,1,0,1,0,0,1,1,0,0,1,0,1,0,0,0,0];
  s[12] = [0,0,0,0,0,1,1,2,4,4,4,4,2,1,1,0,0,0,0,0];
  s[13] = [0,0,0,0,0,0,1,1,2,2,2,2,1,1,0,0,0,0,0,0];
  s[14] = [0,0,0,0,0,0,0,1,1,1,1,1,1,0,0,0,0,0,0,0];
  return s;
}
function makeSurprised() {
  const s = clone(BASE_GRID);
  s[7] = [0,0,0,0,1,0,1,0,0,1,1,0,0,1,0,1,0,0,0,0];
  s[8] = [0,0,0,0,1,0,1,0,0,1,1,0,0,1,0,1,0,0,0,0];
  s[9] = [0,0,0,0,1,0,1,0,3,1,1,0,3,1,0,1,0,0,0,0];
  s[10] = [0,0,0,0,1,0,1,0,0,1,1,0,0,1,0,1,0,0,0,0];
  s[12] = [0,0,0,0,0,1,1,1,1,2,2,1,1,1,1,0,0,0,0,0];
  s[13] = [0,0,0,0,0,0,1,1,1,2,2,1,1,1,0,0,0,0,0,0];
  s[14] = [0,0,0,0,0,0,0,1,1,1,1,1,1,0,0,0,0,0,0,0];
  return s;
}
function makeGlasses() {
  const s = clone(BASE_GRID);
  s[7]  = [0,0,0,0,1,0,6,6,6,6,6,6,6,6,0,1,0,0,0,0];
  s[8]  = [0,0,0,6,6,6,6,6,6,1,1,6,6,6,6,6,6,0,0,0];
  s[9]  = [0,0,0,0,1,0,6,6,6,1,1,6,6,6,0,1,0,0,0,0];
  s[10] = [0,0,0,0,1,0,1,0,0,1,1,0,0,1,0,1,0,0,0,0];
  return s;
}
function makeGlassesHappy() {
  const s = makeGlasses();
  s[12] = [0,0,0,0,0,1,1,2,4,4,4,4,2,1,1,0,0,0,0,0];
  s[13] = [0,0,0,0,0,0,1,1,2,2,2,2,1,1,0,0,0,0,0,0];
  s[14] = [0,0,0,0,0,0,0,1,1,1,1,1,1,0,0,0,0,0,0,0];
  return s;
}
function makeLookLeft() {
  const s = clone(BASE_GRID);
  s[9] = [0,0,0,0,1,0,1,3,0,1,1,0,3,1,0,1,0,0,0,0];
  return s;
}
function makeLookRight() {
  const s = clone(BASE_GRID);
  s[9] = [0,0,0,0,1,0,1,0,0,3,1,0,0,3,0,1,0,0,0,0];
  return s;
}
function makeNodUp() {
  const s = clone(BASE_GRID);
  s[1] = [0,0,0,0,0,1,0,0,0,0,0,0,0,0,1,0,0,0,0,0];
  s[2] = [0,0,0,0,0,0,1,0,0,0,0,0,0,1,0,0,0,0,0,0];
  return s;
}
function makeNodDown() {
  const s = clone(BASE_GRID);
  s[2] = [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0];
  s[3] = [0,0,0,0,0,1,0,1,0,0,0,0,1,0,1,0,0,0,0,0];
  return s;
}
function makeWaveUp() {
  const s = clone(BASE_GRID);
  s[1] = [0,0,0,0,0,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0];
  s[2] = [0,0,0,0,0,0,1,0,0,0,0,0,0,1,0,0,0,0,0,0];
  return s;
}
function makeWaveDown() {
  const s = clone(BASE_GRID);
  s[2] = [0,0,0,0,0,0,0,0,0,0,0,0,0,1,0,0,0,0,0,0];
  s[3] = [0,0,0,0,0,1,0,1,0,0,0,0,1,0,0,0,0,0,0,0];
  return s;
}
function makeThinking() {
  const s = clone(BASE_GRID);
  s[8] = [0,0,0,0,1,0,1,0,3,1,1,3,0,1,0,1,0,0,0,0];
  s[9] = [0,0,0,0,1,0,1,0,0,1,1,0,0,1,0,1,0,0,0,0];
  s[0] = [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,5,0,0,0,0];
  s[1] = [0,0,0,0,0,0,0,0,0,0,0,0,0,0,5,0,5,0,0,0];
  return s;
}
function makeError() {
  const s = clone(BASE_GRID);
  s[8]  = [0,0,0,0,1,0,1,8,0,1,1,0,8,1,0,1,0,0,0,0];
  s[9]  = [0,0,0,0,1,0,1,0,8,1,1,8,0,1,0,1,0,0,0,0];
  s[10] = [0,0,0,0,1,0,1,8,0,1,1,0,8,1,0,1,0,0,0,0];
  s[12] = [0,0,0,0,0,1,1,1,1,1,1,1,1,1,1,0,0,0,0,0];
  return s;
}
function makeCelebrate() {
  const s = makeHappy();
  s[0]  = [0,0,0,0,7,0,0,0,0,0,0,0,0,0,0,7,0,0,0,0];
  s[1]  = [0,0,7,0,0,0,0,0,0,0,0,0,0,0,0,0,0,7,0,0];
  s[16] = [0,0,0,0,0,7,0,0,0,0,0,0,0,0,7,0,0,0,0,0];
  return s;
}
function makeSleep() {
  const s = clone(BASE_GRID);
  s[8]  = [0,0,0,0,1,0,1,0,0,1,1,0,0,1,0,1,0,0,0,0];
  s[9]  = [0,0,0,0,1,0,1,5,5,1,1,5,5,1,0,1,0,0,0,0];
  s[10] = [0,0,0,0,1,0,1,0,0,1,1,0,0,1,0,1,0,0,0,0];
  s[2]  = [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0];
  s[3]  = [0,0,0,0,0,1,0,0,0,0,0,0,0,0,1,0,0,0,0,0];
  return s;
}
function makeLoad(phase: number) {
  const s = clone(BASE_GRID);
  s[8]  = [0,0,0,0,1,0,1,0,0,1,1,0,0,1,0,1,0,0,0,0];
  s[9]  = [0,0,0,0,1,0,1,0,0,1,1,0,0,1,0,1,0,0,0,0];
  s[10] = [0,0,0,0,1,0,1,0,0,1,1,0,0,1,0,1,0,0,0,0];
  const pos: [number, number][] = [[8,8],[8,9],[8,10],[7,10],[7,9],[7,8]];
  const p = phase % 6;
  const [lx, ly] = pos[p];
  const [rx, ry] = pos[(p + 3) % 6];
  s[ly][lx] = 3;
  if (rx + 5 < GRID) s[ry][rx + 5] = 3;
  return s;
}
function addHat(s: number[][]) {
  s[0] = [0,0,0,0,0,0,0,0,5,6,6,5,0,0,0,0,0,0,0,0];
  s[1] = [0,0,0,0,0,0,5,6,6,6,6,6,6,5,0,0,0,0,0,0];
  s[2] = [0,0,0,0,0,5,6,6,4,6,6,4,6,6,5,0,0,0,0,0];
  s[3] = [0,0,0,5,5,6,6,6,6,6,6,6,6,6,6,5,5,0,0,0];
  return s;
}

function makePirateHat() { return addHat(clone(BASE_GRID)); }
function makePirateHappy() { return addHat(makeHappy()); }
function makePirateSurprised() { return addHat(makeSurprised()); }
function makePirateLoading(phase: number) { return addHat(makeLoad(phase)); }
function makePirateCool() { return addHat(makeGlasses()); }
function makePirateCoolHappy() { return addHat(makeGlassesHappy()); }

function makeTalking(f: number) {
  const s = clone(BASE_GRID);
  const phase = Math.floor(f / 12) % 4;
  if (phase === 1 || phase === 3) {
    s[12] = [0,0,0,0,0,1,1,1,2,2,2,2,1,1,1,0,0,0,0,0];
  } else if (phase === 2) {
    s[12] = [0,0,0,0,0,1,1,2,2,2,2,2,2,1,1,0,0,0,0,0];
    s[13] = [0,0,0,0,0,0,1,1,2,2,2,2,1,1,0,0,0,0,0,0];
    s[14] = [0,0,0,0,0,0,0,1,1,1,1,1,1,0,0,0,0,0,0,0];
  }
  return s;
}

function makeFriendlyTalking(f: number) {
  const s = clone(BASE_GRID);
  s[8] = [0,0,0,0,1,0,1,0,3,1,1,0,3,1,0,1,0,0,0,0];
  s[9] = [0,0,0,0,1,0,1,0,0,1,1,0,0,1,0,1,0,0,0,0];
  const phase = Math.floor(f / 10) % 4;
  if (phase === 1) {
    s[12] = [0,0,0,0,0,1,1,1,2,2,2,2,1,1,1,0,0,0,0,0];
  } else if (phase === 2) {
    s[12] = [0,0,0,0,0,1,1,2,4,4,4,4,2,1,1,0,0,0,0,0];
    s[13] = [0,0,0,0,0,0,1,1,2,2,2,2,1,1,0,0,0,0,0,0];
    s[14] = [0,0,0,0,0,0,0,1,1,1,1,1,1,0,0,0,0,0,0,0];
  } else if (phase === 3) {
    s[12] = [0,0,0,0,0,1,1,2,2,2,2,2,2,1,1,0,0,0,0,0];
    s[13] = [0,0,0,0,0,0,1,1,2,2,2,2,1,1,0,0,0,0,0,0];
    s[14] = [0,0,0,0,0,0,0,1,1,1,1,1,1,0,0,0,0,0,0,0];
  }
  return s;
}

function makeAngry() {
  const s = clone(BASE_GRID);
  s[7]  = [0,0,0,0,1,0,1,1,0,0,0,0,1,1,0,1,0,0,0,0];
  s[8]  = [0,0,0,0,1,0,1,0,2,2,2,2,0,1,0,1,0,0,0,0];
  s[12] = [0,0,0,0,0,1,1,4,2,4,2,4,2,4,1,0,0,0,0,0];
  s[13] = [0,0,0,0,0,0,1,1,2,2,2,2,1,1,0,0,0,0,0,0];
  s[14] = [0,0,0,0,0,0,0,1,1,1,1,1,1,0,0,0,0,0,0,0];
  return s;
}

function makePokerFace() {
  const s = clone(BASE_GRID);
  s[12] = [0,0,0,0,0,1,1,2,2,2,2,2,2,1,1,0,0,0,0,0];
  return s;
}

function makeSideEye() {
  const s = clone(BASE_GRID);
  s[9] = [0,0,0,0,1,0,1,0,3,3,1,3,3,1,0,1,0,0,0,0];
  return s;
}

function emptyGrid(): number[][] {
  return Array.from({ length: GRID }, () => Array(GRID).fill(0));
}

function stampAt(s: number[][], color: number) {
  s[5][8] = color; s[5][9] = color; s[5][10] = color; s[5][11] = color;
  s[6][7] = color; s[6][12] = color;
  s[7][6] = color; s[7][9] = color; s[7][10] = color; s[7][13] = color;
  s[8][6] = color; s[8][11] = color; s[8][13] = color;
  s[9][6] = color; s[9][8] = color; s[9][9] = color; s[9][10] = color; s[9][11] = color; s[9][13] = color;
  s[10][6] = color; s[10][8] = color; s[10][11] = color; s[10][13] = color;
  s[11][6] = color; s[11][9] = color; s[11][10] = color; s[11][11] = color; s[11][12] = color;
  s[12][7] = color;
  s[13][8] = color; s[13][9] = color; s[13][10] = color; s[13][11] = color; s[13][12] = color; s[13][13] = color;
}

function makeAtIdle(f: number) {
  const s = emptyGrid();
  stampAt(s, 1);
  const visible = Math.floor(f / 30) % 2 === 0;
  if (visible) for (let r = 6; r <= 12; r++) s[r][16] = 1;
  return s;
}

function makeAtCelebrate(f: number) {
  const s = emptyGrid();
  stampAt(s, 1);
  const cx = 9.5;
  const cy = 9;
  const rot1 = f * 0.04;
  for (let i = 0; i < 8; i++) {
    const angle = rot1 + (i / 8) * Math.PI * 2;
    const phase = ((f * 0.018) + i * 0.04) % 1;
    const radius = 3 + phase * 7;
    const x = Math.round(cx + Math.cos(angle) * radius);
    const y = Math.round(cy + Math.sin(angle) * radius);
    if (x >= 0 && x < GRID && y >= 0 && y < GRID && !s[y][x]) {
      s[y][x] = [7, 8, 3, 1][i % 4];
    }
  }
  const rot2 = -f * 0.03;
  for (let i = 0; i < 6; i++) {
    const angle = rot2 + (i / 6) * Math.PI * 2;
    const phase = ((f * 0.014) + i * 0.12 + 0.4) % 1;
    const radius = 2.5 + phase * 6.5;
    const x = Math.round(cx + Math.cos(angle) * radius);
    const y = Math.round(cy + Math.sin(angle) * radius);
    if (x >= 0 && x < GRID && y >= 0 && y < GRID && !s[y][x]) {
      s[y][x] = [7, 1, 3][i % 3];
    }
  }
  return s;
}

function makeAtUnavailable(f: number) {
  const s = emptyGrid();
  const flash = Math.abs(Math.sin(f * 0.4)) > 0.7;
  stampAt(s, flash ? 8 : 9);
  const slash: [number, number][] = [
    [3, 15], [4, 14], [5, 13], [6, 12], [7, 11], [8, 10], [9, 9], [10, 8],
    [11, 7], [12, 6], [13, 5], [14, 4], [15, 3],
    [3, 16], [4, 15], [5, 14], [6, 13], [7, 12], [8, 11], [9, 10], [10, 9],
    [11, 8], [12, 7], [13, 6], [14, 5], [15, 4],
  ];
  for (const [y, x] of slash) {
    if (x >= 0 && x < GRID && y >= 0 && y < GRID) s[y][x] = 8;
  }
  return s;
}

function makeAtConfirmed(f: number) {
  const s = emptyGrid();
  const cycle = f % 180;
  let checkCount: number;
  if (cycle < 35) checkCount = Math.floor(cycle / 5);
  else if (cycle < 130) checkCount = 7;
  else if (cycle < 150) checkCount = 7 - Math.floor((cycle - 130) / 3);
  else checkCount = 0;
  stampAt(s, 1);
  const checkPath: [number, number][] = [
    [10, 12], [11, 13], [12, 14], [11, 15], [10, 16], [9, 17], [8, 18],
  ];
  const drawn = Math.min(Math.max(checkCount, 0), checkPath.length);
  for (let i = 0; i < drawn; i++) {
    const [y, x] = checkPath[i];
    if (x >= 0 && x < GRID && y >= 0 && y < GRID) s[y][x] = 10;
  }
  return s;
}
function makeOrbeeAt() {
  const s = clone(BASE_GRID);
  s[2][13] = 0; s[3][12] = 0;
  const A = 9;
  s[0][14] = A; s[0][15] = A; s[0][16] = A; s[0][17] = A;
  s[1][13] = A; s[1][18] = A;
  s[2][12] = A; s[2][15] = A; s[2][16] = A; s[2][19] = A;
  s[3][12] = A; s[3][17] = A; s[3][19] = A;
  s[4][12] = A; s[4][14] = A; s[4][15] = A; s[4][16] = A; s[4][17] = A; s[4][19] = A;
  s[5][12] = A; s[5][14] = A; s[5][17] = A; s[5][19] = A;
  s[6][12] = A; s[6][15] = A; s[6][16] = A; s[6][17] = A; s[6][18] = A;
  s[7][13] = A;
  s[8][14] = A; s[8][15] = A; s[8][16] = A; s[8][17] = A; s[8][18] = A; s[8][19] = A;
  return s;
}

export const BLINK_SPRITE = makeBlink();

export const ORBEE_EXPRESSIONS: Record<OrbeeExpressionName, OrbeeExpressionConfig> = {
  idle:             { getSprite: () => null,                             behavior: "idle" },
  happy:            { getSprite: () => makeHappy(),                      behavior: "idle", noBlink: true },
  happyTalking:     { getSprite: () => makeHappy(),                      behavior: "idle" },
  talking:          { getSprite: (f) => makeTalking(f),                  behavior: "idle" },
  friendlyTalking:  { getSprite: (f) => makeFriendlyTalking(f),          behavior: "idle" },
  angry:            { getSprite: () => makeAngry(),                      behavior: "idle" },
  pokerFace:        { getSprite: () => makePokerFace(),                  behavior: "idle", noBlink: true },
  sideEye:          { getSprite: () => makeSideEye(),                    behavior: "idle" },
  glasses:          { getSprite: () => makeGlasses(),                    behavior: "idle", noBlink: true },
  glassesHappy:     { getSprite: () => makeGlassesHappy(),               behavior: "idle", noBlink: true },
  surprised:        { getSprite: () => makeSurprised(),                  behavior: "idle" },
  orbeeAt:          { getSprite: () => makeOrbeeAt(),                    behavior: "idle" },
  nodding:          { getSprite: (f) => (Math.floor(f / 12) % 4 < 2 ? makeNodUp() : makeNodDown()),   behavior: "nod" },
  waving:           { getSprite: (f) => (Math.floor(f / 12) % 4 < 2 ? makeWaveUp() : makeWaveDown()), behavior: "wave" },
  looking: {
    getSprite: (f) => {
      const c = Math.floor(f / 35) % 6;
      if (c < 2) return makeLookLeft();
      if (c < 4) return makeLookRight();
      return null;
    },
    behavior: "look",
  },
  thinking:         { getSprite: () => makeThinking(),                   behavior: "idle" },
  error:            { getSprite: () => makeError(),                      behavior: "shake" },
  celebrate:        { getSprite: () => makeCelebrate(),                  behavior: "bounce" },
  sleeping:         { getSprite: () => makeSleep(),                      behavior: "sleep" },
  loading:          { getSprite: (f) => makeLoad(Math.floor(f / 6)),     behavior: "idle", noBlink: true },
  // noBlink: blink frame derives from BASE without the hat, causing flicker.
  pirateHat:        { getSprite: () => makePirateHat(),                  behavior: "idle", noBlink: true },
  pirateHappy:      { getSprite: () => makePirateHappy(),                behavior: "idle", noBlink: true },
  pirateHappyTalking: { getSprite: () => makePirateHappy(),              behavior: "idle" },
  pirateSurprised:  { getSprite: () => makePirateSurprised(),            behavior: "idle" },
  pirateLoading:    { getSprite: (f) => makePirateLoading(Math.floor(f / 6)), behavior: "idle", noBlink: true },
  pirateCool:       { getSprite: () => makePirateCool(),                 behavior: "idle", noBlink: true },
  pirateCoolHappy:  { getSprite: () => makePirateCoolHappy(),            behavior: "idle", noBlink: true },
  atIdle:           { getSprite: (f) => makeAtIdle(f),                   behavior: "idle", noBlink: true },
  atClaimed:        { getSprite: (f) => makeAtCelebrate(f),              behavior: "bounce", noBlink: true },
  atUnavailable:    { getSprite: (f) => makeAtUnavailable(f),            behavior: "shake", noBlink: true },
  atConfirmed:      { getSprite: (f) => makeAtConfirmed(f),              behavior: "idle", noBlink: true },
};

export const BOUNCE_SPARKLE_POSITIONS: [number, number][] = [
  [2, 4], [17, 3], [1, 10], [18, 9], [3, 16], [16, 16], [5, 1], [14, 1],
];
