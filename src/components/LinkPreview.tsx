import { Show } from "solid-js";
import type { LinkCard } from "../lib/linkPreview";
import { IconX } from "./icons";

/** OG card. Used in the composer (with dismiss X) and inline under sent messages. */
export default function LinkPreview(props: {
  card: LinkCard;
  onDismiss?: () => void;
}) {
  const href = () => props.card.finalUrl || props.card.url;

  return (
    <div class="link-preview">
      <Show when={props.card.title}>
        <a
          class="link-preview-title"
          href={href()}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
        >
          {props.card.title}
        </a>
      </Show>
      <Show when={props.card.description}>
        <div class="link-preview-desc">{props.card.description}</div>
      </Show>
      <Show when={props.card.image}>
        <a
          class="link-preview-image"
          href={href()}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
        >
          <img src={props.card.image!} alt="" loading="lazy" />
        </a>
      </Show>
      <Show when={props.onDismiss}>
        <button
          class="link-preview-dismiss"
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); props.onDismiss!(); }}
          aria-label="Remove preview"
          title="Remove preview"
        >
          <IconX />
        </button>
      </Show>
    </div>
  );
}

/** Skeleton/loading state. */
export function LinkPreviewSkeleton(props: { onDismiss?: () => void }) {
  return (
    <div class="link-preview link-preview-loading">
      <div class="link-preview-title link-preview-shimmer">Loading preview…</div>
      <Show when={props.onDismiss}>
        <button
          class="link-preview-dismiss"
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); props.onDismiss!(); }}
          aria-label="Cancel preview"
          title="Cancel preview"
        >
          <IconX />
        </button>
      </Show>
    </div>
  );
}
