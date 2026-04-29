import { createSignal } from "solid-js";
import { createStore, reconcile } from "solid-js/store";
import { getCreatureAvatar } from "./creatures";
// kind:0 lives on the general-purpose relay, not the NIP-29 groups relay.
import { profileRelay as relay } from "./nostr";
import { truncateNpub, truncateNpubParts } from "./keys";
import type { Signer } from "./signer";
import { requestVerification } from "./verify";

export interface Profile {
  name?: string;
  display_name?: string;
  picture?: string;
  about?: string;
  handle?: string;  // spaces protocol handle, e.g. "alice@bitcoin"
  fetchedAt: number;
}

const [profiles, setProfiles] = createStore<Record<string, Profile>>({});
export { profiles };

// localStorage mirror for synchronous hydration at module-load - IDB cache
// (loadCachedProfiles) is async and would flicker display names on first paint.
const PROFILES_LS_KEY = "orbee-profiles-v1";
const PROFILES_LS_LIMIT = 2000;

function loadLocalProfiles(): Record<string, Profile> {
  try {
    const raw = localStorage.getItem(PROFILES_LS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

let localProfiles = loadLocalProfiles();
let profileSaveTimer: number | null = null;

function persistLocalProfiles() {
  if (profileSaveTimer !== null) return;
  profileSaveTimer = window.setTimeout(() => {
    profileSaveTimer = null;
    try {
      const entries = Object.entries(localProfiles);
      if (entries.length > PROFILES_LS_LIMIT) {
        entries.sort((a, b) => (b[1].fetchedAt || 0) - (a[1].fetchedAt || 0));
        localProfiles = Object.fromEntries(entries.slice(0, PROFILES_LS_LIMIT));
      }
      localStorage.setItem(PROFILES_LS_KEY, JSON.stringify(localProfiles));
    } catch (e) {
      console.warn("[profiles] localStorage save failed:", e);
    }
  }, 500);
}

// MUST run synchronously at module-load - populates store before first paint.
for (const [pubkey, profile] of Object.entries(localProfiles)) {
  setProfiles(pubkey, profile);
}

const DB_NAME = "spaces-profiles";
const DB_VERSION = 1;
const STORE_NAME = "profiles";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE_NAME);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function dbGet(pubkey: string): Promise<Profile | undefined> {
  const db = await openDb();
  return new Promise((resolve) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const req = tx.objectStore(STORE_NAME).get(pubkey);
    req.onsuccess = () => resolve(req.result ?? undefined);
    req.onerror = () => resolve(undefined);
  });
}

async function dbPutBatch(entries: [string, Profile][]) {
  const db = await openDb();
  const tx = db.transaction(STORE_NAME, "readwrite");
  const store = tx.objectStore(STORE_NAME);
  for (const [key, val] of entries) {
    store.put(val, key);
  }
}

async function dbGetAll(): Promise<Record<string, Profile>> {
  const db = await openDb();
  return new Promise((resolve) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const store = tx.objectStore(STORE_NAME);
    const result: Record<string, Profile> = {};
    const cursorReq = store.openCursor();
    cursorReq.onsuccess = () => {
      const cursor = cursorReq.result;
      if (cursor) {
        result[cursor.key as string] = cursor.value;
        cursor.continue();
      } else {
        resolve(result);
      }
    };
    cursorReq.onerror = () => resolve({});
  });
}

export async function loadCachedProfiles() {
  const cached = await dbGetAll();
  const keys = Object.keys(cached);
  if (keys.length > 0) {
    for (const [pubkey, profile] of Object.entries(cached)) {
      setProfiles(pubkey, reconcile(profile));
      localProfiles[pubkey] = profile;
      requestVerification(pubkey, profile.handle);
    }
    // MUST flush synchronously (not debounced) - a refresh inside the 500ms
    // debounce window would otherwise re-flicker.
    try {
      localStorage.setItem(PROFILES_LS_KEY, JSON.stringify(localProfiles));
    } catch (e) {
      console.warn("[profiles] localStorage flush failed:", e);
    }
  }
  return keys.length;
}

