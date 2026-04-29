/**
 * SharedWorker hosting all relay connections (profile pool + per-group
 * NIP-29 pools) plus the Fabric (Spaces) WASM instance.
 *
 * NIP-42 AUTH: keys live in tabs, not the worker. We broadcast the
 * challenge to ports and resolve with the first signed response.
 */

import { SimplePool } from "nostr-tools/pool";
import type { Event, EventTemplate, Filter, VerifiedEvent } from "nostr-tools";
import { Fabric, init as initFabric, RecordSet } from "@spacesprotocol/fabric-web";
import type { Fabric as FabricInstance } from "@spacesprotocol/fabric-web";
// Side-effect import: registers BIP-340 Schnorr signer with fabric-core.
// Without this, fab.publish() throws "signing not loaded".
import "@spacesprotocol/fabric-web/signing";

// SharedWorker logs land in the worker's own DevTools, not in any tab.
// Mirror console.{log,warn,error} to all connected ports as worker_log
// messages; nostr.ts re-logs with a [worker] prefix.
const _origLog = console.log.bind(console);
const _origWarn = console.warn.bind(console);
const _origErr = console.error.bind(console);
function safeArg(a: unknown): unknown {
  try {
    if (a instanceof Error) return { __error: true, message: a.message, stack: a.stack };
    if (typeof a === "function" || typeof a === "symbol") return "<unserializable>";
    structuredClone(a);
    return a;
  } catch { return String(a); }
}
function broadcastLog(level: "log" | "warn" | "error", args: unknown[]) {
  const safe = args.map(safeArg);
  for (const p of ports) {
    try { p.postMessage({ type: "worker_log", level, args: safe }); } catch {}
  }
}
console.log = (...a: unknown[]) => { _origLog(...a); broadcastLog("log", a); };
console.warn = (...a: unknown[]) => { _origWarn(...a); broadcastLog("warn", a); };
console.error = (...a: unknown[]) => { _origErr(...a); broadcastLog("error", a); };

// Dedicated kind:0 + 10002 indexer relays. SimplePool dedupes across them.
const PROFILE_RELAYS = [
  "wss://purplepag.es",
  "wss://user.kindpag.es",
  "wss://relay.nos.social",
];

type AuthPending = {
  resolve: (e: VerifiedEvent) => void;
  reject: (e: unknown) => void;
};
const pendingAuth = new Map<string, AuthPending>();
let authSeq = 0;

const authSigner = (url: string) => (evt: EventTemplate): Promise<VerifiedEvent> => {
  return new Promise((resolve, reject) => {
    const authId = `a${++authSeq}`;
    pendingAuth.set(authId, { resolve, reject });
    broadcast({ type: "auth_required", authId, relay: url, template: evt });
    setTimeout(() => {
      if (pendingAuth.delete(authId)) {
        reject(new Error("AUTH signer timeout"));
      }
    }, 30_000);
  });
};

// Tracks relays known-connected at the worker level so a tab joining
// after the pool's onRelayConnectionSuccess fired still gets ack'd.
const connectedRelays = new Set<string>();

function makePool(): SimplePool {
  const pool = new SimplePool({ enableReconnect: true });
  pool.automaticallyAuth = authSigner;
  pool.onRelayConnectionSuccess = (url: string) => {
    connectedRelays.add(url);
    broadcast({ type: "connected", relay: url });
  };
  pool.onRelayConnectionFailure = (url: string) => {
    connectedRelays.delete(url);
    broadcast({ type: "disconnected", relay: url });
  };
  return pool;
}

const profilePool = makePool();
const groupPools = new Map<string, SimplePool>();

function getPool(url: string): SimplePool {
  if (PROFILE_RELAYS.includes(url)) return profilePool;
  let p = groupPools.get(url);
  if (!p) {
    p = makePool();
    groupPools.set(url, p);
  }
  return p;
}

const ports = new Set<MessagePort>();
function broadcast(msg: unknown) {
  for (const p of ports) p.postMessage(msg);
}

interface SubHandle {
  close: () => void;
  port: MessagePort;
}
const subs = new Map<string, SubHandle>();

function doSubscribe(port: MessagePort, subId: string, url: string, filter: Filter) {
  const pool = getPool(url);
  const sub = pool.subscribeMany([url], filter, {
    onevent: (event: Event) => {
      port.postMessage({ type: "event", sub: subId, event });
    },
    oneose: () => {
      port.postMessage({ type: "eose", sub: subId });
    },
    onclose: (reasons: string[]) => {
      port.postMessage({ type: "closed", sub: subId, reason: reasons.join("; ") });
    },
  });
  subs.set(subId, { close: () => sub.close(), port });
}

