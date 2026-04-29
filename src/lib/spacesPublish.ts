/**
 * Helpers for re-publishing the operator's Spaces zone after onboarding.
 *
 * The first publish happens in ClaimHandle (post-faucet). After that,
 * the user may want to:
 *   • Re-publish (e.g. after the relay's anchor rotates and their
 *     cached zone goes stale).
 *   • Append more relay URLs to their `addr.nostr` record so resolvers
 *     can find the user's Nostr events without a separate NIP-05 step.
 *   • Add other SIP-7 records (txt, addr.email, etc.) - UI for that
 *     is in ProfileEditor's "Spaces" tab.
 *
 * Records are sequenced - each publish bumps `seq.version`. We read
 * the current zone first to discover the latest version (so concurrent
 * republishes from another client don't trample each other), then
 * write `seq.version + 1` along with the requested record set.
 */

import { publishZone, resolveHandles } from "./fabric";
import { invalidateHandle as invalidateResolvedHandle } from "./resolvedCache";
import { fetchRelayList } from "./nip65";
import { pubkeyToNpub } from "./keys";

export interface SpacesRecord {
  type: string;
  /** Arbitrary key - e.g. "nostr" for an addr record. */
  key?: string;
  /** Some records use `value`, some use `values`. We accept either
   *  in input and normalize on publish. */
  value?: any;
  values?: any;
  /** seq.version - present on `seq` records only. */
  version?: number;
}

export interface RepublishOptions {
  signer: { pubkey: string };
  certBase64: string;
  secretKey: string;
  /** Full handle, e.g. "alice.genesis@key". Used to invalidate the
   *  cache + resolve the prior seq version. */
  handle: string;
  /** Extra records the user wants to publish. The `seq` + `addr.nostr`
   *  records are managed for them - extras get appended, deduped by
   *  type+key (newer overrides older). */
  extraRecords?: SpacesRecord[];
  /** When true (default), look up the user's NIP-65 relay list and
   *  append its `write` URLs to the `addr.nostr` value array. */
  includeRelayList?: boolean;
}

export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

/** Load the current zone's user-editable records - i.e. everything
 *  except the protocol-managed rows (seq, sig, addr.nostr). Used by
 *  the ProfileEditor's Spaces tab to seed the records list with what
 *  is already published, so the user edits-in-place instead of
 *  starting from an empty state and accidentally wiping prior records. */
export async function loadEditableRecords(handle: string): Promise<SpacesRecord[]> {
  const recs = await readCurrentRecords(handle);
  if (!recs) return [];
  return recs.filter(
    (r) =>
      r.type !== "seq" &&
      r.type !== "sig" &&
      !(r.type === "addr" && r.key === "nostr"),
  );
}

export interface ManagedSnapshot {
  /** seq.version currently on the relay; null if zone hasn't been
   *  published before (next publish writes seq.version=1). */
  currentSeq: number | null;
  /** What the next publish will use - `(currentSeq ?? 0) + 1`. */
  nextSeq: number;
  /** The current addr.nostr value array (raw, as published). */
  nostrAddr: any[] | null;
}

/** Snapshot of the auto-managed rows so the editor can show them as
 *  read-only context. Same lookup as loadEditableRecords; cheap to
 *  call alongside it. */
export async function loadManagedSnapshot(handle: string): Promise<ManagedSnapshot> {
  const recs = await readCurrentRecords(handle);
  if (!recs) return { currentSeq: null, nextSeq: 1, nostrAddr: null };
  const seq = recs.find((r) => r.type === "seq");
  const nostr = recs.find((r) => r.type === "addr" && r.key === "nostr");
  const cur = typeof seq?.version === "number" ? seq.version : null;
  const value = nostr?.value ?? nostr?.values ?? null;
  return {
    currentSeq: cur,
    nextSeq: (cur ?? 0) + 1,
    nostrAddr: Array.isArray(value) ? value : value != null ? [value] : null,
  };
}

