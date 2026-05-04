import { createSignal } from "solid-js";
import type { NostrEvent } from "./keys";
import { dispatchSignerMessage } from "./signerRpc";

export type NostrFilter = {
  ids?: string[];
  authors?: string[];
  kinds?: number[];
  "#t"?: string[];
  "#e"?: string[];
  "#d"?: string[];
  "#h"?: string[];
  "#p"?: string[];
  since?: number;
  until?: number;
  limit?: number;
};

/** Default NIP-29 relay used when minting / joining new stations and as
 *  the seed for cross-device discovery. Featured stations on other relays
 *  (e.g. groups.0xchat.com for Grimoire/Chachi) still join via their own
 *  relay - this only seeds new entries. */
export const STATIONS_RELAY_URL = "wss://stations.orbee.chat";

let workerPort: MessagePort | null = null;

/** localStorage key for the JSON snapshot from `fabric.saveState()`. */
export const FABRIC_STATE_KEY = "orbee-fabric-state";

export function ensureWorker(): MessagePort {
  if (workerPort) return workerPort;
  const w = new SharedWorker(
    new URL("./relay-pool-worker.ts", import.meta.url),
    { type: "module", name: "orbee-relay-pool-v1" },
  );
  workerPort = w.port;
  w.port.onmessage = (e) => dispatchFromWorker(e.data);
  w.port.start();
  // INVARIANT: fabric_state_init MUST be sent before any fabric_* op so
  // the worker applies it via loadState during fabric construction.
  // postMessage delivery is FIFO.
  const savedState = localStorage.getItem(FABRIC_STATE_KEY);
  if (savedState) {
    w.port.postMessage({ type: "fabric_state_init", state: savedState });
  }
  window.addEventListener("beforeunload", () => {
    w.port.postMessage({ type: "disconnect" });
  });
  return w.port;
}

interface SubMessage { type: "event" | "eose" | "closed"; event?: NostrEvent; reason?: string }
type SubHandler = (msg: SubMessage) => void;
type OkHandler = (msg: { ok: boolean; message: string }) => void;

const subHandlers = new Map<string, SubHandler>();
const okHandlers = new Map<string, OkHandler>();
const connectListeners = new Map<string, Array<() => void>>();
const connectedUrls = new Set<string>();

// Reactive tick: bumped whenever a relay's connection state changes so
// Solid components reading isRelayConnected() re-evaluate. We don't keep
// a per-url signal because lookup is constant-time over a Set anyway.
const [connTick, setConnTick] = createSignal(0);

/** Reactive: is this relay's WebSocket currently up? Components calling
 *  this inside a tracking scope re-render on connect/disconnect. */
export function isRelayConnected(url: string): boolean {
  connTick(); // subscribe
  return connectedUrls.has(url);
}

type FabricHandler = (data: any) => void;
const fabricHandlers: FabricHandler[] = [];
export function onFabricMessage(h: FabricHandler) {
  fabricHandlers.push(h);
}

type FabricStateListener = (reason: string | null) => void;
const fabricStateListeners = new Set<FabricStateListener>();
export function onFabricStateChange(fn: FabricStateListener): () => void {
  fabricStateListeners.add(fn);
  return () => fabricStateListeners.delete(fn);
}

