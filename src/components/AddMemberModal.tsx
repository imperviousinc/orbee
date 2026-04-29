import { createSignal, createEffect, Show, onMount } from "solid-js";
import { decodeNpub, truncateNpub } from "../lib/keys";
import type { Signer } from "../lib/signer";
import { addUser, stations, stationKey, type StationRef } from "../lib/stations";
import { profiles, displayName, requestProfiles } from "../lib/profiles";
import { IconX } from "./icons";

/**
 * Admin: invite a user to a station by npub.
 * Sends kind:9000 - for closed stations this is a direct add (no approval
 * dance); for open stations it's effectively redundant but harmless.
 *
 * Spaces-handle resolution (`name@space`) deferred until fabric is unblocked.
 */
export default function AddMemberModal(props: {
  signer: Signer;
  station: StationRef;
  onClose: () => void;
}) {
  const [input, setInput] = createSignal("");
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal("");
  let firstInputRef!: HTMLInputElement;

  const resolved = () => {
    const raw = input().trim();
    if (!raw) return null;
    if (raw.startsWith("npub1")) {
      const hex = decodeNpub(raw);
      return hex ? { hex, label: raw } : null;
    }
    return null;
  };

  const alreadyMember = () => {
    const r = resolved();
    if (!r) return false;
    const data = stations[stationKey(props.station)];
    return !!data?.members.includes(r.hex) || !!data?.admins.includes(r.hex);
  };

  // Pre-fetch the resolved pubkey's profile so the preview shows their handle.
  createEffect(() => {
    const r = resolved();
    if (!r) return;
    if (!profiles[r.hex]) requestProfiles([r.hex]);
  });

  onMount(() => {
    firstInputRef?.focus();
    document.addEventListener("keydown", onKey);
  });

  function onKey(e: KeyboardEvent) {
    if (e.key === "Escape") closeAndCleanup();
  }

  function closeAndCleanup() {
    document.removeEventListener("keydown", onKey);
    props.onClose();
  }

  async function handleSubmit(e?: Event) {
    e?.preventDefault();
    const r = resolved();
    if (!r) {
      setError("Enter a valid npub (npub1…)");
      return;
    }
    if (alreadyMember()) {
      setError("That user is already on the roster.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const result = await addUser(props.signer, props.station, r.hex);
      if (!result.ok) {
        setError(result.message
          ? `Relay rejected: ${result.message}`
          : "Couldn't add user.");
        return;
      }
      closeAndCleanup();
    } catch (e: any) {
      setError(e?.message || "Couldn't add user.");
    } finally {
      setBusy(false);
    }
  }

  function handleScrim(e: MouseEvent) {
    if (e.target === e.currentTarget) closeAndCleanup();
  }

  return (
    <div class="modal-scrim" onClick={handleScrim}>
      <form class="modal-card" onSubmit={handleSubmit}>
        <div class="modal-header">
          <div class="modal-title">Add member</div>
          <button type="button" class="modal-close" onClick={closeAndCleanup} aria-label="Close"><IconX /></button>
        </div>

        <div class="modal-body">
          <label class="modal-field">
            <span class="modal-label">npub</span>
            <input
              ref={firstInputRef}
              type="text"
              class="modal-input"
              placeholder="npub1…"
              value={input()}
              onInput={(e) => { setInput(e.currentTarget.value); setError(""); }}
              spellcheck={false}
              disabled={busy()}
            />
          </label>

          <Show when={resolved()}>
            <div class="add-member-resolved">
              <div class="add-member-resolved-label">Will add</div>
              <div class="add-member-resolved-handle">
                {profiles[resolved()!.hex] ? displayName(resolved()!.hex) : truncateNpub(resolved()!.hex)}
              </div>
              <Show when={alreadyMember()}>
                <div class="add-member-resolved-note">Already on the roster.</div>
              </Show>
            </div>
          </Show>

          <Show when={error()}>
            <div class="modal-error">{error()}</div>
          </Show>
        </div>

        <div class="modal-actions">
          <button type="button" class="modal-btn-ghost" onClick={closeAndCleanup} disabled={busy()}>
            Cancel
          </button>
          <button type="submit" class="modal-btn" disabled={busy() || !resolved() || alreadyMember()}>
            {busy() ? "Adding…" : "Add member"}
          </button>
        </div>
      </form>
    </div>
  );
}