/** Pull the current zone's records (if any). Returns `null` if the
 *  zone hasn't been published before or fabric can't reach a relay
 *  right now - the caller treats that as "first publish, seq=1". */
async function readCurrentRecords(handle: string): Promise<SpacesRecord[] | null> {
  try {
    const zones = await resolveHandles([handle]);
    const zone = zones.find((z) => z.handle.toLowerCase() === handle.toLowerCase());
    const recs = zone?.json?.records as SpacesRecord[] | undefined;
    return Array.isArray(recs) ? recs : null;
  } catch {
    return null;
  }
}

/** Publish (or re-publish) the operator's Spaces zone.
 *
 *  Behavior:
 *    1. Resolve the current zone (if any) - gives us the latest
 *       `seq.version` AND lets us preserve every other record.
 *       certrelay rejects republishes whose seq.version isn't
 *       strictly greater than the last accepted one, so we ALWAYS
 *       compute the next version from a fresh resolve.
 *    2. Build the new record set: existing records (minus seq +
 *       addr.nostr, which we manage), plus the user's `extraRecords`
 *       (which override anything by matching type+key), plus the
 *       fresh `seq` and `addr.nostr` entries.
 *    3. Publish + invalidate the resolved-cache so the operator's
 *       own UI re-reads the new zone on next verify.
 */
export async function republishSpacesZone(opts: RepublishOptions): Promise<void> {
  const npub = pubkeyToNpub(opts.signer.pubkey);
  const writeRelays = opts.includeRelayList === false
    ? []
    : ((await fetchRelayList(opts.signer.pubkey))?.write ?? []);

  const current = await readCurrentRecords(opts.handle);
  const currentSeq = current?.find((r) => r.type === "seq");
  const curVersion = typeof currentSeq?.version === "number" ? currentSeq.version : 0;
  const nextVersion = curVersion + 1;

  // Start from existing records (preserved across republish), strip the
  // protocol-managed ones:
  //   • seq        - we write a fresh bumped version below
  //   • addr.nostr - we regenerate from npub + NIP-65 write relays
  //   • sig        - the publish pipeline re-signs the new record set;
  //                  the old signature is invalid AND SIP-7 requires
  //                  the sig record to be LAST. Carrying it forward
  //                  pushes it into the middle of the array and the
  //                  pack step rejects with "sig record must be the
  //                  last record".
  // Anything else the user previously published - txt, other addrs,
  // delegate hints - flows through untouched.
  const merged: SpacesRecord[] = (current ?? []).filter(
    (r) =>
      r.type !== "seq" &&
      r.type !== "sig" &&
      !(r.type === "addr" && r.key === "nostr"),
  );

  // Apply user extras. Same dedupe rule as the Spaces explorer:
  // (type, key) is the primary key, last write wins.
  if (opts.extraRecords?.length) {
    for (const r of opts.extraRecords) {
      const isManaged =
        r.type === "seq" || (r.type === "addr" && r.key === "nostr");
      if (isManaged) continue;
      const idx = merged.findIndex((x) => x.type === r.type && (x.key ?? "") === (r.key ?? ""));
      if (idx >= 0) merged[idx] = r;
      else merged.push(r);
    }
  }

  // Managed rows last so they always sit at predictable positions in
  // the published record set (some explorers display in array order).
  merged.unshift({ type: "seq", version: nextVersion });
  merged.push({ type: "addr", key: "nostr", value: [npub, ...writeRelays] });

  console.log("[spaces/republish]", {
    handle: opts.handle,
    fromVersion: curVersion,
    toVersion: nextVersion,
    recordCount: merged.length,
    types: merged.map((r) => `${r.type}${r.key ? `.${r.key}` : ""}`),
  });

  await publishZone({
    cert: base64ToBytes(opts.certBase64),
    records: merged,
    secretKey: opts.secretKey,
  });

  await invalidateResolvedHandle(opts.handle);
}
