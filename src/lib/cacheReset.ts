/**
 * Wipe every cache the app has built up locally - except auth, joined
 * stations, and the trust anchor. Used by the "Reset cache" button in
 * the profile editor to rule out stale-cache jank when debugging.
 *
 * For full sign-out (different account possible on next sign-in), use
 * `wipeAccountData()` instead - it also clears joined stations + the
 * trust anchor + backup-pending markers.
 *
 * Both trigger a page reload after wiping so all in-memory stores reset.
 */

const CACHE_LS_KEYS = [
  "orbee-recent-v1",         // sync message snapshot
  "orbee-row-heights-v2",    // virtualizer row heights
  "orbee-avatar-status-v1",  // avatar verified/broken sets
  "orbee-profiles-v1",       // profile snapshot
  "orbee-station-meta-v1",   // station metadata snapshot (kinds 39000-39003)
  "orbee-station-activity",  // sidebar activity (last event per station)
  "orbee-station-reads",     // unread cursor per station
  "orbee-station-scroll-v1", // legacy scroll position (no longer written)
  "orbee-station-scroll-v2", // legacy scroll anchor   (no longer written)
];

// Per-account state that the "Reset cache" button preserves but a full
// sign-out should wipe, otherwise the next account to sign in sees the
// previous user's stations + trust anchor + backup nags.
const ACCOUNT_LS_KEYS = [
  "orbee-stations",                // joined stations list
  "orbee-groups",                  // legacy joined stations key
  "orbee-fabric-state",            // fabric saveState() snapshot (peers + trust anchor + observed)
  "orbee-handle-claim",            // claimed handle (cert + secret)
];

// Per-pubkey prefixes whose values should all be cleared on sign-out.
const ACCOUNT_LS_PREFIXES = [
  "orbee-backup-pending:",
  "orbee-backup-snoozed:",
  "orbee-handle-skipped:",
];

const CACHE_IDB_DBS = [
  "orbee-cache-v2",   // messages, reactions, station meta (IDB tier)
  "spaces-profiles",  // profiles (IDB tier)
];

async function wipeIdb(): Promise<void> {
  await Promise.all(
    CACHE_IDB_DBS.map(
      (name) =>
        new Promise<void>((resolve) => {
          try {
            const req = indexedDB.deleteDatabase(name);
            req.onsuccess = () => resolve();
            req.onerror = () => resolve();   // best-effort
            req.onblocked = () => resolve(); // tabs may hold connections
          } catch {
            resolve();
          }
        }),
    ),
  );
}

export async function resetAllCaches(): Promise<void> {
  for (const k of CACHE_LS_KEYS) {
    try { localStorage.removeItem(k); } catch { /* ignored */ }
  }
  await wipeIdb();
}

/**
 * Aggressive wipe for sign-out - resetAllCaches plus every scrap of
 * account-scoped state. Must run BEFORE clearAuth if you still want to
 * read the pubkey for pubkey-prefixed keys (we don't here; we wipe by
 * prefix scan).
 */
export async function wipeAccountData(): Promise<void> {
  for (const k of CACHE_LS_KEYS) {
    try { localStorage.removeItem(k); } catch { /* ignored */ }
  }
  for (const k of ACCOUNT_LS_KEYS) {
    try { localStorage.removeItem(k); } catch { /* ignored */ }
  }
  // Prefix scan for per-pubkey keys.
  try {
    const toRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k) continue;
      if (ACCOUNT_LS_PREFIXES.some((p) => k.startsWith(p))) toRemove.push(k);
    }
    for (const k of toRemove) localStorage.removeItem(k);
  } catch { /* ignored */ }
  await wipeIdb();
}
