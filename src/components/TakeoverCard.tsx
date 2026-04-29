import { JSX } from "solid-js";
import { IconX } from "./icons";

/**
 * Shared card chrome for "takeover" views - station preview, station
 * settings, profile editor, etc. Wraps content in the same panel
 * treatment used across the app (chrome-bg + hairline + soft shadow,
 * sitting on the wallpaper) and owns the top-right X close button.
 *
 * Each takeover view used to inline its own copy of this markup,
 * which meant every redesign had to be applied N times - and the X
 * close affordance was duplicated by App.tsx's `.takeover-close`
 * because the cards didn't own it. Centralizing here removes both
 * problems: one place to evolve card styling, one X per view.
 */
export default function TakeoverCard(props: {
  /** Called when the user clicks the X (or hits Esc - handled at App level). */
  onClose: () => void;
  /** Override the default 640px max-width if a view needs more or less. */
  maxWidth?: string;
  children: JSX.Element;
}) {
  return (
    <div class="station-preview">
      <div
        class="station-preview-card"
        style={props.maxWidth ? { "max-width": props.maxWidth } : undefined}
      >
        <button
          type="button"
          class="station-preview-close"
          onClick={props.onClose}
          aria-label="Close"
          title="Close (Esc)"
        >
          <IconX />
        </button>
        {props.children}
      </div>
    </div>
  );
}
