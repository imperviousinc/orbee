import { For, Show } from "solid-js";
import { joinedStations, setActiveStation, type StationRef } from "../lib/stations";
import { getStationScopeSeed } from "../lib/stationScope";
import ScopeCanvas from "./ScopeCanvas";

export interface FeaturedStation {
  /** NIP-29 (relay, id) tuple. */
  ref: StationRef;
  name: string;
  blurb: string;
}

/** Hand-picked stations surfaced in the empty-state explore view and in
 *  StationPreview's "Browse public stations" view. Append entries here. */
export const FEATURED: FeaturedStation[] = [
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

/** Card list reused by StationPreview's "Browse public stations" view. */
export function ExploreList(props: { onPick: (ref: StationRef) => void }) {
  const isJoined = (ref: StationRef) =>
    joinedStations().some((j) => j.id === ref.id && j.relay === ref.relay);

  return (
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