/** Subscribe across all PROFILE_RELAYS; SimplePool dedupes events and aggregates EOSE. */
function doProfileSubscribe(port: MessagePort, subId: string, filter: Filter) {
  const sub = profilePool.subscribeMany(PROFILE_RELAYS, filter, {
    onevent: (event: Event) => {
      port.postMessage({ type: "event", sub: subId, event });
    },
    oneose: () => {
      port.postMessage({ type: "eose", sub: subId });
    },
    onclose: (reasons: string[]) => {
      port.postMessage({ type: "closed", sub: subId, reason: reasons.join("; ") });
    },
  });
  subs.set(subId, { close: () => sub.close(), port });
}

function doUnsubscribe(subId: string) {
  const sub = subs.get(subId);
  if (!sub) return;
  sub.close();
  subs.delete(subId);
}

async function doPublish(port: MessagePort, url: string, event: Event) {
  const pool = getPool(url);
  try {
    const promises = pool.publish([url], event);
    const settled = await Promise.allSettled(promises);
    const first = settled[0];
    if (first?.status === "fulfilled") {
      port.postMessage({ type: "ok", eventId: event.id, ok: true, message: first.value || "" });
    } else {
      const reason = first?.status === "rejected" ? first.reason : new Error("no relay");
      port.postMessage({
        type: "ok",
        eventId: event.id,
        ok: false,
        message: String(reason?.message || reason || "rejected"),
      });
    }
  } catch (e: any) {
    port.postMessage({
      type: "ok",
      eventId: event.id,
      ok: false,
      message: String(e?.message || e || "error"),
    });
  }
}

/** Publish to all PROFILE_RELAYS; ok if any accepts. */
async function doProfilePublish(port: MessagePort, event: Event) {
  try {
    const promises = profilePool.publish(PROFILE_RELAYS, event);
    const settled = await Promise.allSettled(promises);
    const accepted = settled.find((s) => s.status === "fulfilled");
    if (accepted && accepted.status === "fulfilled") {
      port.postMessage({ type: "ok", eventId: event.id, ok: true, message: accepted.value || "" });
      return;
    }
    const lastErr = settled[settled.length - 1];
    const reason = lastErr?.status === "rejected" ? lastErr.reason : new Error("no relay");
    port.postMessage({
      type: "ok",
      eventId: event.id,
      ok: false,
      message: String(reason?.message || reason || "rejected"),
    });
  } catch (e: any) {
    port.postMessage({
      type: "ok",
      eventId: event.id,
      ok: false,
      message: String(e?.message || e || "error"),
    });
  }
}

let fabricLoading: Promise<FabricInstance> | null = null;

// MUST be stashed before getFabric() runs - the first getFabric() call
// reads this and feeds it to loadState() at construction time.
let pendingFabricState: string | null = null;

function getFabric(): Promise<FabricInstance> {
  if (!fabricLoading) {
    fabricLoading = (async () => {
      await initFabric();
      const fab = new Fabric();
      if (pendingFabricState) {
        try {
          fab.loadState(pendingFabricState);
          console.log("[worker/fabric] state restored from saved JSON, trusted:", fab.trusted());
        } catch (e) {
          console.warn("[worker/fabric] loadState failed; continuing with empty state:", e);
        }
      }
      return fab;
    })().catch((e) => {
      fabricLoading = null;
      throw e;
    });
  }
  return fabricLoading;
}

/** Snapshot fabric state and broadcast to tabs for localStorage persistence. */
async function persistFabricState(reason: string): Promise<void> {
  try {
    const fab = await getFabric();
    const state = fab.saveState();
    broadcast({ type: "fabric_state_changed", state, reason });
  } catch (e) {
    console.warn("[worker/fabric] persistFabricState failed:", e);
  }
}

// Fabric 0.2 zones are WASM-backed and don't survive postMessage, so
// keep the live zone object here keyed by handle for badge() lookups.
const zonesByHandle = new Map<string, any>();

