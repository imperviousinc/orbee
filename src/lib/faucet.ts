/**
 * Spaces protocol handle faucet client.
 *
 * The faucet gives away pre-committed BIP-39-word handles under a fixed
 * space (`#944203-189-0.genesis@key`). Flow:
 *
 *   GET  /peek         → 100 available names (stable list, client caches)
 *   POST /claim        → reserves a name; returns cert + secret_key
 *   GET  /stats        → total claimed so far (for the station-stat readout)
 *
 * Claim is one-shot: once issued the server deletes its copy of the
 * secret key, so the client is responsible for keeping it (localStorage
 * for now; later a proper backup surface).
 */

const FAUCET_BASE = "https://faucet.spacesprotocol.org";
const SPACE = "#944203-189-0";
const SUFFIX = ".genesis@key";

export interface ClaimResponse {
  certificate: string;   // .spacecert, base64
  name: string;          // the reserved raw name (e.g. "alice")
  secret_key?: string;   // Bitcoin space key - only returned on claim
}

/** Typed error so callers can branch on HTTP status (e.g. 410 = gone,
 *  409 = already claimed). Kept lean - the body text falls through as
 *  the message for unknown statuses. */
export class FaucetError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "FaucetError";
    this.status = status;
  }
}

export async function peek(): Promise<string[]> {
  const r = await fetch(`${FAUCET_BASE}/peek`);
  if (!r.ok) throw new Error(`peek failed (${r.status})`);
  const j = await r.json();
  if (!Array.isArray(j?.names)) throw new Error("peek: bad shape");
  return j.names as string[];
}

export async function claim(name: string): Promise<ClaimResponse> {
  const r = await fetch(`${FAUCET_BASE}/claim`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name, space: SPACE, suffix: SUFFIX }),
  });
  if (!r.ok) {
    const text = await r.text().catch(() => "");
    throw new FaucetError(text || `claim failed (${r.status})`, r.status);
  }
  return (await r.json()) as ClaimResponse;
}

export async function stats(): Promise<{ claimed: number }> {
  const r = await fetch(`${FAUCET_BASE}/stats?cache=no`);
  if (!r.ok) throw new Error(`stats failed (${r.status})`);
  const j = await r.json();
  return { claimed: Number(j?.claimed ?? 0) };
}

/** Full handle form: `alice.genesis@key`. */
export function fullHandle(name: string): string {
  return name + SUFFIX;
}
