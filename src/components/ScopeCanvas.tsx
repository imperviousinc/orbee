import { onMount, onCleanup, createEffect } from "solid-js";
import {
  renderScope,
  SCOPE_GRID,
  monoPalette,
  accentPalette,
  type ScopeSeed,
} from "../lib/stationScope";
import { theme } from "../lib/theme";

/** Pure scope renderer. Used by StationScope and the StationSettings picker. */
export default function ScopeCanvas(props: {
  seed: ScopeSeed;
  size?: number;
  animated?: boolean;
  accent?: boolean;
  /** Skip screen fill + grid + scanlines; draw only the trace on transparent. */
  bare?: boolean;
  /** Skip only the screen fill; keep grid+trace+scanlines. */
  transparentBg?: boolean;
}) {
  let canvasRef!: HTMLCanvasElement;
  let rafId: number | null = null;
  let frame = 0;

  const size = () => props.size ?? 40;
  const palette = () => (props.accent ? accentPalette() : monoPalette());
  const buf = SCOPE_GRID * 4;

  function drawOnce() {
    // Ref may not be set on first createEffect tick; onMount RAF retries.
    if (!canvasRef) return;
    const ctx = canvasRef.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, buf, buf);
    ctx.scale(4, 4);
    renderScope(ctx, props.seed, frame, palette(), {
      bare: props.bare,
      transparentBg: props.transparentBg,
    });
  }

  function startLoop() {
    if (rafId !== null) return;
    function tick() {
      frame++;
      drawOnce();
      rafId = requestAnimationFrame(tick);
    }
    rafId = requestAnimationFrame(tick);
  }

  function stopLoop() {
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
  }

  onMount(() => {
    // Defer one frame to win the For-with-many-children mount race.
    requestAnimationFrame(drawOnce);
  });

  createEffect(() => {
    theme();
    palette();
    props.seed;
    if (props.animated) startLoop();
    else { stopLoop(); drawOnce(); }
  });

  onCleanup(stopLoop);

  return (
    <canvas
      ref={canvasRef}
      class="station-scope"
      width={buf}
      height={buf}
      style={{
        width: `${size()}px`,
        height: `${size()}px`,
        "image-rendering": "pixelated",
        // No drop-shadow filter: it samples canvas pixels every frame and
        // forces a full-document repaint at 60fps (visible flicker behind
        // message content). Use a static box-shadow on a wrapper if a glow
        // is needed.
      }}
      aria-hidden="true"
    />
  );
}