function processKind0(pubkey: string, content: string) {
  try {
    const parsed = JSON.parse(content);
    const profile: Profile = {
      name: parsed.name ?? undefined,
      display_name: parsed.display_name ?? undefined,
      picture: parsed.picture ?? undefined,
      about: parsed.about ?? undefined,
      handle: parsed.handle ?? undefined,
      fetchedAt: Date.now(),
    };

    console.log("[profile/kind0]", {
      pubkey: pubkey.slice(0, 10),
      incoming: { display_name: profile.display_name, handle: profile.handle, name: profile.name },
      current: {
        display_name: profiles[pubkey]?.display_name,
        handle: profiles[pubkey]?.handle,
        name: profiles[pubkey]?.name,
      },
    });

    // Set each property individually so SolidJS tracks them.
    setProfiles(pubkey, {
      name: profile.name,
      display_name: profile.display_name,
      picture: profile.picture,
      about: profile.about,
      handle: profile.handle,
      fetchedAt: profile.fetchedAt,
    });

    dbPutBatch([[pubkey, profile]]).catch(() => {});
    localProfiles[pubkey] = profile;
    persistLocalProfiles();

    requestVerification(pubkey, profile.handle);
  } catch {}
}

const pendingPubkeys = new Set<string>();
let batchTimer: number | null = null;
const BATCH_DELAY = 50;

function flushBatch() {
  batchTimer = null;
  if (pendingPubkeys.size === 0) return;

  const authors = [...pendingPubkeys];
  pendingPubkeys.clear();

  relay.subscribe(
    { kinds: [0], authors },
    (event) => {
      processKind0(event.pubkey, event.content);
    },
  );
}

export function requestProfiles(pubkeys: string[]) {
  const STALE_MS = 4 * 60 * 60 * 1000;
  const now = Date.now();

  for (const pk of pubkeys) {
    const cached = profiles[pk];
    if (cached && now - cached.fetchedAt < STALE_MS) continue;
    pendingPubkeys.add(pk);
  }

  if (pendingPubkeys.size > 0 && !batchTimer) {
    batchTimer = window.setTimeout(flushBatch, BATCH_DELAY);
  }
}

export function requestProfilesPriority(pubkeys: string[]) {
  const missing = pubkeys.filter((pk) => !profiles[pk]);
  if (missing.length === 0) return;

  relay.subscribe(
    { kinds: [0], authors: missing },
    (event) => processKind0(event.pubkey, event.content),
  );
}

export function refreshStaleProfiles() {
  const STALE_MS = 4 * 60 * 60 * 1000;
  const now = Date.now();
  const stale: string[] = [];

  for (const [pubkey, profile] of Object.entries(profiles)) {
    if (now - profile.fetchedAt > STALE_MS) {
      stale.push(pubkey);
    }
  }

  if (stale.length > 0) {
    for (let i = 0; i < stale.length; i += 50) {
      const chunk = stale.slice(i, i + 50);
      relay.subscribe(
        { kinds: [0], authors: chunk },
        (event) => processKind0(event.pubkey, event.content),
      );
    }
  }
}

// Display-name spoof guard. Reject anything that could pose as an identity
// (npub/handle/URL/protocol-prefix/invisible chars) and fall through to npub.
const SUSPECT_NAME_PATTERNS: RegExp[] = [
  /@/,
  /npub1/i,
  /^https?:\/\//i,
  /^(nostr:|nsec1|nprofile1|nevent1|naddr1|note1)/i,
  /[\u0000-\u001F\u007F\u200B-\u200F\u2028-\u202E\u2066-\u2069\uFEFF]/,
];
const MAX_NAME_LEN = 48;

function safeName(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > MAX_NAME_LEN) return undefined;
  for (const pat of SUSPECT_NAME_PATTERNS) {
    if (pat.test(trimmed)) return undefined;
  }
  return trimmed;
}

/** Handle-first identity label for security-relevant surfaces (message meta row). */
export function displayName(pubkey: string): string {
  // Access each property directly so SolidJS tracks all of them.
  const handle = profiles[pubkey]?.handle;
  if (handle) return handle;
  const display_name = safeName(profiles[pubkey]?.display_name);
  if (display_name) return display_name;
  const name = safeName(profiles[pubkey]?.name);
  if (name) return name;
  return truncateNpub(pubkey);
}