function dispatchFromWorker(data: any) {
  // Signer-service messages (signer_response/error/event + nip07 reverse-
  // call). Routed through signerRpc.ts; if it claims the message we're done.
  if (dispatchSignerMessage(data)) return;
  switch (data.type) {
    case "event":
    case "eose":
    case "closed": {
      const h = subHandlers.get(data.sub);
      if (h) h(data);
      break;
    }
    case "ok": {
      const h = okHandlers.get(data.eventId);
      if (h) {
        okHandlers.delete(data.eventId);
        h({ ok: data.ok, message: data.message });
      }
      break;
    }
    case "connected": {
      connectedUrls.add(data.relay);
      setConnTick((t) => t + 1);
      const listeners = connectListeners.get(data.relay);
      if (listeners) {
        connectListeners.delete(data.relay);
        for (const r of listeners) r();
      }
      break;
    }
    case "disconnected":
      connectedUrls.delete(data.relay);
      setConnTick((t) => t + 1);
      break;
    case "notice":
      console.warn(`[relay] NOTICE:`, data.message);
      break;
    case "worker_log": {
      // Mirror SharedWorker logs into the tab console; __error tag
      // re-hydrates serialized Errors with stack visible.
      const args = (data.args ?? []).map((a: any) =>
        a && typeof a === "object" && a.__error ? `Error: ${a.message}\n${a.stack || ""}` : a,
      );
      const fn = data.level === "error" ? console.error : data.level === "warn" ? console.warn : console.log;
      fn("[worker]", ...args);
      break;
    }
    case "fabric_state_changed":
      if (typeof data.state === "string") {
        try {
          localStorage.setItem(FABRIC_STATE_KEY, data.state);
        } catch (e) {
          console.warn("[fabric/persist] localStorage.setItem failed:", e);
        }
      }
      for (const fn of fabricStateListeners) {
        try { fn(data.reason ?? null); } catch (e) { console.warn("[fabric/listener]", e); }
      }
      break;
    case "fabric_result":
    case "fabric_error":
    case "fabric_publish_result":
    case "fabric_publish_error":
    case "fabric_trust_result":
    case "fabric_trust_error":
    case "fabric_trusted_result":
    case "fabric_trusted_error":
    case "fabric_badges_result":
    case "fabric_badges_error":
      for (const h of fabricHandlers) h(data);
      break;
  }
}

// NIP-42 AUTH used to bounce challenges out to whichever tab held the
// active signer. Now that the signer lives in the worker, AUTH challenges
// are signed in-worker and never reach main thread.

class NostrRelay {
  private subCounter = 0;
  private tabId = Math.random().toString(36).slice(2, 8);

  constructor(public readonly url: string) {}

  get relayUrl(): string { return this.url; }
  get isConnected(): boolean { return connectedUrls.has(this.url); }

  /** Back-compat no-op; the worker owns the signer now and signs AUTH internally. */
  setAuthSigner(_signer: unknown) { /* no-op */ }

  connect(): Promise<void> {
    if (connectedUrls.has(this.url)) return Promise.resolve();
    return new Promise((resolve) => {
      const list = connectListeners.get(this.url) ?? [];
      list.push(resolve);
      connectListeners.set(this.url, list);
      ensureWorker().postMessage({ type: "connect", url: this.url });
      // Safety timeout for the case where the worker's connect ack
      // never arrives. Resolving without ack is safe: nostr-tools
      // queues subs/pubs internally during connect.
      setTimeout(() => {
        const pending = connectListeners.get(this.url);
        const idx = pending?.indexOf(resolve) ?? -1;
        if (pending && idx >= 0) {
          pending.splice(idx, 1);
          console.warn("[relay/connect] no ack within 5s; proceeding without it", { relay: this.url });
          resolve();
        }
      }, 5000);
    });
  }

  subscribe(
    filter: NostrFilter,
    onEvent: (event: NostrEvent) => void,
    onEose?: () => void,
    onClosed?: (reason: string) => void,
  ): string {
    const sub = `${this.tabId}_s${++this.subCounter}`;
    console.log("[relay/sub→]", {
      relay: this.url,
      sub,
      kinds: filter.kinds,
      authors: filter.authors?.length ? `${filter.authors.length} authors (e.g. ${filter.authors[0]?.slice(0, 8)})` : undefined,
      filter,
    });
    subHandlers.set(sub, (msg) => {
      if (msg.type === "event" && msg.event) {
        console.log("[relay/event]", {
          relay: this.url,
          sub,
          kind: msg.event.kind,
          id: msg.event.id.slice(0, 10),
          h: msg.event.tags.find((t: string[]) => t[0] === "h")?.[1],
        });
        onEvent(msg.event);
      } else if (msg.type === "eose") {
        console.log("[relay/eose]", { relay: this.url, sub });
        onEose?.();
      } else if (msg.type === "closed") {
        console.warn("[relay/closed]", { relay: this.url, sub, reason: msg.reason });
        onClosed?.(msg.reason ?? "");
      }
    });
    ensureWorker().postMessage({ type: "subscribe", sub, relay: this.url, filter });
    return sub;
  }

