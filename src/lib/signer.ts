// Single typed wrapper for the signer service that lives in the SharedWorker.
// Every signer type — local key, NIP-07 extension, NIP-46 bunker — flows
// through one generic `signerCall` RPC. This file has zero protocol details:
// no nostr-tools/nip46 imports, no SimplePool, no window.nostr access.
// All of that lives in the worker. Main-thread consumers see one shape.
//
//   const signer = await Signer.connect({ type: "local",  privkey });
//   const signer = await Signer.connect({ type: "nip07",  pubkey });
//   const signer = await Signer.connect({ type: "bunker", via: "qr",      relays }, onEvent);
//   const signer = await Signer.connect({ type: "bunker", via: "uri",     url });
//   const signer = await Signer.connect({ type: "bunker", via: "session", session });
//
//   await signer.signEvent({ kind: 1, content: "...", tags: [] });
//   if (signer.hasLocalKey) { const nsec = await signer.exportNsec(); ... }

import { hexToBytes, privkeyToNsec, type NostrEvent } from "./keys";
import { signerCall } from "./signerRpc";

/** Fields a caller supplies; the signer fills in pubkey / id / sig / created_at. */
export interface UnsignedEvent {
  kind: number;
  content: string;
  tags: string[][];
  /** Optional - signer uses `Math.floor(Date.now()/1000)` if absent. */
  created_at?: number;
}

/** Persistable state needed to resume a NIP-46 bunker session after reload.
 *  `clientSk` is an ephemeral keypair private key; secret is the URI's
 *  shared secret (or null if the signer doesn't use one). */
export interface BunkerSession {
  clientSk: Uint8Array;
  signerPubkey: string;
  relays: string[];
  secret: string | null;
}

/** Discriminated union covering every way a signer can be set up.
 *  - `local`:  caller already has the privkey (fresh-mint, nsec import, or restore-from-storage)
 *  - `nip07`:  attaching to an existing browser-extension signer (window.nostr)
 *  - `bunker`: NIP-46 remote signer, sub-discriminated by how the connection is acquired */
export type SignerSetup =
  | { type: "local";  privkey: Uint8Array }
  | { type: "nip07";  pubkey:  string }
  | { type: "bunker"; via: "qr";      relays: string[]; name?: string; url?: string; image?: string }
  | { type: "bunker"; via: "uri";     url: string }
  | { type: "bunker"; via: "session"; session: BunkerSession };

/** Streamed event from the worker during a connect. The only event we
 *  currently emit is `"uri"` during a bunker QR pair, carrying the
 *  nostrconnect:// URI to display as a QR code. */
export type ConnectEvent =
  | { event: "uri"; data: { uri: string } };

interface ConnectResult {
  pubkey: string;
  /** Present iff the underlying signer is a bunker — needed for persistence. */
  session?: BunkerSession;
  /** True iff the signer can produce a raw nsec (i.e. it's a local key).
   *  Used by Backup UI to gate the recovery-key reveal. */
  hasLocalKey: boolean;
}

export class Signer {
  constructor(
    public readonly pubkey: string,
    /** Bunker-only; absent for local/nip07. Caller persists this on first
     *  connect, then passes back via { type: "bunker", via: "session" }. */
    public readonly session: BunkerSession | undefined,
    public readonly hasLocalKey: boolean,
  ) {}

  signEvent(unsigned: UnsignedEvent): Promise<NostrEvent> {
    return signerCall<NostrEvent>("sign_event", { unsigned });
  }

  close(): Promise<void> {
    return signerCall<void>("close", {});
  }

  /** Returns the active local signer's nsec for backup display. Rejects if
   *  the active signer isn't a local key (gate UI on `hasLocalKey`). The
   *  worker hands back raw hex and we bech32-encode here so the privkey
   *  bytes never sit on the wire as a recognizable nsec string. */
  async exportNsec(): Promise<string> {
    const hex = await signerCall<string>("export_nsec", {});
    return privkeyToNsec(hexToBytes(hex));
  }

  /** Sets up a signer in the worker and returns a typed handle. For
   *  `bunker` + `via: "qr"`, the optional `onEvent` callback receives the
   *  generated nostrconnect URI as soon as the worker builds it (before
   *  the signer pairs); use it to render the QR. */
  static async connect(
    setup: SignerSetup,
    onEvent?: (e: ConnectEvent) => void,
    abort?: AbortSignal,
  ): Promise<Signer> {
    const r = await signerCall<ConnectResult>(
      "connect",
      setup,
      (event, data) => onEvent?.({ event, data } as ConnectEvent),
      abort,
    );
    return new Signer(r.pubkey, r.session, r.hasLocalKey);
  }
}

/** Quick sync check used by SignIn UI to show/hide the NIP-07 button. */
export function hasNip07(): boolean {
  return typeof window !== "undefined" && !!(window as any).nostr;
}
