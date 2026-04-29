import { createSignal, createEffect, onCleanup, Show } from "solid-js";
import type { Signer } from "../lib/signer";
import { requestJoin, subscribeStationsMetadata, type StationRef } from "../lib/stations";

/**
 * Composer replacement for closed (NIP-29) stations the user is in their
 * joined-list for but isn't a member of. Sends kind:9021 and shows pending
 * state; App.tsx swaps in MessageInput once kind:39002 includes our pubkey.
 */
export default function RequestAccessBanner(props: {
  signer: Signer;
  station: StationRef;
}) {
  const [busy, setBusy] = createSignal(false);
  const [sent, setSent] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  // 0xchat (and others) only push kind:39002 to existing members, so re-sub
  // every 8s to pull the latest replaceable members list after admin approval.
  createEffect(() => {
    const station = props.station;
    if (!station) return;
    subscribeStationsMetadata(station.relay);
    const t = window.setInterval(() => subscribeStationsMetadata(station.relay), 8000);
    onCleanup(() => window.clearInterval(t));
  });

  async function handleRequest() {
    setBusy(true);
    setError(null);
    try {
      const result = await requestJoin(props.signer, props.station);
      if (!result.ok) {
        setError(result.message
          ? `Relay rejected: ${result.message}`
          : "Couldn't send request. Try again?");
        return;
      }
      setSent(true);
    } catch (e: any) {
      setError(e?.message || "Couldn't send request.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div class="access-gate">
      <div class="access-gate-body">
        <div class="access-gate-title">
          {sent() ? "Request sent - waiting for admin approval" : "Admin approval required"}
        </div>
        <Show when={error()}>
          <div class="access-gate-error">{error()}</div>
        </Show>
      </div>
      <Show when={!sent()}>
        <button
          class="access-gate-btn"
          onClick={handleRequest}
          disabled={busy()}
        >
          {busy() ? "Sending…" : "Request access"}
        </button>
      </Show>
    </div>
  );
}
