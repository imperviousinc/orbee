/**
 * Default semi-trusted anchor fetcher.
 *
 * Until the user installs their own trust anchor, the app needs SOME
 * source of truth so handles can verify against the chain rather than
 * just peer gossip ("unverified"). We fetch the latest anchor root
 * from Spaces' two public anchor relays, exactly like the Spaces
 * website's trust popover does - HEAD `/anchors`, read `x-anchor-root`
 * (32-byte trust id) and `x-anchor-height` (block height for display).
 *
 * Cached in localStorage for 5 minutes so we don't beat on the relays
 * across reloads. Per-tab in-memory dedupe collapses concurrent calls
 * during the cache miss into one network request.
 *
 * The result feeds `fabric.semiTrust(trustId)` - semi-trusted anchors
 * earn a "verified" badge for non-sovereign handles, but cannot promote
 * a sovereign handle to "orange" (the trusted slot). That gradation is
 * what makes this safe as a default: pinning a real trust anchor from
 * a downloaded full-node snapshot still wins over our public default.
 */

const RELAY_URLS = [
  "https://relay-cosmos.spacesprotocol.org/anchors",
  "https://relay-pulsar.spacesprotocol.org/anchors",
];

const CACHE_KEY = "spacesDefaultAnchor";
// Anchors update on a ~6h cadence, so a 20-min TTL is plenty fresh
// without hammering the public relays on every reload / tab open.
const CACHE_TTL_MS = 20 * 60 * 1000;

export interface DefaultAnchor {
  trust_id: string;
  height: number;
}

interface CacheEnvelope {
  value: DefaultAnchor;
  cached_at: number;
}

function readCache(): DefaultAnchor | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const env = JSON.parse(raw) as CacheEnvelope;
    if (!env?.value?.trust_id || typeof env.cached_at !== "number") return null;
    if (Date.now() - env.cached_at > CACHE_TTL_MS) return null;
    return env.value;
  } catch {
    return null;
  }
}

function writeCache(value: DefaultAnchor) {
  try {
    const env: CacheEnvelope = { value, cached_at: Date.now() };
    localStorage.setItem(CACHE_KEY, JSON.stringify(env));
  } catch {
    // localStorage full or disabled; falling through is fine - next
    // call just re-fetches.
  }
}

let inflight: Promise<DefaultAnchor> | null = null;

/**
 * Resolve the default Spaces semi-trusted anchor (trust id + chain
 * height), preferring cache. Tries each relay in order; the first
 * one that returns a well-formed `x-anchor-root` header wins.
 *
 * Throws only when both relays fail AND nothing is cached. The hex
 * trust id is returned exactly as the relay sent it (lowercase, no
 * `0x` prefix) - fabric.semiTrust() accepts that shape directly.
 */
export function fetchDefaultAnchor(): Promise<DefaultAnchor> {
  const cached = readCache();
  if (cached) return Promise.resolve(cached);
  if (inflight) return inflight;

  inflight = (async () => {
    let lastError: unknown = null;
    for (const url of RELAY_URLS) {
      try {
        const res = await fetch(url, { method: "HEAD" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const trust_id = res.headers.get("x-anchor-root");
        const heightRaw = res.headers.get("x-anchor-height");
        if (!trust_id) throw new Error("missing x-anchor-root");
        if (!heightRaw) throw new Error("missing x-anchor-height");
        const height = Number(heightRaw);
        if (!Number.isFinite(height)) throw new Error("invalid height");
        const value: DefaultAnchor = {
          trust_id: trust_id.replace(/^0x/, "").toLowerCase(),
          height,
        };
        writeCache(value);
        return value;
      } catch (err) {
        lastError = err;
      }
    }
    throw lastError ?? new Error("all anchor requests failed");
  })().finally(() => {
    inflight = null;
  });

  return inflight;
}
