import { createSignal } from "solid-js";
import {
  isBackupPending as rawIsBackupPending,
  isBackupSnoozed as rawIsBackupSnoozed,
  setBackupPending as rawSetBackupPending,
  clearBackupPending as rawClearBackupPending,
  snoozeBackup as rawSnoozeBackup,
} from "./keys";

// ── Reactive backup state ──────────────────────────────────────────
//
// The raw helpers in keys.ts read localStorage synchronously - fine for
// imperative code paths (sign-in), but not reactive on their own. We
// wrap them with a tick signal that increments on every mutation, so
// components using the reactive `useBackupState(pubkey)` accessor
// recompute correctly.
//
// Additionally we run a once-per-minute interval while the app is open
// so snooze expirations (1h timers) flip the banner back on without
// needing the user to interact.

const [tick, setTick] = createSignal(0);

function bump() {
  setTick((n) => n + 1);
}

// Minute-tick so `useBackupState` re-reads snooze expiries.
if (typeof window !== "undefined") {
  window.setInterval(bump, 60_000);
}

export function setBackupPending(pubkey: string) {
  rawSetBackupPending(pubkey);
  bump();
}

export function clearBackupPending(pubkey: string) {
  rawClearBackupPending(pubkey);
  bump();
}

export function snoozeBackup(pubkey: string, ms?: number) {
  rawSnoozeBackup(pubkey, ms);
  bump();
}

/** Reactive accessor - returns current backup state for the given pubkey. */
export function useBackupState(pubkey: () => string | undefined): () => {
  pending: boolean;
  snoozed: boolean;
  shouldShow: boolean;
} {
  return () => {
    tick();  // subscribe to mutations + minute tick
    const pk = pubkey();
    if (!pk) return { pending: false, snoozed: false, shouldShow: false };
    const pending = rawIsBackupPending(pk);
    const snoozed = rawIsBackupSnoozed(pk);
    return { pending, snoozed, shouldShow: pending && !snoozed };
  };
}

/** Non-reactive check for the logout-guard code path. */
export function hasUnbackedKey(pubkey: string): boolean {
  return rawIsBackupPending(pubkey);
}
