import { createSignal } from "solid-js";

/**
 * Resizable left sidebar. One persisted signal - the width in px -
 * drives both:
 *   • The layout width (used as `--sidebar-width` on the grid when
 *     the sidebar is above the collapse threshold)
 *   • The expanded vs icon-only display (derived via
 *     isSidebarExpanded)
 *
 * Dragging the sidebar narrower than the collapse threshold "snaps"
 * the layout to icon-only even though the stored width can remain
 * wider - the render just ignores it when collapsed.
 */
const STORAGE_KEY = "orbee-sidebar-width";

/** Width at which the sidebar flips from icon-only → named list. */
export const COLLAPSE_THRESHOLD = 140;
/** Hard minimum of the drag range (stored value can't go below this). */
export const MIN_WIDTH = 64;
/** Minimum width we render when expanded - so the named rows have
 *  enough room to breathe. Drags between COLLAPSE_THRESHOLD and here
 *  snap up to here. */
export const MIN_EXPANDED_WIDTH = 180;
/** Hard upper bound of the sidebar width. */
export const MAX_WIDTH = 420;
/** First-run default - wider than the old 220px so the named layout
 *  reads as the intended resting state. */
export const DEFAULT_WIDTH = 260;

const initial = (() => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const n = parseInt(raw, 10);
      if (!Number.isNaN(n)) {
        return Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, n));
      }
    }
  } catch {
    /* ignored */
  }
  return DEFAULT_WIDTH;
})();

const [sidebarWidth, setSidebarWidthRaw] = createSignal(initial);
export { sidebarWidth };

export function setSidebarWidth(px: number) {
  let next: number;
  if (px < COLLAPSE_THRESHOLD) {
    // Inside the collapse band - snap DOWN to the absolute minimum
    // so the layout clearly switches to icon-only. Storing below
    // COLLAPSE_THRESHOLD is intentional - re-expanding from the
    // drag handle re-inflates to MIN_EXPANDED_WIDTH.
    next = MIN_WIDTH;
  } else {
    next = Math.max(MIN_EXPANDED_WIDTH, Math.min(MAX_WIDTH, px));
  }
  setSidebarWidthRaw(next);
  try {
    localStorage.setItem(STORAGE_KEY, String(next));
  } catch {
    /* ignored */
  }
}

export function isSidebarExpanded(): boolean {
  return sidebarWidth() >= COLLAPSE_THRESHOLD;
}
