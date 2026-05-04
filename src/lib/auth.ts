import type { Signer } from "./signer";

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
