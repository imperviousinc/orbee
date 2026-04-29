import { createSignal } from "solid-js";
import { createStore } from "solid-js/store";
import { getRelay, STATIONS_RELAY_URL } from "./nostr";
import type { NostrEvent } from "./keys";
import type { Signer } from "./signer";
import { type ScopeSeed } from "./stationScope";
import { saveCachedStationMeta, clearStationCache, clearStationReactions, clearStationRecentSnapshot } from "./messageCache";
import { subscribeStationConfig, clearStationConfig } from "./stationConfig";
import { clearStationActivity } from "./stationActivity";

// Replaceable events (39000-39003) mirrored to localStorage for synchronous
// hydration at module-load. Shape: { [`${stationKey}::${kind}`]: NostrEvent }
const META_LS_KEY = "orbee-station-meta-v1";

function loadLocalMeta(): Record<string, NostrEvent> {
  try {
    const raw = localStorage.getItem(META_LS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

let localMeta: Record<string, NostrEvent> = loadLocalMeta();
let metaSaveTimer: number | null = null;

function persistLocalMeta() {
  if (metaSaveTimer !== null) return;
  metaSaveTimer = window.setTimeout(() => {
    metaSaveTimer = null;
    try {
      localStorage.setItem(META_LS_KEY, JSON.stringify(localMeta));
    } catch (e) {
      console.warn("[stations meta] save failed:", e);
    }
  }, 250);
}

// NIP-29 (https://nips.nostr.com/29) event kinds used:
//   9      chat message (h = station id)
//   9007   create-station  (sender becomes admin)
//   9002   edit-metadata   (admin → name, about, picture, public, open)
//   9021   join-request    (user → relay)
//   9022   leave-request
//   9000   add user / change role
//   9001   remove user (kick)
//   9005   delete event
//   39000  station metadata (replaceable, d = station id)
//   39001  admins         (replaceable, d = station id)
//   39002  members        (replaceable, d = station id)
//   39003  roles          (replaceable, d = station id)
// Frequencies (station ids) are unique within a single relay only.

export interface StationRef {
  id: string;
  relay: string;
}

export interface Station extends StationRef {
  name?: string;
  about?: string;
  picture?: string;
  /** kind:39000 access tag: true = ["open"], false = ["closed"], undefined until metadata arrives. */
  open?: boolean;
  admins: string[];
  members: string[];
  /** Per-pubkey roles from trailing tags of ["p", pubkey, ...roles] on 39001/39002. Excludes "admin". */
  memberRoles: Record<string, string[]>;
  /** All role names defined for this station (kind:39003 union). */
  availableRoles: string[];
}

/** Keyed by composite "relay::id" so the same id on different relays is distinct. */
export const [stations, setStations] = createStore<Record<string, Station>>({});
export const [activeStation, setActiveStation] = createSignal<StationRef | null>(null);

/** Sidebar derives from this (not `stations`, which also holds transient previews). */
export const [joinedStations, setJoinedStations] = createSignal<StationRef[]>(loadStoredStations());

function refreshJoinedStations() {
  setJoinedStations(loadStoredStations());
}

export interface PendingRequest { pubkey: string; ts: number; }
export const [pendingRequests, setPendingRequests] = createStore<Record<string, PendingRequest[]>>({});

/** Composite key used for the store and localStorage. */
export function stationKey(s: StationRef): string {
  return `${s.relay}::${s.id}`;
}

const STORAGE_KEY = "orbee-stations";
const LEGACY_STORAGE_KEY = "orbee-groups";

export function loadStoredStations(): StationRef[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed
          .filter((x) => x && typeof x === "object" && x.id && x.relay)
          .map((x) => ({ id: String(x.id), relay: String(x.relay) }));
      }
    }
    // v1 legacy migration: array of bare ids → assume default relay
    const legacy = localStorage.getItem(LEGACY_STORAGE_KEY);
    if (legacy) {
      const parsed = JSON.parse(legacy);
      if (Array.isArray(parsed)) {
        const upgraded: StationRef[] = parsed
          .filter((x) => typeof x === "string")
          .map((id) => ({ id, relay: STATIONS_RELAY_URL }));
        saveStoredStations(upgraded);
        localStorage.removeItem(LEGACY_STORAGE_KEY);
        return upgraded;
      }
    }
  } catch {
    /* fallthrough */
  }
  return [];
}

