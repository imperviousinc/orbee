import { Show, createSignal, createEffect, onCleanup } from "solid-js";
import { dialog, setDialog, type DialogRequest } from "../lib/dialog";

/**
 * Singleton dialog host - render once at the app root. Watches the global
 * `dialog` signal and renders the active confirm/prompt request. Replaces
 * the native window.confirm / window.prompt to keep the look consistent
 * with the rest of the app.
 */
export default function DialogHost() {
  return (
    <Show when={dialog()}>
      {(req) => <ActiveDialog req={req()} />}
    </Show>
  );
}

function ActiveDialog(props: { req: DialogRequest }) {
  const [value, setValue] = createSignal(
    props.req.kind === "prompt" ? (props.req.initialValue || "") : "",
  );
  let inputRef: HTMLInputElement | undefined;

  // Keyboard: Esc cancels, Enter confirms (unless focus is on a textarea
  // - we don't have one here, but be defensive).
  function onKey(e: KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      cancel();
    } else if (e.key === "Enter" && (e.target as HTMLElement).tagName !== "TEXTAREA") {
      e.preventDefault();
      confirmIt();
    }
  }

  createEffect(() => {
    document.addEventListener("keydown", onKey);
    onCleanup(() => document.removeEventListener("keydown", onKey));
    // Focus the input on mount for prompt; the confirm button for confirm.
    if (props.req.kind === "prompt") {
      setTimeout(() => inputRef?.focus(), 0);
    }
  });

  function confirmIt() {
    const r = props.req;
    if (r.kind === "confirm") r.resolve(true);
    else if (r.kind === "prompt") r.resolve(value().trim() || null);
    else r.resolve();
    setDialog(null);
  }

  function cancel() {
    const r = props.req;
    if (r.kind === "confirm") r.resolve(false);
    else if (r.kind === "prompt") r.resolve(null);
    else r.resolve();
    setDialog(null);
  }

  function onScrim(e: MouseEvent) {
    if (e.target === e.currentTarget) cancel();
  }

  const confirmLabel = () =>
    props.req.confirmLabel ||
    (props.req.kind === "confirm" ? "Confirm" : "OK");
  const cancelLabel = () => props.req.cancelLabel || "Cancel";
  const isDestructive = () =>
    props.req.kind === "confirm" && !!props.req.destructive;
  // Info dialogs are one-button - just acknowledge.
  const showCancel = () => props.req.kind !== "info";

  return (
    <div class="dialog-scrim" onClick={onScrim}>
      <div class="dialog-card">
        <div class="dialog-title">{props.req.title}</div>
        <Show when={props.req.body}>
          <div class="dialog-body">{props.req.body}</div>
        </Show>
        <Show when={props.req.kind === "prompt"}>
          <input
            ref={inputRef}
            type="text"
            class="dialog-input"
            value={value()}
            onInput={(e) => setValue(e.currentTarget.value)}
            placeholder={(props.req as any).placeholder || ""}
          />
        </Show>
        <div class="dialog-actions">
          <Show when={showCancel()}>
            <button type="button" class="dialog-btn-ghost" onClick={cancel}>
              {cancelLabel()}
            </button>
          </Show>
          <button
            type="button"
            class={`dialog-btn ${isDestructive() ? "destructive" : ""}`}
            onClick={confirmIt}
          >
            {confirmLabel()}
          </button>
        </div>
      </div>
    </div>
  );
}
