import type { Signer } from "./signer";
import { isLocalSigner } from "./signer";
import type { Keypair } from "./keys";

/**
 * Shared auth state accessible from any module. Set once at sign-in, read
 * by components and lib helpers that need to sign events or identify the
 * current user.
 */

export interface AuthState {
  handle: string;      // e.g. "grace@key" ("" when using a bare npub identity)
  signer: Signer;      // routes all outgoing events through its implementation
}

let current: AuthState | null = null;

export function setAuth(auth: AuthState) {
  current = auth;
}

export function getAuth(): AuthState {
  if (!current) throw new Error("Not authenticated");
  return current;
}

/** The active signer - what every publish path should use. */
export function getSigner(): Signer {
  return getAuth().signer;
}

export function isAuthenticated(): boolean {
  return current !== null;
}

/**
 * Back-compat escape hatch for the handful of code paths that need raw
 * keypair access (recovery-key reveal in ProfileEditor). Throws if the
 * current signer isn't local - those paths should gate their UI on
 * `isLocalSigner(signer)` before calling this.
 */
export function getKeypair(): Keypair {
  const s = getSigner();
  if (!isLocalSigner(s)) {
    throw new Error("getKeypair() called but the active signer is remote");
  }
  return s.keypair;
}