async function doFabricResolveAll(port: MessagePort, reqId: string, handles: string[]) {
  try {
    const fabric = await getFabric();
    const zones = (await fabric.resolveAll(handles)) ?? [];
    for (const z of zones) {
      if (z?.handle) zonesByHandle.set(z.handle.toLowerCase(), z);
    }
    const serialized = zones.map((z: any) => {
      const j = z.toJson();
      return { handle: z.handle, json: j };
    });
    console.log("[worker/resolveAll]", {
      handles,
      zoneCount: serialized.length,
      sample: serialized[0]
        ? { handle: serialized[0].handle, jsonKeys: Object.keys(serialized[0].json || {}), jsonSample: serialized[0].json }
        : null,
    });
    port.postMessage({ type: "fabric_result", reqId, zones: serialized });
  } catch (e: any) {
    console.warn("[worker/resolveAll] failed:", e);
    port.postMessage({ type: "fabric_error", reqId, message: String(e?.message || e || "fabric failed") });
  }
}

async function doFabricTrust(port: MessagePort, reqId: string, trustId: string) {
  console.log("[worker/trust]", { reqId, trustId: trustId.slice(0, 16) });
  try {
    const fabric = await getFabric();
    console.log("[worker/trust] fabric ready, calling fabric.trust…");
    await fabric.trust(trustId);
    console.log("[worker/trust] fabric.trust resolved, posting result");
    port.postMessage({ type: "fabric_trust_result", reqId });
    await persistFabricState("trust");
  } catch (e: any) {
    console.warn("[worker/trust] fabric.trust threw:", e);
    port.postMessage({
      type: "fabric_trust_error",
      reqId,
      message: String(e?.message || e || "trust failed"),
    });
  }
}

// Fabric 0.2: badge() takes the zone object; cache miss falls through
// to fabric.resolve(handle), which hits fabric's internal cache.
async function doFabricBadgesFor(
  port: MessagePort,
  reqId: string,
  handles: string[],
) {
  try {
    const fabric = await getFabric();
    const badges: string[] = [];
    const debug: any[] = [];
    for (const h of handles) {
      const key = h.toLowerCase();
      let zone = zonesByHandle.get(key);
      if (!zone) {
        try {
          zone = await fabric.resolve(h);
          if (zone) zonesByHandle.set(key, zone);
        } catch (resolveErr: any) {
          console.warn("[worker/badges] resolve threw for", h, "-", resolveErr?.stack || resolveErr);
          throw resolveErr;
        }
      }
      try {
        const badge = zone ? fabric.badge(zone) : "none";
        badges.push(badge);
        if (zone) {
          const j = zone.toJson?.();
          debug.push({
            handle: h,
            badge,
            anchor_hash: j?.anchor_hash,
            sovereignty: j?.sovereignty,
            num_id: j?.num_id,
          });
        } else {
          debug.push({ handle: h, badge, zone: null });
        }
      } catch (badgeErr: any) {
        console.warn("[worker/badges] badge threw for", h, "-", badgeErr?.stack || badgeErr);
        throw badgeErr;
      }
    }
    console.log("[worker/badges]", {
      trustedId: fabric.trusted(),
      semiTrustedId: fabric.semiTrusted(),
      observedId: fabric.observed(),
      detail: debug,
    });
    port.postMessage({ type: "fabric_badges_result", reqId, badges });
  } catch (e: any) {
    console.warn("[worker/badges] failed:", e?.stack || e);
    port.postMessage({
      type: "fabric_badges_error",
      reqId,
      message: String(e?.stack || e?.message || e || "badges failed"),
    });
  }
}

async function doFabricSemiTrust(port: MessagePort, reqId: string, trustId: string) {
  console.log("[worker/semiTrust]", { reqId, trustId: trustId.slice(0, 16) });
  try {
    const fabric = await getFabric();
    await fabric.semiTrust(trustId);
    console.log("[worker/semiTrust] fabric.semiTrust resolved");
    port.postMessage({ type: "fabric_trust_result", reqId });
    await persistFabricState("semiTrust");
  } catch (e: any) {
    console.warn("[worker/semiTrust] fabric.semiTrust threw:", e);
    port.postMessage({
      type: "fabric_trust_error",
      reqId,
      message: String(e?.message || e || "semi-trust failed"),
    });
  }
}

async function doFabricClearTrusted(port: MessagePort, reqId: string) {
  console.log("[worker/clearTrust]", { reqId });
  try {
    const fabric = await getFabric();
    fabric.clearTrusted();
    port.postMessage({ type: "fabric_trust_result", reqId });
    await persistFabricState("clearTrust");
  } catch (e: any) {
    console.warn("[worker/clearTrust] threw:", e);
    port.postMessage({
      type: "fabric_trust_error",
      reqId,
      message: String(e?.message || e || "clear failed"),
    });
  }
}