export function saveStoredStations(refs: StationRef[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(refs));
}

export function rememberStation(s: StationRef) {
  const list = loadStoredStations();
  if (list.some((r) => r.id === s.id && r.relay === s.relay)) return;
  saveStoredStations([...list, s]);
  ensureStation(s);
  refreshJoinedStations();
}

export function forgetStation(s: StationRef) {
  const k = stationKey(s);

  // Stop subs first so late events don't repopulate caches we're dropping.
  unsubscribeJoinRequests(s);
  clearStationConfig(s);

  saveStoredStations(loadStoredStations().filter((r) => !(r.id === s.id && r.relay === s.relay)));
  setStations(k, undefined as any);
  setPendingRequests(k, undefined as any);
  clearStationActivity(s);
  clearStationRecentSnapshot(s);

  clearStationCache(s).catch((e) => console.warn("[forget] messages wipe failed:", e));
  clearStationReactions(s).catch((e) => console.warn("[forget] reactions wipe failed:", e));

  refreshJoinedStations();

  // Re-publish the batched metadata sub so 39000–39003 stops streaming for this id.
  subscribeStationsMetadata(s.relay);
}

/** Seed every remembered station into the store so the sidebar renders fast. */
export function seedStations() {
  for (const s of loadStoredStations()) ensureStation(s);
  refreshJoinedStations();
}

/**
 * Cross-device station rediscovery: query for kind:39002 (members) events
 * naming the user, auto-add any matches to the joined list. Idempotent.
 */
export function discoverJoinedStations(myPubkey: string, relayUrls: string[] = [STATIONS_RELAY_URL]) {
  for (const url of relayUrls) {
    const r = getRelay(url);
    r.connect();
    const sub = r.subscribe(
      { kinds: [39002], "#p": [myPubkey] },
      (event) => {
        const d = event.tags.find((t) => t[0] === "d")?.[1];
        if (!d) return;
        const ref: StationRef = { id: d, relay: url };
        const list = loadStoredStations();
        if (list.some((s) => s.id === ref.id && s.relay === ref.relay)) {
          handleMetadataEvent(url, event, true);
          return;
        }
        saveStoredStations([...list, ref]);
        ensureStation(ref);
        refreshJoinedStations();
        handleMetadataEvent(url, event, true);
      },
      () => {
        r.unsubscribe(sub);
      },
    );
  }
}

function ensureStation(s: StationRef, seed: Partial<Station> = {}) {
  const k = stationKey(s);
  if (stations[k]) return;
  setStations(k, {
    id: s.id,
    relay: s.relay,
    admins: [],
    members: [],
    memberRoles: {},
    availableRoles: [],
    ...seed,
  });
}

// One metadata sub per relay covering all of OUR stored stations on it.
const metadataSubs = new Map<string, string>();

/** Idempotent: replaces any existing sub so newly-joined stations are picked up. */
export function subscribeStationsMetadata(relayUrl: string) {
  const r = getRelay(relayUrl);
  const ids = loadStoredStations().filter((s) => s.relay === relayUrl).map((s) => s.id);
  const prev = metadataSubs.get(relayUrl);
  if (prev) r.unsubscribe(prev);
  metadataSubs.delete(relayUrl);
  if (ids.length === 0) return;
  const sub = r.subscribe(
    { kinds: [39000, 39001, 39002, 39003], "#d": ids },
    (event) => handleMetadataEvent(relayUrl, event, true),
  );
  metadataSubs.set(relayUrl, sub);
}

/** Synchronous boot-time hydration from localStorage so sidebar renders before any relay round-trip. */
export function hydrateStationMetadataFromCache(relayUrl: string) {
  for (const [k, event] of Object.entries(localMeta)) {
    if (!k.startsWith(relayUrl + "::")) continue;
    handleMetadataEvent(relayUrl, event, false);
  }
}

// Some NIP-29 relays reuse created_at on republish; dedup by event id
// instead so new content lands even when the timestamp doesn't move.
const lastAppliedMetaId = new Map<string, string>();
const lastAppliedMetaTs = new Map<string, number>();

