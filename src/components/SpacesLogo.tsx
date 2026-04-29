import { onMount, onCleanup } from "solid-js";
import { getCreatureData } from "../lib/creatures";
import {
  BASE_GRID,
  BLINK_SPRITE,
  BOUNCE_SPARKLE_POSITIONS,
  GRID,
  ORBEE_EXPRESSIONS,
  ORBEE_PALETTE,
  type OrbeeExpressionName,
} from "../lib/orbeeExpressions";

const CREATURE_PX = 4;
const CREATURE_ROWS = 16;
const EXPR_PX = 5; // pixel size on the internal canvas
const EXPR_SCALE = 2; // hi-dpi scale factor for crispness

interface Props {
  size?: number;
  pubkey?: string;
  expression?: OrbeeExpressionName;
}

export default function SpacesLogo(props: Props) {
  const displaySize = props.size ?? 77;
  let canvasRef!: HTMLCanvasElement;
  let rafId: number;

  onMount(() => {
    if (props.pubkey) {
      rafId = renderCreature(canvasRef, props.pubkey);
    } else {
      rafId = renderExpression(canvasRef, () => props.expression ?? "idle");
    }
  });
  onCleanup(() => cancelAnimationFrame(rafId));

  // Height ratio differs by path: creature uses 16 rows, expression uses 20.
  const heightRatio = props.pubkey ? CREATURE_ROWS / GRID : 1;
  const canvasWidth = props.pubkey ? GRID * CREATURE_PX : GRID * EXPR_PX * EXPR_SCALE;
  const canvasHeight = props.pubkey
    ? CREATURE_ROWS * CREATURE_PX
    : GRID * EXPR_PX * EXPR_SCALE;

  return (
    <canvas
      ref={canvasRef}
      width={canvasWidth}
      height={canvasHeight}
      style={{
        width: `${displaySize}px`,
        height: `${displaySize * heightRatio}px`,
        "image-rendering": "pixelated",
        "flex-shrink": "0",
      }}
    />
  );
}

// Per-frame sprite + behavior (float/nod/wave/bounce/shake/sleep) +
// blink + CRT glitch + bounce sparkles / sleep Z's.
function renderExpression(
  canvas: HTMLCanvasElement,
  getExpressionName: () => OrbeeExpressionName,
): number {
  const ctx = canvas.getContext("2d")!;
  ctx.scale(EXPR_SCALE, EXPR_SCALE);
  const W = GRID * EXPR_PX;

  let frame = Math.floor(Math.random() * 300);
  let blinkT = Math.floor(Math.random() * 120);
  let isBlink = false;
  let blinkD = 0;
  let glitchT = Math.floor(Math.random() * 400);
  let isGlitch = false;
  let gOff = 0;

  function draw() {
    frame++;
    const expr = ORBEE_EXPRESSIONS[getExpressionName()] ?? ORBEE_EXPRESSIONS.idle;
    let sprite = expr.getSprite(frame) ?? BASE_GRID;
    const b = expr.behavior;

    const fy =
      b === "sleep"
        ? Math.sin(frame * 0.018) * 1.5
        : b === "bounce"
        ? Math.abs(Math.sin(frame * 0.08)) * -5
        : Math.sin(frame * 0.032) * 2.5;
    const sx = b === "shake" ? Math.sin(frame * 0.4) * 3 : 0;
    const pulse = frame * 0.025;

    ctx.clearRect(0, 0, W, W);

    // Skip blink for expressions that declare noBlink.
    if (!expr.noBlink) {
      blinkT++;
      if (!isBlink && blinkT > 100 + Math.random() * 130) {
        isBlink = true;
        blinkD = 0;
        blinkT = 0;
      }
      if (isBlink) {
        blinkD++;
        if (blinkD > 7) isBlink = false;
      }
      if (isBlink) sprite = BLINK_SPRITE;
    }

    // Sub-pixel horizontal shear on every 3rd row.
    glitchT++;
    if (!isGlitch && glitchT > 350 + Math.random() * 250) {
      isGlitch = true;
      glitchT = 0;
      window.setTimeout(() => {
        isGlitch = false;
        gOff = 0;
      }, 90);
    }
    if (isGlitch) gOff = (Math.random() - 0.5) * 8;

    ctx.globalAlpha = 0.07;
    for (let y = 0; y < GRID; y++) {
      for (let x = 0; x < GRID; x++) {
        const v = sprite[y]?.[x];
        if (!v) continue;
        const c = ORBEE_PALETTE[v];
        if (!c) continue;
        ctx.fillStyle = c;
        ctx.fillRect(x * EXPR_PX - 1.5 + sx, y * EXPR_PX + fy - 1.5, EXPR_PX + 3, EXPR_PX + 3);
      }
    }

    for (let y = 0; y < GRID; y++) {
      for (let x = 0; x < GRID; x++) {
        const v = sprite[y]?.[x];
        if (!v) continue;
        const c = ORBEE_PALETTE[v];
        if (!c) continue;
        let gx = x * EXPR_PX + sx;
        if (isGlitch && y % 3 === 0) gx += gOff;
        const gy = y * EXPR_PX + fy;
        ctx.globalAlpha = 0.82 + Math.sin(pulse + x * 0.25 + y * 0.2) * 0.18;
        ctx.fillStyle = c;
        ctx.fillRect(gx, gy, EXPR_PX, EXPR_PX);
        if (v === 3 || v === 4 || v === 7 || v === 8 || v === 9) {
          ctx.globalAlpha = 0.13;
          ctx.fillStyle = "#ff3c8e";
          ctx.fillRect(gx - 1.5, gy, 1.5, EXPR_PX);
          ctx.fillStyle = "#4444ff";
          ctx.fillRect(gx + EXPR_PX, gy, 1.5, EXPR_PX);
        }
      }
    }

    if (b === "sleep") {
      ctx.globalAlpha = 0.3 + Math.sin(frame * 0.04) * 0.15;
      ctx.fillStyle = "#8b1a8b";
      const zo = (frame * 0.5) % 40;
      ctx.font = `${EXPR_PX * 2}px "JetBrains Mono", monospace`;
      ctx.fillText("z", 15 * EXPR_PX, 5 * EXPR_PX - zo * 0.3 + fy);
      ctx.font = `${EXPR_PX * 1.5}px "JetBrains Mono", monospace`;
      ctx.fillText("z", 16 * EXPR_PX, 4 * EXPR_PX - zo * 0.2 + fy);
      ctx.font = `${EXPR_PX}px "JetBrains Mono", monospace`;
      ctx.fillText("z", 17 * EXPR_PX, 3 * EXPR_PX - zo * 0.1 + fy);
    }

    if (b === "bounce") {
      BOUNCE_SPARKLE_POSITIONS.forEach(([tx, ty], i) => {
        const tw = Math.sin(frame * 0.12 + i * 1.5);
        if (tw > 0.2) {
          ctx.globalAlpha = tw * 0.6;
          ctx.fillStyle = i % 3 === 0 ? "#ffb800" : i % 3 === 1 ? "#ff3c8e" : "#00e5ff";
          ctx.fillRect(
            tx * EXPR_PX + Math.sin(frame * 0.03 + i) * 2,
            ty * EXPR_PX + fy,
            EXPR_PX * 0.6,
            EXPR_PX * 0.6,
          );
        }
      });
    }

    ctx.globalAlpha = 1;
    rafId = requestAnimationFrame(draw);
  }

  let rafId = requestAnimationFrame(draw);
  return rafId;
}

