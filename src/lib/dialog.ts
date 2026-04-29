import { createSignal } from "solid-js";

// Lightweight replacement for window.confirm / window.prompt.
// Calls return a Promise that resolves when the user picks an action;
// <DialogHost> renders whatever sits in this signal.

interface BaseRequest {
  title: string;
  body?: string;
  confirmLabel?: string;
  cancelLabel?: string;
}

export interface ConfirmRequest extends BaseRequest {
  kind: "confirm";
  destructive?: boolean;
  resolve: (ok: boolean) => void;
}

export interface PromptRequest extends BaseRequest {
  kind: "prompt";
  placeholder?: string;
  initialValue?: string;
  resolve: (value: string | null) => void;
}

export interface InfoRequest extends BaseRequest {
  kind: "info";
  resolve: () => void;
}

export type DialogRequest = ConfirmRequest | PromptRequest | InfoRequest;

const [dialog, setDialog] = createSignal<DialogRequest | null>(null);
export { dialog, setDialog };

export function confirmDialog(
  opts: Omit<ConfirmRequest, "kind" | "resolve">,
): Promise<boolean> {
  return new Promise((resolve) => {
    setDialog({ kind: "confirm", ...opts, resolve });
  });
}

export function promptDialog(
  opts: Omit<PromptRequest, "kind" | "resolve">,
): Promise<string | null> {
  return new Promise((resolve) => {
    setDialog({ kind: "prompt", ...opts, resolve });
  });
}

export function infoDialog(
  opts: Omit<InfoRequest, "kind" | "resolve">,
): Promise<void> {
  return new Promise((resolve) => {
    setDialog({ kind: "info", ...opts, resolve });
  });
}