function handleMetadataEvent(
  relayUrl: string,
  event: NostrEvent,
  persist: boolean,
) {
  const d = event.tags.find((t) => t[0] === "d")?.[1];
  if (!d) return;
  const ref: StationRef = { id: d, relay: relayUrl };
  ensureStation(ref);
  const k = stationKey(ref);

  const dedupKey = `${k}::${event.kind}`;
  if (lastAppliedMetaId.get(dedupKey) === event.id) return;
  if (event.created_at < (lastAppliedMetaTs.get(dedupKey) || 0)) return;
  lastAppliedMetaId.set(dedupKey, event.id);
  lastAppliedMetaTs.set(dedupKey, event.created_at);

  if (persist) {
    localMeta[`${k}::${event.kind}`] = event;
    persistLocalMeta();
    saveCachedStationMeta(ref, event).catch((e) =>
      console.warn("[stations cache] save failed:", e),
    );
  }

  switch (event.kind) {
    case 39000: {
      const name = event.tags.find((t) => t[0] === "name")?.[1];
      const about = event.tags.find((t) => t[0] === "about")?.[1];
      const picture = event.tags.find((t) => t[0] === "picture")?.[1];
      const isOpen = event.tags.some((t) => t[0] === "open");
      const isClosed = event.tags.some((t) => t[0] === "closed");
      if (name !== undefined) setStations(k, "name", name);
      if (about !== undefined) setStations(k, "about", about);
      if (picture !== undefined) setStations(k, "picture", picture);
      if (isOpen) setStations(k, "open", true);
      else if (isClosed) setStations(k, "open", false);
      break;
    }
    case 39001: {
      const pTags = event.tags.filter((t) => t[0] === "p");
      const admins = pTags.map((t) => t[1]);
      setStations(k, "admins", admins);
      // Some relays put admin's other roles after "admin" in 39001 too.
      const roleUpdates: Record<string, string[]> = {};
      for (const t of pTags) {
        const trailing = t.slice(2).filter((r) => r && r !== "admin");
        if (trailing.length > 0) roleUpdates[t[1]] = trailing;
      }
      if (Object.keys(roleUpdates).length > 0) {
        setStations(k, "memberRoles", (prev = {}) => ({ ...prev, ...roleUpdates }));
      }
      // Orbee-specific config (kind:30078) lives on general relay, not strict NIP-29 relay.
      subscribeStationConfig(ref, admins);
      break;
    }
    case 39002: {
      const pTags = event.tags.filter((t) => t[0] === "p");
      const members = pTags.map((t) => t[1]);
      setStations(k, "members", members);
      // 39002 is replaceable - rebuild memberRoles from scratch, don't merge.
      const memberRoles: Record<string, string[]> = {};
      for (const t of pTags) {
        const roles = t.slice(2).filter((r) => r && r !== "admin");
        if (roles.length > 0) memberRoles[t[1]] = roles;
      }
      setStations(k, "memberRoles", memberRoles);
      // Membership = pending request resolved.
      const memberSet = new Set(members);
      setPendingRequests(k, (prev = []) => prev.filter((p) => !memberSet.has(p.pubkey)));
      break;
    }
    case 39003: {
      // Some relays publish ["role", name, description?]; others ["role", name].
      const seen = new Set<string>();
      const roles: string[] = [];
      for (const t of event.tags) {
        if (t[0] !== "role" || !t[1]) continue;
        if (seen.has(t[1])) continue;
        seen.add(t[1]);
        roles.push(t[1]);
      }
      setStations(k, "availableRoles", roles);
      break;
    }
  }
}

// Per-station kind:9021 sub. Caller (App.tsx) gates on admin status.
const joinReqSubs = new Map<string, { sub: string; relay: string }>();

