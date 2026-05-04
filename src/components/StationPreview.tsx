import { createSignal, createEffect, on, onCleanup, Show } from "solid-js";
import type { Signer } from "../lib/signer";
import {
  rememberStation,
  requestJoin,
  mintStation,
  subscribeStationsMetadata,
  fetchStationMetadataOnce,
  stations,
  stationKey,
  type StationRef,
} from "../lib/stations";
import { getRelay, isRelayConnected } from "../lib/nostr";
import { subscribeStationActivity } from "../lib/stationActivity";
import TakeoverCard from "./TakeoverCard";

export type PreviewMode = "tune" | "mint";

// NIP-29 group id: 10 chars from [a-z0-9], ~50 bits. Uses
// crypto.getRandomValues since the id is a security-relevant handle
// (anyone with it can attempt to join an open station).
function generateGroupId(): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = new Uint8Array(10);
  crypto.getRandomValues(bytes);
  let out = "";
  for (let i = 0; i < bytes.length; i++) out += alphabet[bytes[i] % alphabet.length];
  return out;
}

/** Pre-action preview card for tuning into / minting a NIP-29 station. */
export default function StationPreview(props: {
  signer: Signer;
  /** Empty `id` = new flow (frequency input is editable). */
  initial: StationRef;
  /** null = let the user pick mode in the card. */
  mode: PreviewMode | null;
  /** NIP-29 invite code; attached as a `code` tag on kind:9021. */
  inviteCode?: string | null;
  onJoined: (ref: StationRef) => void;
  onCancel: () => void;
}) {
  const [freqInput, setFreqInput] = createSignal(
    props.initial.id || (props.mode === "mint" ? generateGroupId() : ""),
  );
  const [displayName, setDisplayName] = createSignal("");
  const [relay, setRelay] = createSignal(props.initial.relay);
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal("");
  // What we're doing right now while busy: "Connecting to relay…",
  // "Creating station…", "Tuning in…", etc. Shows as a visible progress
  // line above the buttons, not just a button label change.
  const [stage, setStage] = createSignal("");
  const [pickedMode, setPickedMode] = createSignal<PreviewMode>(props.mode || "tune");
  const [openAccess, setOpenAccess] = createSignal(true);
  // Set after kind:9021 against a closed station - waiting for admin 9000.
  const [pending, setPending] = createSignal(false);

  const idEditable = () => props.initial.id === "";
  const showModeToggle = () => props.mode === null;
  const effectiveMode = (): PreviewMode => props.mode || pickedMode();
  const isMint = () => effectiveMode() === "mint";

  const effectiveId = () => (idEditable() ? freqInput().trim() : props.initial.id);

  // NIP-29 group id grammar: [a-z0-9_-]+, lowercase only.
  function normalizeId(raw: string): string | null {
    const id = (raw.includes("/") ? raw.split("/").pop()! : raw).toLowerCase();
    return /^[a-z0-9_-]+$/.test(id) ? id : null;
  }

  // Reset on prop change only (Solid reuses the component instance).
  // `on(...)` avoids re-running on mode/input changes that would clobber typing.
  createEffect(on(() => [props.initial.id, props.initial.relay], () => {
    const seed = props.initial.id || (effectiveMode() === "mint" ? generateGroupId() : "");
    setFreqInput(seed);
    setDisplayName("");
    setRelay(props.initial.relay);
    setBusy(false);
    setError("");
    setPending(false);
  }));

  // defer:true: createSignal init already picked the correct seed.
  createEffect(on(() => pickedMode(), (m) => {
    if (!idEditable()) return;
    if (m === "mint") setFreqInput(generateGroupId());
    else setFreqInput("");
  }, { defer: true }));

  const stationData = () => {
    if (idEditable()) return undefined;
    const r = relay().trim();
    if (!r) return undefined;
    return stations[stationKey({ id: props.initial.id, relay: r })];
  };
  const stationName = () => stationData()?.name;
  const stationAbout = () => stationData()?.about;
  const isClosedStation = () => stationData()?.open === false;

  createEffect(() => {
    if (props.mode !== "tune") return;
    if (idEditable()) return;
    const r = relay().trim();
    if (!r.startsWith("ws://") && !r.startsWith("wss://")) return;
    const ref: StationRef = { id: props.initial.id, relay: r };
    getRelay(r).connect();
    const subId = fetchStationMetadataOnce(ref);
    onCleanup(() => getRelay(r).unsubscribe(subId));
  });

  // Wait up to `timeoutMs` for the relay to be in the `connectedUrls` set.
  // NostrRelay.connect() resolves either on a real ack or after a 5s safety
  // timeout, so we don't block on the connect Promise itself - we poll the
  // reactive flag and bail with a clear error if it's still false at the
  // end. This catches the "WS dial failed / unreachable host" case before
  // we publish into a void.
  async function ensureConnected(url: string, timeoutMs: number): Promise<boolean> {
    if (isRelayConnected(url)) return true;
    getRelay(url).connect();
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (isRelayConnected(url)) return true;
      await new Promise((res) => setTimeout(res, 100));
    }
    return isRelayConnected(url);
  }

  // Race a promise against a hard timeout - publish() can hang forever
  // when the relay accepts the WS handshake but never sends an OK back.
  function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
    return Promise.race([
      p,
      new Promise<T>((_, reject) =>
        setTimeout(() => reject(new Error(`${label} (relay didn't respond within ${Math.round(ms / 1000)}s)`)), ms),
      ),
    ]);
  }

  async function handleSubmit() {
    const r = relay().trim();
    if (!r.startsWith("ws://") && !r.startsWith("wss://")) {
      setError("Relay needs to be a WebSocket URL (wss://…)");
      return;
    }
    const id = idEditable() ? normalizeId(freqInput().trim()) : props.initial.id;
    if (!id) {
      setError("Frequency: letters, digits, _ or - only.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const ref: StationRef = { id, relay: r };

      // Connectivity precheck. Don't publish a kind:9007 (or 9021) into a
      // socket that isn't actually open - the publish would hang or, worse,
      // resolve "ok" against a half-open connection while the server never
      // saw the event. Fail fast with a clear message.
      setStage(isMint() ? "Connecting to relay…" : "Connecting to relay…");
      const connected = await ensureConnected(r, 8000);
      if (!connected) {
        setError(`Can't reach ${r.replace(/^wss?:\/\//, "")}. Check the URL or try a different relay.`);
        return;
      }

      if (isMint()) {
        const name = displayName().trim() || undefined;
        setStage("Creating station…");
        const { createResult, metaResult } = await withTimeout(
          mintStation(props.signer, ref, { open: openAccess(), name }),
          15_000,
          "Couldn't create station",
        );
        if (!createResult.ok) {
          setError(createResult.message
            ? `Relay rejected: ${createResult.message}`
            : "Couldn't mint station. Try a different relay?");
          return;
        }
        if (!metaResult.ok) {
          console.warn("metadata write failed:", metaResult.message);
        }
        rememberStation(ref);
        subscribeStationsMetadata(ref.relay);
        subscribeStationActivity(ref.relay);
        props.onJoined(ref);
        return;
      }

      // tune mode
      setStage("Tuning in…");
      const result = await withTimeout(
        requestJoin(props.signer, ref, { code: props.inviteCode || undefined }),
        15_000,
        "Couldn't tune in",
      );
      if (!result.ok) {
        setError(result.message
          ? `Relay rejected: ${result.message}`
          : "Couldn't tune in. Try again?");
        return;
      }
      // Closed station: relay accepted the 9021 but membership requires
      // an admin's kind:9000. Don't activate/remember yet.
      if (isClosedStation()) {
        setPending(true);
        return;
      }
      rememberStation(ref);
      subscribeStationsMetadata(ref.relay);
      props.onJoined(ref);
    } catch (e: any) {
      setError(e?.message || (isMint() ? "Couldn't mint station." : "Couldn't tune in."));
    } finally {
      setBusy(false);
      setStage("");
    }
  }

  const headerLabel = () => {
    if (idEditable()) return isMint() ? "New broadcast" : "Tune to a frequency";
    return isMint() ? "New broadcast" : "Tuning in to";
  };
  const hint = () => {
    if (isMint()) {
      return "This is where your broadcast will live. Pick the relay to host it - anyone joining will need to connect there.";
    }
    return "Stations live on relays. Each Orbee station is hosted by whoever's relay you pick";
  };
  const submitIdleLabel = () => {
    if (isMint()) return "Start broadcasting";
    return isClosedStation() ? "Request access" : "Join station";
  };
  const submitBusyLabel = () => {
    if (isMint()) return "Starting…";
    return isClosedStation() ? "Sending request…" : "Tuning in…";
  };

  return (
    <Show
      when={!pending()}
      fallback={
        <TakeoverCard onClose={props.onCancel}>
          <div class="station-preview-label">Request sent</div>
          <div class="station-preview-frequency">
            <span class="station-preview-hash">#</span>{props.initial.id}
          </div>
          <p class="station-preview-hint">
            An admin needs to approve you before you can broadcast. Check back
            later - once approved, this station will appear in your channels.
          </p>
          <div class="station-preview-actions">
            <button
              type="button"
              class="station-preview-join"
              onClick={props.onCancel}
              style={{ flex: 1 }}
            >
              Close
            </button>
          </div>
        </TakeoverCard>
      }
    >
      <TakeoverCard onClose={props.onCancel}>
          <div class="station-preview-label">{headerLabel()}</div>

          <Show when={idEditable()} fallback={
            <div class="station-preview-frequency">
              <span class="station-preview-hash">#</span>{props.initial.id}
            </div>
          }>
            <Show when={isMint()} fallback={
              <div class="station-preview-row">
                <label class="station-preview-relay-label">FREQUENCY</label>
                <input
                  type="text"
                  class="station-preview-relay station-preview-freq-input"
                  value={freqInput()}
                  onInput={(e) => { setFreqInput(e.currentTarget.value); setError(""); }}
                  spellcheck={false}
                  autocomplete="off"
                  autocapitalize="none"
                  disabled={busy()}
                  placeholder="frequency to tune to"
                  autofocus
                />
              </div>
            }>
              <div class="station-preview-row">
                <label class="station-preview-relay-label">NAME</label>
                <input
                  type="text"
                  class="station-preview-relay station-preview-freq-input"
                  value={displayName()}
                  onInput={(e) => { setDisplayName(e.currentTarget.value); setError(""); }}
                  spellcheck={false}
                  autocomplete="off"
                  disabled={busy()}
                  placeholder="name your station"
                  maxLength={64}
                  autofocus
                />
              </div>
              <div class="station-preview-row">
                <label class="station-preview-relay-label">ID</label>
                <div class="station-preview-id-row">
                  <input
                    type="text"
                    class="station-preview-id"
                    value={freqInput()}
                    onInput={(e) => {
                      setFreqInput(e.currentTarget.value.toLowerCase());
                      setError("");
                    }}
                    spellcheck={false}
                    autocomplete="off"
                    autocapitalize="none"
                    disabled={busy()}
                    aria-label="Station id"
                  />
                  <button
                    type="button"
                    class="station-preview-id-regen"
                    onClick={() => { setFreqInput(generateGroupId()); setError(""); }}
                    disabled={busy()}
                    title="Regenerate"
                  >
                    ↻
                  </button>
                </div>
              </div>
            </Show>
          </Show>

          <Show when={showModeToggle()}>
            <div class="station-preview-row">
              <label class="station-preview-relay-label">MODE</label>
              <div class="station-preview-access">
                <button
                  type="button"
                  class={`station-preview-access-opt ${pickedMode() === "tune" ? "active" : ""}`}
                  onClick={() => { setPickedMode("tune"); setError(""); }}
                  disabled={busy()}
                >
                  <span class="station-preview-access-name">Tune in</span>
                  <span class="station-preview-access-desc">Join an existing station</span>
                </button>
                <button
                  type="button"
                  class={`station-preview-access-opt ${pickedMode() === "mint" ? "active" : ""}`}
                  onClick={() => { setPickedMode("mint"); setError(""); }}
                  disabled={busy()}
                >
                  <span class="station-preview-access-name">Create</span>
                  <span class="station-preview-access-desc">Open a new station</span>
                </button>
              </div>
            </div>
          </Show>

          <Show when={!isMint() && stationName()}>
            <div class="station-preview-name">{stationName()}</div>
          </Show>
          <Show when={!isMint() && stationAbout()}>
            <div class="station-preview-about">{stationAbout()}</div>
          </Show>
          <Show when={!isMint() && stationData()?.open !== undefined}>
            <div class={`station-preview-access-badge ${isClosedStation() ? "closed" : "open"}`}>
              {isClosedStation() ? "Closed · admin must approve joins" : "Open · anyone can join"}
            </div>
          </Show>

          <div class="station-preview-row">
            <label class="station-preview-relay-label">RELAY</label>
            <input
              type="text"
              class="station-preview-relay"
              value={relay()}
              onInput={(e) => { setRelay(e.currentTarget.value); setError(""); }}
              spellcheck={false}
              disabled={busy()}
              placeholder="wss://…"
            />
            <p class="station-preview-hint">{hint()}</p>
          </div>

          <Show when={isMint()}>
            <div class="station-preview-row">
              <label class="station-preview-relay-label">ACCESS</label>
              <div class="station-preview-access">
                <button
                  type="button"
                  class={`station-preview-access-opt ${openAccess() ? "active" : ""}`}
                  onClick={() => setOpenAccess(true)}
                  disabled={busy()}
                >
                  <span class="station-preview-access-name">Open</span>
                  <span class="station-preview-access-desc">Anyone can join</span>
                </button>
                <button
                  type="button"
                  class={`station-preview-access-opt ${!openAccess() ? "active" : ""}`}
                  onClick={() => setOpenAccess(false)}
                  disabled={busy()}
                >
                  <span class="station-preview-access-name">Request access</span>
                  <span class="station-preview-access-desc">You approve each join</span>
                </button>
              </div>
            </div>
          </Show>

          <Show when={error()}>
            <div class="station-preview-error">{error()}</div>
          </Show>
          <Show when={busy() && stage() && !error()}>
            <div class="station-preview-progress">
              <span class="station-preview-progress-dot" />
              <span class="station-preview-progress-text">{stage()}</span>
            </div>
          </Show>

          <div class="station-preview-actions">
            <button
              type="button"
              class="station-preview-cancel"
              onClick={props.onCancel}
              disabled={busy()}
            >
              Cancel
            </button>
            <button
              type="button"
              class="station-preview-join"
              onClick={handleSubmit}
              disabled={busy() || !relay().trim() || !effectiveId()}
            >
              {busy() ? submitBusyLabel() : submitIdleLabel()}
            </button>
          </div>
      </TakeoverCard>
    </Show>
  );
}
