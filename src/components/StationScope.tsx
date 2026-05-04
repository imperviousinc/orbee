import {
  getStationScopeSeed,
  applyPresetOverride,
  type ScopeSeed,
} from "../lib/stationScope";
import { stationKey } from "../lib/stations";
import { stationConfigs } from "../lib/stationConfig";
import ScopeCanvas from "./ScopeCanvas";

/**
 * Per-station oscilloscope-icon avatar. Reads any admin-published scope
 * override from the Orbee station config (kind:30078) - preset (override
 * params) or path (free-drawn polyline). Falls back to the deterministic
 * seed derived from the station id.
 *
 * Pure rendering happens in <ScopeCanvas/>; this component just composes
 * the effective seed (deterministic + override).
 */
export default function StationScope(props: {
  stationId: string;
  relay: string;
  size?: number;
  animated?: boolean;
  accent?: boolean;
  /** Trace-only rendering; see ScopeCanvas.bare. */
  bare?: boolean;
  /** Transparent bg; see ScopeCanvas.transparentBg. */
  transparentBg?: boolean;
  /** Relay is unreachable: paint amber, freeze the trace. */
  offline?: boolean;
}) {
  const effectiveSeed = (): ScopeSeed => {
    const base = getStationScopeSeed(props.stationId, props.relay);
    const override = stationConfigs[stationKey({ id: props.stationId, relay: props.relay })]?.config.scope;
    if (!override) return base;
    if (override.kind === "preset") return applyPresetOverride(base, override.params);
    return { ...base, path: override.points };
  };
  return (
    <ScopeCanvas
      seed={effectiveSeed()}
      size={props.size}
      animated={props.animated}
      accent={props.accent}
      bare={props.bare}
      transparentBg={props.transparentBg}
      offline={props.offline}
    />
  );
}