export function subscribeJoinRequests(ref: StationRef) {
  const k = stationKey(ref);
  const prev = joinReqSubs.get(k);
  if (prev) getRelay(prev.relay).unsubscribe(prev.sub);
  joinReqSubs.delete(k);
  const r = getRelay(ref.relay);
  const memberSet = new Set(stations[k]?.members || []);
  const sub = r.subscribe(
    { kinds: [9021], "#h": [ref.id], limit: 100 },
    (event) => {
      if (memberSet.has(event.pubkey)) return;
      setPendingRequests(k, (prev = []) => {
        const filtered = prev.filter((p) => p.pubkey !== event.pubkey);
        return [...filtered, { pubkey: event.pubkey, ts: event.created_at }];
      });
    },
  );
  joinReqSubs.set(k, { sub, relay: ref.relay });
}

export function unsubscribeJoinRequests(ref: StationRef) {
  const k = stationKey(ref);
  const prev = joinReqSubs.get(k);
  if (prev) getRelay(prev.relay).unsubscribe(prev.sub);
  joinReqSubs.delete(k);
}

/** Local-only dismissal. */
export function dismissPendingRequest(ref: StationRef, pubkey: string) {
  const k = stationKey(ref);
  setPendingRequests(k, (prev = []) => prev.filter((p) => p.pubkey !== pubkey));
}

/** Re-queue locally - used to undo optimistic dismiss when relay rejects an Approve. */
export function addPendingRequest(ref: StationRef, pubkey: string, ts: number) {
  const k = stationKey(ref);
  setPendingRequests(k, (prev = []) => {
    const filtered = prev.filter((p) => p.pubkey !== pubkey);
    return [...filtered, { pubkey, ts }];
  });
}

/**
 * Pending requests the viewer should see: admins of CLOSED stations only,
 * with current members/admins filtered out. Some relays (0xchat) emit 9021
 * replays for open groups - those aren't actionable and are suppressed here.
 */
export function visiblePendingRequests(
  ref: StationRef | null,
  viewerPubkey: string,
): PendingRequest[] {
  if (!ref) return [];
  if (!isAdminOf(ref, viewerPubkey)) return [];
  const k = stationKey(ref);
  const data = stations[k];
  if (data?.open !== false) return [];
  const all = pendingRequests[k] || [];
  const memberSet = new Set(data?.members || []);
  const adminSet = new Set(data?.admins || []);
  return all.filter((r) => !memberSet.has(r.pubkey) && !adminSet.has(r.pubkey));
}

/** Preview-mode metadata fetch (pre-join). Caller MUST unsubscribe on cleanup. */
export function fetchStationMetadataOnce(ref: StationRef): string {
  const r = getRelay(ref.relay);
  ensureStation(ref);
  return r.subscribe(
    { kinds: [39000, 39001, 39002, 39003], "#d": [ref.id], limit: 5 },
    // persist=false: don't cache metadata for stations the user might never join.
    (event) => handleMetadataEvent(ref.relay, event, false),
  );
}

/** Send kind:9021 join-request. `code` attaches a NIP-29 invite for auto-admit. */
export async function requestJoin(
  signer: Signer,
  ref: StationRef,
  opts: { code?: string } = {},
) {
  const tags: string[][] = [["h", ref.id]];
  if (opts.code) tags.push(["code", opts.code]);
  const event = await signer.signEvent({ kind: 9021, content: "", tags });
  return getRelay(ref.relay).publish(event);
}

/** Admin: publish kind:9009 create-invite. Caller picks `code`. */
export async function createInvite(
  signer: Signer,
  ref: StationRef,
  code: string,
) {
  const event = await signer.signEvent({
    kind: 9009,
    content: "",
    tags: [["h", ref.id], ["code", code]],
  });
  const result = await getRelay(ref.relay).publish(event);
  return { result, code };
}

/** Send kind:9022 leave-request. */
export async function requestLeave(signer: Signer, ref: StationRef) {
  const event = await signer.signEvent({ kind: 9022, content: "", tags: [["h", ref.id]] });
  return getRelay(ref.relay).publish(event);
}

/**
 * Mint a new station. Publishes 9007 (create) + 9002 (edit-metadata).
 * `open=true` (default) → joins auto-approve; `open=false` → admin approval.
 */
