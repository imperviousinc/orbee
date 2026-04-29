import type { StationRef } from "./stations";

// URL scheme for stations (NIP-29 canonical):
//   /s/<host>'<group-id>[?invite=<code>]
//
// `<host>'<group-id>` is the spec-defined identifier for a NIP-29 group
// (apostrophe-separated host + id, no scheme). `'` is an RFC 3986
// sub-delim and survives every browser's URL bar untouched, so the
// link is single-token, copy-pasteable, and recognizable by any
// other NIP-29 client. The `?invite=` query is optional - when
// present, the join flow attaches it as a `code` tag on kind:9021
// so closed groups can preauthorize via kind:9009.
//
// We always assume `wss://` for the relay; the host stored in
// StationRef.relay carries the full URL so other code can pass it
// straight to the worker, but the URL form drops the scheme to
// match the spec wire format.

const PATH_PREFIX = "/s/";
const SEPARATOR = "'";

function relayHostOnly(url: string): string {
  return url.replace(/^wss?:\/\//, "");
}

function relayFromHost(host: string): string {
  return host.includes("://") ? host : `wss://${host}`;
}

export function stationToPath(ref: StationRef, opts: { invite?: string } = {}): string {
  // We deliberately do NOT URL-encode the apostrophe - the spec form is
  // a single token and browsers leave `'` alone. Host and id are
  // already constrained to safe chars (host is a domain, id is
  // a-z0-9_-), so no % escaping is needed.
  const host = relayHostOnly(ref.relay);
  const path = `${PATH_PREFIX}${host}${SEPARATOR}${ref.id}`;
  if (opts.invite) {
    return `${path}?invite=${encodeURIComponent(opts.invite)}`;
  }
  return path;
}

/**
 * Parse a station ref out of `loc`. Accepts the canonical
 * `/s/<host>'<group-id>` form, plus the legacy `/s/<id>?r=<host>`
 * shape so any in-flight tabs / bookmarks from before the URL
 * refactor still resolve. Returns null if the path doesn't match
 * either shape or the components fail validation.
 */
export function stationFromUrl(loc: Location = window.location): StationRef | null {
  if (!loc.pathname.startsWith(PATH_PREFIX)) return null;
  const rest = loc.pathname.slice(PATH_PREFIX.length).replace(/\/$/, "");
  if (!rest) return null;

  // Canonical form: <host>'<id>. Browsers may percent-encode the
  // apostrophe in some edge cases (deep-link redirects), so accept
  // both raw and %27 on parse.
  const decoded = decodeURIComponent(rest);
  const sepIdx = decoded.indexOf(SEPARATOR);
  if (sepIdx > 0 && sepIdx < decoded.length - 1) {
    const host = decoded.slice(0, sepIdx);
    const id = decoded.slice(sepIdx + 1);
    if (isValidHost(host) && isValidGroupId(id)) {
      return { id, relay: relayFromHost(host) };
    }
    return null;
  }

  // Legacy: /s/<id>?r=<host>. Kept so links shared from earlier
  // sessions still work; remove once we're confident nothing in the
  // wild points at the old form.
  const params = new URLSearchParams(loc.search);
  const r = params.get("r");
  if (!r) return null;
  const id = decoded;
  if (!isValidGroupId(id)) return null;
  const host = decodeURIComponent(r);
  if (!isValidHost(host)) return null;
  return { id, relay: relayFromHost(host) };
}

/**
 * Read the optional `?invite=` query off the current location.
 * Returns null when absent or empty.
 */
export function inviteCodeFromUrl(loc: Location = window.location): string | null {
  const params = new URLSearchParams(loc.search);
  const code = params.get("invite");
  return code && code.length > 0 ? code : null;
}

/**
 * Read the optional `?pick=` query off the current location. Used by
 * the share-a-handle deep-link flow - `/n?pick=alice-bob-carol` lands
 * the user on the handle picker with that name pre-selected. Validated
 * against the faucet's handle grammar (lowercase a–z, digits, dashes,
 * 2–32 chars) so a malformed link can't crash the picker.
 */
export function pickFromUrl(loc: Location = window.location): string | null {
  const params = new URLSearchParams(loc.search);
  const raw = params.get("pick");
  if (!raw) return null;
  const cleaned = raw.toLowerCase().trim();
  return /^[a-z0-9-]{2,32}$/.test(cleaned) ? cleaned : null;
}

/** Push a new URL via replaceState (no history entry - refresh-friendly). */
export function replaceStationUrl(ref: StationRef | null) {
  const target = ref ? stationToPath(ref) : "/";
  if (window.location.pathname + window.location.search === target) return;
  history.replaceState(null, "", target);
}

// ── Validators ──────────────────────────────────────────────────

// NIP-29 group id grammar: a-z 0-9 _ - (no length bound in the spec,
// so we just require non-empty here). Anything else means a malformed
// link - refuse rather than silently coerce.
function isValidGroupId(id: string): boolean {
  return /^[a-z0-9_-]+$/.test(id);
}

// Host: ascii letters/digits/dots/hyphens, optional :port. Loose on
// purpose - we don't want to maintain a TLD list, just stop obvious
// junk like spaces or quotes that would have come from a malformed
// paste.
function isValidHost(host: string): boolean {
  return /^[a-zA-Z0-9.-]+(:\d+)?$/.test(host);
}