/** Display-name-first label for non-security surfaces (tooltips, mention suggestions). */
export function friendlyName(pubkey: string): string {
  const display_name = safeName(profiles[pubkey]?.display_name);
  if (display_name) return display_name;
  const name = safeName(profiles[pubkey]?.name);
  if (name) return name;
  const handle = profiles[pubkey]?.handle;
  if (handle) return handle;
  return truncateNpub(pubkey);
}

export function hasHandle(pubkey: string): boolean {
  const handle = profiles[pubkey]?.handle;
  if (handle) return true;
  return !!(safeName(profiles[pubkey]?.display_name) || safeName(profiles[pubkey]?.name));
}

export function getHandle(pubkey: string): string | undefined {
  return profiles[pubkey]?.handle;
}

/** Identity (handle or npub) + secondary label split for two-tier name rendering. */
export interface IdentityParts {
  primary: string;
  npubParts?: { prefix: string; head: string; tail: string };
  secondary?: string;
  hasHandle: boolean;
}

export function identityParts(pubkey: string): IdentityParts {
  const handle = profiles[pubkey]?.handle;
  const name = safeName(profiles[pubkey]?.display_name) || safeName(profiles[pubkey]?.name);
  if (handle) {
    const secondary = name && name.toLowerCase() !== handle.toLowerCase() ? name : undefined;
    return { primary: handle, secondary, hasHandle: true };
  }
  return {
    primary: truncateNpub(pubkey),
    npubParts: truncateNpubParts(pubkey),
    secondary: name,
    hasHandle: false,
  };
}

// Avatar preload tracking: known-good URLs render directly; unknown URLs show
// the creature avatar while an off-DOM Image() probes, then swap on success.
// Eliminates the broken-image-then-creature flash on refresh.

const AVATAR_LS_KEY = "orbee-avatar-status-v1";
const AVATAR_CAP = 4000;

interface AvatarStatusSnapshot {
  ok: string[];
  bad: string[];
}

const loadedAvatars = new Set<string>();
const brokenAvatars = new Set<string>();

(function hydrateAvatarStatus() {
  try {
    const raw = localStorage.getItem(AVATAR_LS_KEY);
    if (!raw) return;
    const parsed: AvatarStatusSnapshot = JSON.parse(raw);
    if (Array.isArray(parsed.ok)) for (const u of parsed.ok) loadedAvatars.add(u);
    if (Array.isArray(parsed.bad)) for (const u of parsed.bad) brokenAvatars.add(u);
  } catch { /* ignored */ }
})();

let avatarSaveTimer: number | null = null;
function persistAvatarStatus() {
  if (avatarSaveTimer !== null) return;
  avatarSaveTimer = window.setTimeout(() => {
    avatarSaveTimer = null;
    try {
      const ok = [...loadedAvatars].slice(-AVATAR_CAP);
      const bad = [...brokenAvatars].slice(-AVATAR_CAP);
      localStorage.setItem(AVATAR_LS_KEY, JSON.stringify({ ok, bad }));
    } catch (e) {
      console.warn("[avatars] localStorage save failed:", e);
    }
  }, 800);
}

const [avatarTick, setAvatarTick] = createSignal(0);
const inflightPreloads = new Set<string>();
const queuedPreloads: string[] = [];

// Defer preloads until after document load - Chrome counts in-flight Image()
// requests toward the document's resource list and keeps the tab spinner alive.
let pageLoaded =
  typeof document !== "undefined" && document.readyState === "complete";
if (!pageLoaded && typeof window !== "undefined") {
  window.addEventListener(
    "load",
    () => {
      pageLoaded = true;
      while (queuedPreloads.length) startPreload(queuedPreloads.shift()!);
    },
    { once: true },
  );
}