export async function mintStation(
  signer: Signer,
  ref: StationRef,
  opts: { name?: string; about?: string; open?: boolean } = {},
) {
  const { name, about, open = true } = opts;
  const r = getRelay(ref.relay);
  const create = await signer.signEvent({ kind: 9007, content: "", tags: [["h", ref.id]] });
  const createResult = await r.publish(create);

  const metaTags: string[][] = [["h", ref.id], ["public"], [open ? "open" : "closed"]];
  if (name) metaTags.push(["name", name]);
  if (about) metaTags.push(["about", about]);
  const meta = await signer.signEvent({ kind: 9002, content: "", tags: metaTags });
  const metaResult = await r.publish(meta);

  return { createResult, metaResult };
}

/**
 * Admin: edit standard NIP-29 metadata (9002 → relay re-publishes 39000).
 * `undefined` = omit, `null` = clear. Orbee-specific fields (scope, pinned)
 * are NOT here - see editStationConfig() (kind:30078); strict NIP-29 relays
 * strip unknown tags off 9002.
 */
export async function editStationMetadata(
  signer: Signer,
  ref: StationRef,
  opts: {
    name?: string | null;
    about?: string | null;
    picture?: string | null;
    open?: boolean;
  },
) {
  const tags: string[][] = [["h", ref.id], ["public"]];
  if (opts.open !== undefined) tags.push([opts.open ? "open" : "closed"]);
  if (opts.name !== undefined) tags.push(["name", opts.name ?? ""]);
  if (opts.about !== undefined) tags.push(["about", opts.about ?? ""]);
  if (opts.picture !== undefined) tags.push(["picture", opts.picture ?? ""]);
  const event = await signer.signEvent({ kind: 9002, content: "", tags });
  return getRelay(ref.relay).publish(event);
}

/** Admin: delete a message (NIP-29 9005). */
export async function deleteMessage(signer: Signer, ref: StationRef, eventId: string) {
  const event = await signer.signEvent({
    kind: 9005,
    content: "",
    tags: [["h", ref.id], ["e", eventId]],
  });
  return getRelay(ref.relay).publish(event);
}

/** Admin: kick a user (NIP-29 9001). */
export async function kickUser(signer: Signer, ref: StationRef, targetPubkey: string) {
  const event = await signer.signEvent({
    kind: 9001,
    content: "",
    tags: [["h", ref.id], ["p", targetPubkey]],
  });
  return getRelay(ref.relay).publish(event);
}

/** Admin: promote a user to admin (NIP-29 9000 with role tag). */
export async function promoteToAdmin(signer: Signer, ref: StationRef, targetPubkey: string) {
  const event = await signer.signEvent({
    kind: 9000,
    content: "",
    tags: [["h", ref.id], ["p", targetPubkey, "admin"]],
  });
  return getRelay(ref.relay).publish(event);
}

/**
 * Admin: replace a user's full role list (NIP-29 9000). `roles` is authoritative -
 * anything omitted is dropped, INCLUDING "admin". Pass "admin" explicitly to keep it.
 */
export async function assignRoles(
  signer: Signer,
  ref: StationRef,
  targetPubkey: string,
  roles: string[],
) {
  const event = await signer.signEvent({
    kind: 9000,
    content: "",
    tags: [["h", ref.id], ["p", targetPubkey, ...roles]],
  });
  return getRelay(ref.relay).publish(event);
}

/** Roles assigned to a pubkey, excluding the implicit "admin". */
export function getMemberRoles(ref: StationRef | null, pubkey: string): string[] {
  if (!ref) return [];
  return stations[stationKey(ref)]?.memberRoles?.[pubkey] || [];
}

/** Admin: add a user (no role) - used for re-adding kicked users (NIP-29 9000). */
export async function addUser(signer: Signer, ref: StationRef, targetPubkey: string) {
  const event = await signer.signEvent({
    kind: 9000,
    content: "",
    tags: [["h", ref.id], ["p", targetPubkey]],
  });
  return getRelay(ref.relay).publish(event);
}

export function isAdminOf(ref: StationRef | null, pubkey: string): boolean {
  if (!ref) return false;
  return !!stations[stationKey(ref)]?.admins.includes(pubkey);
}

export function isMemberOf(ref: StationRef | null, pubkey: string): boolean {
  if (!ref) return false;
  return !!stations[stationKey(ref)]?.members.includes(pubkey);
}
