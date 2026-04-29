/**
 * Claimed-handle persistence.
 *
 * On successful faucet claim we stash the full result (name, cert,
 * secret_key) in localStorage. Later surfaces (profile editor, Spaces
 * zone publisher) read from here. The "skipped" flag is per-pubkey so
 * a user who dismisses the claim flow doesn't get re-prompted every
 * session - but a different account can still land on the page.
 */

const CLAIM_KEY = "orbee-handle-claim";
const SKIPPED_PREFIX = "orbee-handle-skipped:";

export interface ClaimedHandle {
  /** Raw name, e.g. "alice". */
  name: string;
  /** Full form, e.g. "alice.genesis@key". */
  full: string;
  /** Base64 .spacecert from the faucet. */
  certificate: string;
  /** Space-key (Bitcoin key) returned once on claim. */
  secretKey?: string;
  claimedAt: number;
  /** True once both the Spaces zone record and the kind:0 handle
   *  field have been published. Until then, the gate returns the
   *  user to the setup-mapping page on reload. */
  mappingPublished?: boolean;
}

export function loadClaimedHandle(): ClaimedHandle | null {
  try {
    const raw = localStorage.getItem(CLAIM_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as ClaimedHandle;
  } catch {
    return null;
  }
}

export function saveClaimedHandle(h: ClaimedHandle): void {
  localStorage.setItem(CLAIM_KEY, JSON.stringify(h));
}

/** Flip the mapping-published flag on the already-saved claim. */
export function markMappingPublished(): void {
  const h = loadClaimedHandle();
  if (!h) return;
  saveClaimedHandle({ ...h, mappingPublished: true });
}

/** True when a claim exists and its mapping has been fully published. */
export function isClaimComplete(): boolean {
  const h = loadClaimedHandle();
  return !!h?.mappingPublished;
}

export function clearClaimedHandle(): void {
  localStorage.removeItem(CLAIM_KEY);
}

export function isHandleSkipped(pubkey: string): boolean {
  return localStorage.getItem(SKIPPED_PREFIX + pubkey) === "1";
}

export function setHandleSkipped(pubkey: string): void {
  localStorage.setItem(SKIPPED_PREFIX + pubkey, "1");
}

const HAS_HANDLE_PREFIX = "orbee-pubkey-handle:";
export function pubkeyHasVerifiedHandle(pubkey: string): boolean {
  return localStorage.getItem(HAS_HANDLE_PREFIX + pubkey) === "1";
}
export function markPubkeyVerifiedHandle(pubkey: string): void {
  localStorage.setItem(HAS_HANDLE_PREFIX + pubkey, "1");
}