function startPreload(url: string) {
  if (loadedAvatars.has(url) || brokenAvatars.has(url)) return;
  if (inflightPreloads.has(url)) return;
  inflightPreloads.add(url);
  const probe = new Image();
  probe.onload = () => {
    inflightPreloads.delete(url);
    if (loadedAvatars.has(url)) return;
    loadedAvatars.add(url);
    persistAvatarStatus();
    setAvatarTick((n) => n + 1);
  };
  probe.onerror = () => {
    inflightPreloads.delete(url);
    if (brokenAvatars.has(url)) return;
    brokenAvatars.add(url);
    persistAvatarStatus();
    setAvatarTick((n) => n + 1);
  };
  probe.src = url;
}

function preloadAvatar(url: string) {
  if (loadedAvatars.has(url) || brokenAvatars.has(url)) return;
  if (inflightPreloads.has(url) || queuedPreloads.includes(url)) return;
  if (!pageLoaded) {
    queuedPreloads.push(url);
    return;
  }
  startPreload(url);
}

/** Lets a rendered <img>'s onError flag a URL too. */
export function markAvatarBroken(url: string) {
  if (!url || brokenAvatars.has(url)) return;
  brokenAvatars.add(url);
  loadedAvatars.delete(url);
  persistAvatarStatus();
  setAvatarTick((n) => n + 1);
}

/** Reactive avatar src - creature until the picture URL is confirmed loadable. */
export function avatarSrc(pubkey: string): string {
  avatarTick();
  const picture = profiles[pubkey]?.picture;
  if (!picture) return getCreatureAvatar(pubkey);
  if (loadedAvatars.has(picture)) return picture;
  if (brokenAvatars.has(picture)) return getCreatureAvatar(pubkey);
  preloadAvatar(picture);
  return getCreatureAvatar(pubkey);
}

export interface ProfileEdit {
  display_name?: string;
  name?: string;
  handle?: string;
  picture?: string;
  about?: string;
}

/**
 * Publish a kind:0 for the signed-in user. Routes ONLY to the profile relay -
 * NIP-29 groups relays reject kind:0. Merges with existing fields so partial
 * edits don't wipe other values. Local store updates only after relay ack.
 */
export async function publishProfile(signer: Signer, edit: ProfileEdit) {
  const existing = profiles[signer.pubkey];
  const merged: Record<string, string> = {};
  const put = (k: string, v: string | undefined) => { if (v) merged[k] = v; };

  put("display_name", existing?.display_name);
  put("name", existing?.name);
  put("handle", existing?.handle);
  put("picture", existing?.picture);
  put("about", existing?.about);

  if (edit.display_name !== undefined) put("display_name", edit.display_name);
  if (edit.name !== undefined) put("name", edit.name);
  if (edit.handle !== undefined) put("handle", edit.handle);
  if (edit.picture !== undefined) put("picture", edit.picture);
  if (edit.about !== undefined) put("about", edit.about);

  console.log("[profile/sign→]", { pubkey: signer.pubkey.slice(0, 10), merged });

  let event;
  try {
    event = await signer.signEvent({
      kind: 0,
      content: JSON.stringify(merged),
      tags: [],
    });
  } catch (e: any) {
    console.error("[profile/sign✗]", e);
    return { ok: false, message: `sign failed: ${e?.message || e}` };
  }

  console.log("[profile/pub→]", { id: event.id.slice(0, 10), relay: "primal" });
  const result = await relay.publish(event);
  console.log("[profile/pub←]", { ok: result.ok, message: result.message });
  if (!result.ok) return result;

  // Don't spread `edit` - undefined fields would wipe existing picture/about.
  const nextProfile: Profile = {
    name: merged.name,
    display_name: merged.display_name,
    handle: merged.handle,
    picture: merged.picture,
    about: merged.about,
    fetchedAt: Date.now(),
  };
  setProfiles(signer.pubkey, { ...(existing || {}), ...nextProfile });

  // Persist locally - primal's subscription may not echo our replaceable
  // event back immediately, so this is the only reliable persistence path.
  dbPutBatch([[signer.pubkey, nextProfile]]).catch((e) =>
    console.warn("[profile] IDB persist failed:", e),
  );
  localProfiles[signer.pubkey] = nextProfile;
  persistLocalProfiles();

  console.log("[profile/stored]", profiles[signer.pubkey]);

  return result;
}
