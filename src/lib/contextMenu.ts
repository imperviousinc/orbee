import { createSignal } from "solid-js";
import type { NostrEvent } from "./keys";

/**
 * Global state for the message context menu. Only one can be open at a
 * time. MessageRow sets this on right-click / long-press; the
 * <MessageContextMenu/> renders it at the supplied coords.
 */
export interface MessageContextRequest {
  event: NostrEvent;
  x: number;
  y: number;
  /** Snapshotted at open time so the menu can offer "Copy selected text"
      even after the click that opens the menu may have changed selection. */
  selectedText?: string;
}

export const [messageContext, setMessageContext] = createSignal<MessageContextRequest | null>(null);

export function closeMessageContext() {
  setMessageContext(null);
}
