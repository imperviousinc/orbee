// Wire layer between main-thread Signer and the worker's signer service.
// Three message types total — request out, terminal response/error in,
// optional intermediate "event" frames in (e.g. "uri" during bunker QR
// pair, or "nip07_sign_required" when the worker needs the page's
// window.nostr to sign).
//
// The reverse-callback for window.nostr access is handled here too, since
// the worker can't reach window.nostr from its own thread.

import { ensureWorker } from "./nostr";

let nextReqId = 0;
function makeReqId(): string {
  return `s${++nextReqId}`;
}

interface Pending {
  resolve: (v: any) => void;
  reject: (e: Error) => void;
  onEvent?: (event: string, data: any) => void;
}

const pending = new Map<string, Pending>();

/** Dispatch a worker-originated signer message. Called from nostr.ts'
 *  central dispatcher; do not call directly. */
export function dispatchSignerMessage(data: any): boolean {
  const t = data?.type;
  if (t === "signer_response") {
    const p = pending.get(data.reqId);
    if (!p) return true;
    pending.delete(data.reqId);
    p.resolve(data.result);
    return true;
  }
  if (t === "signer_error") {
    const p = pending.get(data.reqId);
    if (!p) return true;
    pending.delete(data.reqId);
    p.reject(new Error(data.message || "signer error"));
    return true;
  }
  if (t === "signer_event") {
    const p = pending.get(data.reqId);
    p?.onEvent?.(data.event, data.data);
    return true;
  }
  if (t === "signer_nip07_sign_required") {
    handleNip07SignRequest(data.reqId, data.unsigned);
    return true;
  }
  return false;
}

/** Worker → main: "I need the page's window.nostr to sign this on my
 *  behalf." We do the sign and post the result back keyed on the same
 *  reqId the worker used to address us. */
async function handleNip07SignRequest(reqId: string, unsigned: any): Promise<void> {
  const port = ensureWorker();
  const wn = (window as any).nostr;
  if (!wn) {
    port.postMessage({
      type: "signer_nip07_sign_response",
      reqId,
      error: "NIP-07 extension not available",
    });
    return;
  }
  try {
    const signed = await wn.signEvent({
      kind: unsigned.kind,
      content: unsigned.content,
      tags: unsigned.tags,
      created_at: unsigned.created_at ?? Math.floor(Date.now() / 1000),
    });
    port.postMessage({ type: "signer_nip07_sign_response", reqId, signed });
  } catch (e: any) {
    port.postMessage({
      type: "signer_nip07_sign_response",
      reqId,
      error: String(e?.message || e || "nip07 sign failed"),
    });
  }
}

/** RPC entry. `method` is the signer-service method name; `params` are
 *  method-specific. `onEvent` (optional) receives any intermediate
 *  `signer_event` frames the worker emits before the terminal response.
 *  `abort` (optional) lets a long-running call (only `connect` with the
 *  bunker QR flow today) be cancelled — the worker tears down the pending
 *  pair and rejects the promise. */
export function signerCall<T = any>(
  method: string,
  params: any,
  onEvent?: (event: string, data: any) => void,
  abort?: AbortSignal,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const reqId = makeReqId();
    pending.set(reqId, { resolve, reject, onEvent });
    const port = ensureWorker();
    port.postMessage({ type: "signer_request", reqId, method, params });
    if (abort) {
      abort.addEventListener("abort", () => {
        if (!pending.has(reqId)) return;
        port.postMessage({ type: "signer_abort_pair", reqId });
      }, { once: true });
    }
  });
}