async function doFabricGetTrusted(port: MessagePort, reqId: string) {
  try {
    const fabric = await getFabric();
    port.postMessage({
      type: "fabric_trusted_result",
      reqId,
      trusted: fabric.trusted(),
      observed: fabric.observed(),
      semiTrusted: fabric.semiTrusted(),
    });
  } catch (e: any) {
    port.postMessage({
      type: "fabric_trusted_error",
      reqId,
      message: String(e?.message || e || "trusted query failed"),
    });
  }
}

/**
 * Publish a zone. cert is raw .spacecert bytes; records is JSON form
 * accepted by RecordSet.pack; secretKey is 64-char hex (or Uint8Array).
 */
async function doFabricPublish(
  port: MessagePort,
  reqId: string,
  cert: Uint8Array,
  records: any,
  secretKey: string | Uint8Array,
) {
  try {
    const fabric = await getFabric();
    const recordSet = RecordSet.pack(records);
    await fabric.publish({ cert, records: recordSet, secretKey });
    port.postMessage({ type: "fabric_publish_result", reqId });
  } catch (e: any) {
    port.postMessage({
      type: "fabric_publish_error",
      reqId,
      message: String(e?.message || e || "publish failed"),
    });
  }
}

function handleMessage(port: MessagePort, data: any) {
  switch (data.type) {
    case "subscribe":
      doSubscribe(port, data.sub, data.relay, data.filter);
      break;
    case "profile_subscribe":
      doProfileSubscribe(port, data.sub, data.filter);
      break;
    case "unsubscribe":
      doUnsubscribe(data.sub);
      break;
    case "publish":
      doPublish(port, data.relay, data.event);
      break;
    case "profile_publish":
      doProfilePublish(port, data.event);
      break;
    case "auth_response": {
      const pending = pendingAuth.get(data.authId);
      if (!pending) return;
      pendingAuth.delete(data.authId);
      pending.resolve(data.event as VerifiedEvent);
      break;
    }
    case "auth_error": {
      const pending = pendingAuth.get(data.authId);
      if (!pending) return;
      pendingAuth.delete(data.authId);
      pending.reject(new Error(data.message || "auth failed"));
      break;
    }
    case "connect": {
      // onRelayConnectionSuccess fires once per pool-level connect, not
      // per tab; ack THIS port via ensureRelay's per-call resolution
      // so late joiners don't wait on the safety timeout.
      if (connectedRelays.has(data.url)) {
        port.postMessage({ type: "connected", relay: data.url });
        break;
      }
      getPool(data.url).ensureRelay(data.url)
        .then(() => port.postMessage({ type: "connected", relay: data.url }))
        .catch(() => { /* tab's connect() promise has its own safety net */ });
      break;
    }
    case "disconnect":
      removePort(port);
      break;
    case "fabric_state_init":
      // MUST stash before getFabric() ever runs - see pendingFabricState.
      if (typeof data.state === "string" && data.state.length > 0 && !fabricLoading) {
        pendingFabricState = data.state;
        console.log("[worker/fabric] received persisted state from tab", { length: data.state.length });
      }
      break;
    case "fabric_preload":
      getFabric().catch(() => { /* errors reported on real resolve */ });
      break;
    case "fabric_resolve_all":
      doFabricResolveAll(port, data.reqId, data.handles);
      break;
    case "fabric_publish":
      doFabricPublish(port, data.reqId, data.cert, data.records, data.secretKey);
      break;
    case "fabric_trust":
      doFabricTrust(port, data.reqId, data.trustId);
      break;
    case "fabric_semi_trust":
      doFabricSemiTrust(port, data.reqId, data.trustId);
      break;
    case "fabric_clear_trusted":
      doFabricClearTrusted(port, data.reqId);
      break;
    case "fabric_get_trusted":
      doFabricGetTrusted(port, data.reqId);
      break;
    case "fabric_badges_for":
      doFabricBadgesFor(port, data.reqId, data.handles);
      break;
  }
}

function removePort(port: MessagePort) {
  for (const [subId, handle] of subs) {
    if (handle.port === port) {
      handle.close();
      subs.delete(subId);
    }
  }
  ports.delete(port);
}

const sw = self as unknown as SharedWorkerGlobalScope;
sw.onconnect = (e: MessageEvent) => {
  const port = e.ports[0];
  ports.add(port);
  port.onmessage = (ev: MessageEvent) => handleMessage(port, ev.data);
  port.start();
};
