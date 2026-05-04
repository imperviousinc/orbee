import { For, Show, createSignal } from "solid-js";
import {
  joinedStations,
  setActiveStation,
  discoverJoinedStations,
  type StationRef,
  type ImportRelayResult,
} from "../lib/stations";
import { getStationScopeSeed } from "../lib/stationScope";
import { getSigner } from "../lib/auth";
import ScopeCanvas from "./ScopeCanvas";

export interface FeaturedStation {
  /** NIP-29 (relay, id) tuple. */
  ref: StationRef;
  name: string;
  blurb: string;
}

/** Hand-picked stations surfaced in the empty-state explore view and in
 *  StationPreview's "Browse public stations" view. Append entries here.
 *  Orbee's own group lives on stations.orbee.chat; Grimoire and Chachi
 *  stay on groups.0xchat.com because that's where their existing
 *  communities are. */
export const FEATURED: FeaturedStation[] = [
  {
    ref: { id: "orbee", relay: "wss://stations.orbee.chat" },
    name: "Orbee",
    blurb: "It's orbee's community group!",
  },
  {
    ref: { id: "NkeVhXuWHGKKJCpn", relay: "wss://groups.0xchat.com" },
    name: "Grimoire",
    blurb: "Conversations around grimoire, a nostr client for magicians.",
  },
  {
    ref: { id: "chachi", relay: "wss://groups.0xchat.com" },
    name: "Chachi",
    blurb: "An alternative NIP-29 chat app community group.",
  },
];

/** Pull stations the current account is already a member of off a
 *  user-supplied relay (kind:39002 with #p:<my-pubkey>). Replaces the
 *  old auto-discovery against the hardcoded 0xchat relay - users who
 *  don't use that relay never get prompted now, and users who do can
 *  bring it (or any other relay) explicitly. */
function ImportFromRelay() {
  const [url, setUrl] = createSignal("wss://");
  const [busy, setBusy] = createSignal(false);
  const [status, setStatus] = createSignal<{ kind: "info" | "error"; text: string } | null>(null);

  function normalize(input: string): string | null {
    const trimmed = input.trim();
    if (!trimmed || trimmed === "wss://" || trimmed === "ws://") return null;
    if (/^wss?:\/\//.test(trimmed)) return trimmed.replace(/\/+$/, "");
    return "wss://" + trimmed.replace(/\/+$/, "");
  }

  async function runImport() {
    const target = normalize(url());
    if (!target) {
      setStatus({ kind: "error", text: "Enter a relay URL." });
      return;
    }
    setStatus(null);
    setBusy(true);
    try {
      const [r] = await discoverJoinedStations(getSigner().pubkey, [target]);
      setStatus(formatResult(r));
    } catch (e: any) {
      setStatus({ kind: "error", text: e?.message || "Couldn't reach that relay." });
    } finally {
      setBusy(false);
    }
  }

  function formatResult(r: ImportRelayResult): { kind: "info" | "error"; text: string } {
    if (r.error) return { kind: "error", text: r.error };
    if (r.added === 0 && r.alreadyJoined === 0) {
      return { kind: "info", text: `No groups found for your account on ${prettyHost(r.relay)}.` };
    }
    if (r.added === 0) {
      return { kind: "info", text: `Already in sync — ${r.alreadyJoined} group${r.alreadyJoined === 1 ? "" : "s"} on ${prettyHost(r.relay)}.` };
    }
    return { kind: "info", text: `Imported ${r.added} group${r.added === 1 ? "" : "s"} from ${prettyHost(r.relay)}.` };
  }

  function prettyHost(u: string): string { return u.replace(/^wss?:\/\//, ""); }

  return (
    <div class="explore-import">
      <div class="explore-import-row">
        <input
          type="url"
          class="explore-import-input"
          placeholder="wss://relay.example.com"
          value={url()}
          onInput={(e) => setUrl(e.currentTarget.value)}
          onKeyDown={(e) => { if (e.key === "Enter") runImport(); }}
          disabled={busy()}
        />
        <button
          type="button"
          class="explore-import-btn"
          onClick={runImport}
          disabled={busy()}
        >
          {busy() ? "Importing…" : "Import"}
        </button>
      </div>
      <div class="explore-import-hint">
        Enter a NIP-29 relay you've used before - we'll add any groups you're already a member of.
      </div>
      <Show when={status()}>
        {(s) => (
          <div class={`explore-import-status is-${s().kind}`}>{s().text}</div>
        )}
      </Show>
    </div>
  );
}

/** Card list reused by StationPreview's "Browse public stations" view. */
export function ExploreList(props: { onPick: (ref: StationRef) => void }) {
  const isJoined = (ref: StationRef) =>
    joinedStations().some((j) => j.id === ref.id && j.relay === ref.relay);

  return (
    <>
      <ul class="explore-cards">
        <For each={FEATURED}>
          {(s) => {
            const seed = getStationScopeSeed(s.ref.id, s.ref.relay);
            const joined = () => isJoined(s.ref);
            return (
              <li class="explore-card-item">
                <div class="explore-card-scope">
                  <ScopeCanvas seed={seed} size={84} accent transparentBg />
                </div>
                <div class="explore-card-body">
                  <div class="explore-card-name">{s.name}</div>
                  <div class="explore-card-blurb">{s.blurb}</div>
                  <div class="explore-card-host">
                    {s.ref.relay.replace(/^wss?:\/\//, "")}'{s.ref.id}
                  </div>
                </div>
                <button
                  type="button"
                  class={`explore-card-join ${joined() ? "is-joined" : ""}`}
                  onClick={() => {
                    if (joined()) setActiveStation(s.ref);
                    else props.onPick(s.ref);
                  }}
                >
                  {joined() ? "Tuned in" : "Tune in"}
                </button>
              </li>
            );
          }}
        </For>
      </ul>
      <ImportFromRelay />
    </>
  );
}

/** Empty-state explore screen and dedicated "find a station" view. */
export default function ExploreView(props: {
  onTune: (ref: StationRef) => void;
  lede?: string;
}) {
  return (
    <div class="explore-view">
      <div class="explore-content">
        <div class="explore-eyebrow">Find a station</div>
        <Show when={props.lede}>
          <p class="explore-lede">{props.lede}</p>
        </Show>
        <ExploreList onPick={props.onTune} />
      </div>
    </div>
  );
}