  unsubscribe(sub: string) {
    ensureWorker().postMessage({ type: "unsubscribe", sub });
    subHandlers.delete(sub);
  }

  publish(event: NostrEvent): Promise<{ ok: boolean; message: string }> {
    console.log("[relay/pub→]", {
      relay: this.url,
      id: event.id.slice(0, 10),
      kind: event.kind,
      pubkey: event.pubkey.slice(0, 10),
      tags: event.tags,
    });
    return new Promise((resolve) => {
      const timeout = window.setTimeout(() => {
        okHandlers.delete(event.id);
        console.warn("[relay/pub✗]", { relay: this.url, id: event.id.slice(0, 10), reason: "timeout" });
        resolve({ ok: false, message: "timeout" });
      }, 10_000);

      okHandlers.set(event.id, (msg) => {
        window.clearTimeout(timeout);
        console.log("[relay/pub←]", {
          relay: this.url,
          id: event.id.slice(0, 10),
          ok: msg.ok,
          message: msg.message,
        });
        resolve(msg);
      });

      ensureWorker().postMessage({ type: "publish", relay: this.url, event });
    });
  }

  disconnect() {
    /* no-op - shared worker owns connection lifecycle */
  }
}

const relayCache = new Map<string, NostrRelay>();

/** Get (or lazily create) the NostrRelay facade for a given URL. */
export function getRelay(url: string): NostrRelay {
  let r = relayCache.get(url);
  if (!r) {
    r = new NostrRelay(url);
    relayCache.set(url, r);
  }
  return r;
}

/**
 * URL-less facade for kind:0 profiles and kind:30078 station configs.
 * Worker owns the relay list (PROFILE_RELAYS in relay-pool-worker.ts)
 * and fans out via SimplePool.
 */
class ProfileRelay {
  private subCounter = 0;
  private tabId = Math.random().toString(36).slice(2, 8);

  connect(): Promise<void> { return Promise.resolve(); }

  setAuthSigner(_signer: unknown) { /* no-op */ }

  subscribe(
    filter: NostrFilter,
    onEvent: (event: NostrEvent) => void,
    onEose?: () => void,
    onClosed?: (reason: string) => void,
  ): string {
    const sub = `${this.tabId}_p${++this.subCounter}`;
    console.log("[profile/sub→]", {
      sub,
      kinds: filter.kinds,
      authors: filter.authors?.length ? `${filter.authors.length} authors (e.g. ${filter.authors[0]?.slice(0, 8)})` : undefined,
      filter,
    });
    subHandlers.set(sub, (msg) => {
      if (msg.type === "event" && msg.event) {
        onEvent(msg.event);
      } else if (msg.type === "eose") {
        onEose?.();
      } else if (msg.type === "closed") {
        onClosed?.(msg.reason ?? "");
      }
    });
    ensureWorker().postMessage({ type: "profile_subscribe", sub, filter });
    return sub;
  }

  unsubscribe(sub: string) {
    ensureWorker().postMessage({ type: "unsubscribe", sub });
    subHandlers.delete(sub);
  }

  publish(event: NostrEvent): Promise<{ ok: boolean; message: string }> {
    console.log("[profile/pub→]", {
      id: event.id.slice(0, 10),
      kind: event.kind,
      pubkey: event.pubkey.slice(0, 10),
    });
    return new Promise((resolve) => {
      const timeout = window.setTimeout(() => {
        okHandlers.delete(event.id);
        resolve({ ok: false, message: "timeout" });
      }, 10_000);
      okHandlers.set(event.id, (msg) => {
        window.clearTimeout(timeout);
        resolve(msg);
      });
      ensureWorker().postMessage({ type: "profile_publish", event });
    });
  }

  disconnect() { /* no-op */ }
}

export const profileRelay = new ProfileRelay();
export const relay = getRelay(STATIONS_RELAY_URL);