// Per-pubkey creatures have their own grid shape; no expression system.
function renderCreature(canvas: HTMLCanvasElement, pubkey: string): number {
  const creature = getCreatureData(pubkey);
  const grid = creature?.grid ?? DEFAULT_CREATURE_GRID;
  const colors = creature?.colors ?? DEFAULT_CREATURE_COLORS;

  let frame = 0;
  let blinkTimer = Math.floor(Math.random() * 150);
  let isBlinking = false;
  let blinkDur = 0;
  let glitchTimer = Math.floor(Math.random() * 400);
  let isGlitching = false;
  let glitchOffset = 0;

  function tick() {
    frame++;
    blinkTimer++;
    if (!isBlinking && blinkTimer > 100 + Math.random() * 120) {
      isBlinking = true;
      blinkDur = 0;
      blinkTimer = 0;
    }
    if (isBlinking) {
      blinkDur++;
      if (blinkDur > 7) isBlinking = false;
    }

    glitchTimer++;
    if (!isGlitching && glitchTimer > 300 + Math.random() * 250) {
      isGlitching = true;
      glitchTimer = 0;
      window.setTimeout(() => {
        isGlitching = false;
        glitchOffset = 0;
      }, 100);
    }
    if (isGlitching) glitchOffset = (Math.random() - 0.5) * 4;

    const ctx = canvas.getContext("2d")!;
    const fy = Math.sin(frame * 0.035) * 1.2;
    const p = frame * 0.03;

    ctx.clearRect(0, 0, GRID * CREATURE_PX, CREATURE_ROWS * CREATURE_PX);

    ctx.globalAlpha = 0.18;
    for (let y = 0; y < CREATURE_ROWS; y++) {
      for (let x = 0; x < GRID; x++) {
        const v = grid[y]?.[x];
        if (!v || !colors[v]) continue;
        ctx.fillStyle = colors[v];
        const gx = x * CREATURE_PX + (isGlitching && y % 3 === 0 ? glitchOffset : 0);
        ctx.fillRect(gx - 2, y * CREATURE_PX + fy - 2, CREATURE_PX + 4, CREATURE_PX + 4);
      }
    }

    ctx.globalAlpha = 1;
    for (let y = 0; y < CREATURE_ROWS; y++) {
      for (let x = 0; x < GRID; x++) {
        const v = grid[y]?.[x];
        if (!v || !colors[v]) continue;
        if (isBlinking && (v === 4 || v === 5)) continue;
        let gx = x * CREATURE_PX;
        if (isGlitching && y % 3 === 0) gx += glitchOffset;
        const gy = y * CREATURE_PX + fy;
        ctx.globalAlpha = 0.92 + Math.sin(p + x * 0.25 + y * 0.2) * 0.08;
        ctx.fillStyle = colors[v];
        ctx.fillRect(gx, gy, CREATURE_PX, CREATURE_PX);
        if (v === 4 || v === 5) {
          ctx.globalAlpha = 0.14;
          ctx.fillStyle = "#ff3c8e";
          ctx.fillRect(gx - 1.5, gy, 1.5, CREATURE_PX);
          ctx.fillStyle = "#4444ff";
          ctx.fillRect(gx + CREATURE_PX, gy, 1.5, CREATURE_PX);
        }
      }
    }
    ctx.globalAlpha = 1;
    rafId = requestAnimationFrame(tick);
  }

  let rafId = requestAnimationFrame(tick);
  return rafId;
}

const DEFAULT_CREATURE_COLORS: Record<number, string> = {
  1: "#d946ef", 2: "#3a0a3a", 3: "#ffffff", 5: "#8b1a8b", 6: "#007a8a",
};

const DEFAULT_CREATURE_GRID = [
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
];
