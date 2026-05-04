import { createSignal, Show, For, onMount, onCleanup, createEffect, on } from "solid-js";
import albyLogo from "../assets/signers/alby.png";
import nos2xLogo from "../assets/signers/nos2x.png";
import amberLogo from "../assets/signers/amber.png";
import {
  decodeNsec,
  saveLocalAuth,
  saveNip07Auth,
  saveBunkerAuth,
  setBackupPending,
  bytesToHex,
} from "../lib/keys";
import { randomBytes } from "../lib/crypto";
import { Signer, hasNip07 } from "../lib/signer";
import { publishProfile } from "../lib/profiles";
import { profileRelay } from "../lib/nostr";
import type { AuthState } from "../lib/auth";

import SpacesLogo from "./SpacesLogo";
import type { OrbeeExpressionName } from "../lib/orbeeExpressions";
import { typewriter } from "../lib/typewriter.js";
import { preloadFabric } from "../lib/fabric";
import QRCode from "./QRCode";

// Relays the BunkerSigner listens on for the signer's connect response
// after the user scans the nostrconnect:// QR. relay.damus.io was dropped
// because the WS dial fails (it filters kind 24133).
const NOSTRCONNECT_RELAYS = [
  "wss://relay.nsec.app",
  "wss://relay.primal.net",
];

const EXTENSION_SIGNERS = [
  {
    name: "Alby",
    logo: albyLogo,
    url: "https://chromewebstore.google.com/detail/alby-bitcoin-wallet-for-l/iokeahhehimjnekafflcihljlcjccdbe",
  },
  {
    name: "nos2x",
    logo: nos2xLogo,
    url: "https://chromewebstore.google.com/detail/nos2x/kpgefcfmnafjgpblomihpgmejjdanjjp",
  },
];

const REMOTE_SIGNERS = [
  {
    name: "Amber",
    logo: amberLogo,
    platform: "Android",
    url: "https://zapstore.dev/apps/naddr1qvzqqqr7pvpzqateqake4lc2fn77lflzq30jfpk8uhvtccalc66989er8cdmljceqqdkxmmd9enhyet9deshyaphvvejumn0wd68yumfvahx2usx8zmj2",
  },
];

type Mode = "entry" | "options" | "newUser" | "installSigner" | "bunker";

/** Parse `#nsec1...` from URL fragment and scrub it. Fragment never hits the server. */
function parseUrlAuth(): string | null {
  const fragment = window.location.hash;
  if (!fragment.startsWith("#nsec")) return null;
  history.replaceState(null, "", window.location.pathname);
  return fragment.slice(1);
}

export default function SignIn(props: { onAuth: (auth: AuthState) => void }) {
  const [nsec, setNsec] = createSignal("");
  const [error, setError] = createSignal("");
  const [busy, setBusy] = createSignal(false);
  const [mode, setMode] = createSignal<Mode>("entry");
  // Display name a brand-new user types in the "I'm new here" view; gets
  // published as kind:0 display_name right after fastMint so the rest of
  // the app has something better than a truncated npub to show. Only
  // collected for fresh-key minting - existing-key paths (nsec import,
  // NIP-07, bunker) already have a profile.
  const [signupName, setSignupName] = createSignal("");
  let nsecInputEl: HTMLInputElement | undefined;

  // Delay focus until after view crossfade (220ms) settles to avoid focus-ring flicker.
  createEffect(on(mode, () => {
    if (mode() === "options" && nsecInputEl) {
      const f = window.setTimeout(() => nsecInputEl?.focus({ preventScroll: true }), 220);
      onCleanup(() => window.clearTimeout(f));
    }
  }, { defer: true }));

  const [errorActive, setErrorActive] = createSignal(false);
  createEffect(on(error, () => {
    if (!error()) return;
    setErrorActive(true);
    const t = window.setTimeout(() => setErrorActive(false), 1000);
    onCleanup(() => window.clearTimeout(t));
  }, { defer: true }));

  const [hovered, setHovered] = createSignal<"mint" | "signer" | "extension" | null>(null);

  // Priority: error > busy > hover > bunker > mode default.
  const expression = (): OrbeeExpressionName => {
    if (errorActive()) return "error";
    if (busy()) return "thinking";
    if (hovered() === "mint") return "pirateHat";
    if (hovered() === "signer") {
      return mode() === "options" ? "glasses" : "pirateCool";
    }
    if (hovered() === "extension") return "glasses";
    if (mode() === "bunker") return "glasses";
    if (mode() === "newUser") return "pirateHat";
    if (mode() === "installSigner") return "pirateCool";
    if (mode() === "options") return "pokerFace";
    return "idle";
  };

  const [bunkerTab, setBunkerTab] = createSignal<"bunker" | "qr">("qr");
  const [bunkerUri, setBunkerUri] = createSignal("");
  const [bunkerPaste, setBunkerPaste] = createSignal("");
  const [bunkerStatus, setBunkerStatus] = createSignal("");
  const [bunkerError, setBunkerError] = createSignal("");
  const [copied, setCopied] = createSignal(false);
  let bunkerAbort: AbortController | null = null;
  let qrStarted = false;

  const urlNsec = parseUrlAuth();
  if (urlNsec) {
    onMount(() => trySignIn(urlNsec));
  }

  // Warm Fabric WASM (~2.8MB) on the SharedWorker so it's ready by sign-in completion.
  onMount(() => preloadFabric());

  onCleanup(() => bunkerAbort?.abort());

  async function trySignIn(input: string): Promise<boolean> {
    const privkey = decodeNsec(input);
    if (!privkey) {
      setError("That doesn't look like an nsec. Your secret key starts with nsec1.");
      return false;
    }
    saveLocalAuth("", privkey);
    const signer = await Signer.connect({ type: "local", privkey });
    props.onAuth({ handle: "", signer });
    return true;
  }

  async function submit() {
    setError("");
    setBusy(true);
    try {
      await trySignIn(nsec().trim());
    } finally {
      setBusy(false);
    }
  }

  // NIP-07 browser extension sign-in.
  async function signInWithExtension() {
    setError("");
    setBusy(true);
    try {
      const wn = (window as any).nostr;
      if (!wn) throw new Error("NIP-07 extension not found");
      const pubkey = await wn.getPublicKey();
      saveNip07Auth(pubkey);
      const signer = await Signer.connect({ type: "nip07", pubkey });
      props.onAuth({ handle: "", signer });
    } catch (e: any) {
      setError(e?.message || "Extension sign-in failed.");
    } finally {
      setBusy(false);
    }
  }

  // Mint a fresh key, publish the user's display name as kind:0, and
  // flag backup-pending so the nag banner appears until they save the nsec.
  async function fastMint() {
    setError("");
    setBusy(true);
    try {
      const privkey = randomBytes(32);
      saveLocalAuth("", privkey);
      const signer = await Signer.connect({ type: "local", privkey });
      setBackupPending(signer.pubkey);
      // Publish kind:0 with the chosen display name before transitioning
      // to the next step. Best-effort: if the profile relay rejects or
      // the user typed nothing, we just proceed - their handle claim
      // and any later edits via ProfileEditor will publish kind:0
      // correctly. No await blocking the UI on a relay round-trip.
      const name = signupName().trim();
      if (name) {
        profileRelay.connect();
        publishProfile(signer, { display_name: name }).catch((e) =>
          console.warn("[signup] display_name publish failed:", e),
        );
      }
      props.onAuth({ handle: "", signer });
    } catch (e: any) {
      setError(e?.message || "Couldn't mint a fresh key.");
    } finally {
      setBusy(false);
    }
  }

  function openBunker() {
    setBunkerError("");
    setBunkerPaste("");
    setCopied(false);
    qrStarted = false;
    setMode("bunker");
    switchBunkerTab("qr");
  }

  function switchBunkerTab(tab: "bunker" | "qr") {
    setBunkerTab(tab);
    setBunkerError("");
    if (tab !== "qr" || qrStarted) return;

    qrStarted = true;
    bunkerAbort = new AbortController();
    // Use the live origin so localhost dev and production each surface
    // their own URL/icon in the signer's approval prompt. icon-192.png
    // ships in public/ and is served at the site root.
    const origin = window.location.origin;
    Signer.connect(
      {
        type: "bunker",
        via: "qr",
        relays: NOSTRCONNECT_RELAYS,
        name: "Orbee",
        url: origin,
        image: `${origin}/icon-192.png`,
      },
      (e) => {
        if (e.event === "uri") setBunkerUri(e.data.uri);
      },
      bunkerAbort.signal,
    )
      .then((signer) => persistAndFinish(signer))
      .catch((e: any) => {
        if (bunkerAbort?.signal.aborted) return;
        setBunkerError(e?.message || "Signer never responded.");
      });
  }

  function cancelBunker() {
    bunkerAbort?.abort();
    bunkerAbort = null;
    qrStarted = false;
    setBunkerUri("");
    setBunkerPaste("");
    setBunkerStatus("");
    setBunkerError("");
    setMode("options");
  }

  async function connectPastedBunker() {
    const raw = bunkerPaste().trim();
    if (!raw) {
      setBunkerError("Paste a bunker:// URL first.");
      return;
    }
    setBunkerError("");
    setBunkerStatus("Connecting…");
    try {
      const signer = await Signer.connect({ type: "bunker", via: "uri", url: raw });
      persistAndFinish(signer);
    } catch (e: any) {
      setBunkerError(e?.message || "Couldn't connect to that bunker.");
      setBunkerStatus("");
    }
  }

  async function copyBunkerUri() {
    const uri = bunkerUri();
    if (!uri) return;
    try {
      await navigator.clipboard.writeText(uri);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setBunkerError("Couldn't copy to clipboard");
    }
  }

  function persistAndFinish(signer: Signer) {
    if (!signer.session) {
      // The bunker entry paths always populate session; this is a typing
      // safeguard for the non-bunker fall-through (which never reaches here).
      throw new Error("bunker signer is missing session state");
    }
    saveBunkerAuth({
      clientSkHex: bytesToHex(signer.session.clientSk),
      signerPubkey: signer.session.signerPubkey,
      relays: signer.session.relays,
      secret: signer.session.secret,
      userPubkey: signer.pubkey,
    });
    props.onAuth({ handle: "", signer });
  }

  return (
    <div class="signin-backdrop">
      <div class="signin-card">
        <div class="signin-header">
          <div class="signin-mascot">
            <SpacesLogo size={120} expression={expression()} />
          </div>
          <div class="signin-header-slot">
            <Show
              when={error() || bunkerError()}
              fallback={
                <>
                  <Show when={mode() === "newUser"}>
                    <MascotBubble
                      text="Welcome aboard. How do you want to sign on?"
                    />
                  </Show>
                  <Show when={mode() === "installSigner"}>
                    <MascotBubble
                      text="Your key lives on your signer, not with me. Install one, then pick Remote signer."
                    />
                  </Show>
                  <Show when={mode() === "bunker"}>
                    <div class="signin-bunker-tabs" role="tablist">
                      <button
                        type="button"
                        role="tab"
                        class={`signin-bunker-tab ${bunkerTab() === "qr" ? "active" : ""}`}
                        aria-selected={bunkerTab() === "qr"}
                        onClick={() => switchBunkerTab("qr")}
                      >
                        QR Code
                      </button>
                      <button
                        type="button"
                        role="tab"
                        class={`signin-bunker-tab ${bunkerTab() === "bunker" ? "active" : ""}`}
                        aria-selected={bunkerTab() === "bunker"}
                        onClick={() => switchBunkerTab("bunker")}
                      >
                        Bunker
                      </button>
                    </div>
                  </Show>
                  <Show when={mode() !== "newUser" && mode() !== "bunker" && mode() !== "installSigner"}>
                    <div class="signin-title">ORBEE</div>
                  </Show>
                </>
              }
            >
              <div class="signin-error">{error() || bunkerError()}</div>
            </Show>
          </div>
        </div>

        <div class="signin-body">
        {/* All views stay mounted; only one has .is-active at a time so crossfades work and typed state persists. */}

        <div class={`signin-view ${mode() === "entry" ? "is-active" : ""}`}>
          <button
            type="button"
            class="signin-btn"
            onClick={() => {
              setError("");
              if (hasNip07()) {
                signInWithExtension();
              } else {
                setMode("options");
              }
            }}
            disabled={busy()}
            onMouseEnter={() => { if (hasNip07()) setHovered("extension"); }}
            onMouseLeave={() => setHovered((h) => (h === "extension" ? null : h))}
          >
            Sign in with Nostr
          </button>

          <button
            type="button"
            class="signin-btn-alt"
            onClick={() => { setError(""); setMode("newUser"); }}
            onMouseEnter={() => setHovered("mint")}
            onMouseLeave={() => setHovered((h) => (h === "mint" ? null : h))}
          >
            I'm new here
          </button>

          <Show when={hasNip07()}>
            <button
              type="button"
              class="signin-link-quiet"
              onClick={() => { setError(""); setMode("options"); }}
            >
              More sign in options
            </button>
          </Show>

        </div>

        <div class={`signin-view ${mode() === "options" ? "is-active" : ""}`}>
          <div class="signin-field">
            <input
              type="password"
              class="signin-input"
              placeholder="nsec1…"
              value={nsec()}
              onInput={(e) => { setNsec(e.currentTarget.value); setError(""); }}
              onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
              ref={(el) => (nsecInputEl = el)}
              tabIndex={mode() === "options" ? 0 : -1}
            />
            <button class="signin-btn" onClick={submit} disabled={busy()}>
              Tune in
            </button>
          </div>

          <div class="signin-divider"><span>or</span></div>

          <button
            class="signin-btn-alt"
            onClick={openBunker}
            disabled={busy()}
            type="button"
            onMouseEnter={() => setHovered("signer")}
            onMouseLeave={() => setHovered((h) => (h === "signer" ? null : h))}
          >
            Remote signer
          </button>

          <button
            type="button"
            class="signin-bunker-back"
            onClick={() => { setError(""); setMode("entry"); }}
          >
            ← Back
          </button>
        </div>

        {/* Signer app intentionally first: a careless double-click on "I'm new here" lands on the safer option. */}
        <div class={`signin-view ${mode() === "newUser" ? "is-active" : ""}`}>
          <button
            type="button"
            class="signin-btn"
            onClick={() => setMode("installSigner")}
            onMouseEnter={() => setHovered("signer")}
            onMouseLeave={() => setHovered((h) => (h === "signer" ? null : h))}
          >
            I'll use a signer app
          </button>
          <div class="signin-divider">or</div>
          <input
            type="text"
            class="signin-name-input"
            placeholder="What should we call you?"
            value={signupName()}
            onInput={(e) => setSignupName(e.currentTarget.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !busy() && signupName().trim()) fastMint(); }}
            disabled={busy()}
            spellcheck={false}
            autocomplete="nickname"
            maxLength={48}
          />
          <button
            type="button"
            class="signin-btn-alt"
            onClick={fastMint}
            disabled={busy() || !signupName().trim()}
            onMouseEnter={() => setHovered("mint")}
            onMouseLeave={() => setHovered((h) => (h === "mint" ? null : h))}
          >
            Just get me on the air
          </button>
          <button
            type="button"
            class="signin-bunker-back"
            onClick={() => setMode("entry")}
          >
            ← Back
          </button>
        </div>

        <div class={`signin-view ${mode() === "installSigner" ? "is-active" : ""}`}>
          <div class="signin-install-group">
            <div class="signin-install-group-label">Browser extensions</div>
            <div class="signin-install-grid">
              <For each={EXTENSION_SIGNERS}>
                {(s) => (
                  <a
                    class="signin-install-card"
                    href={s.url}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <img class="signin-install-logo" src={s.logo} alt="" />
                    <span class="signin-install-name">{s.name}</span>
                  </a>
                )}
              </For>
            </div>
          </div>
          <div class="signin-install-group">
            <div class="signin-install-group-label">Remote signers</div>
            <div class="signin-install-grid">
              <For each={REMOTE_SIGNERS}>
                {(s) => (
                  <a
                    class="signin-install-card"
                    href={s.url}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <img class="signin-install-logo" src={s.logo} alt="" />
                    <span class="signin-install-name">{s.name}</span>
                    <span class="signin-install-platform">{s.platform}</span>
                  </a>
                )}
              </For>
            </div>
          </div>
          <button
            type="button"
            class="signin-bunker-back"
            onClick={() => setMode("entry")}
          >
            ← Back to sign in
          </button>
        </div>

        <div class={`signin-view ${mode() === "bunker" ? "is-active" : ""}`}>
          <BunkerPanel
            tab={bunkerTab()}
            onTabChange={switchBunkerTab}
            uri={bunkerUri()}
            status={bunkerStatus()}
            error={bunkerError()}
            paste={bunkerPaste()}
            onPasteChange={(v) => { setBunkerPaste(v); setBunkerError(""); }}
            onConnectPaste={connectPastedBunker}
            onCancel={cancelBunker}
            copied={copied()}
            onCopy={copyBunkerUri}
          />
        </div>
        </div>
      </div>
    </div>
  );
}

function BunkerPanel(props: {
  tab: "bunker" | "qr";
  onTabChange: (tab: "bunker" | "qr") => void;
  uri: string;
  status: string;
  error: string;
  paste: string;
  onPasteChange: (v: string) => void;
  onConnectPaste: () => void;
  onCancel: () => void;
  copied: boolean;
  onCopy: () => void;
}) {
  return (
    <div class="signin-bunker">
      <Show when={props.tab === "bunker"}>
        <div class="signin-bunker-panel">
          <p class="signin-bunker-desc">
            Paste a bunker URL from your signer.
          </p>
          <input
            type="text"
            class="signin-input"
            placeholder="bunker://…"
            value={props.paste}
            onInput={(e) => props.onPasteChange(e.currentTarget.value)}
          />
          <button
            type="button"
            class="signin-btn"
            onClick={props.onConnectPaste}
            disabled={!props.paste.trim()}
          >
            Connect
          </button>
          <Show when={props.status}>
            <div class="signin-bunker-status">{props.status}</div>
          </Show>
        </div>
      </Show>

      <Show when={props.tab === "qr"}>
        <div class="signin-bunker-panel">
          <Show
            when={props.uri}
            fallback={<div class="signin-bunker-status">Starting…</div>}
          >
            <div class="signin-bunker-main">
              <div class="signin-bunker-qr">
                <QRCode data={props.uri} size={160} />
              </div>
              <div class="signin-bunker-desc">
                <p>
                  Scan with a mobile signer app like{" "}
                  <a
                    class="signin-link"
                    href="https://github.com/greenart7c3/Amber"
                    target="_blank"
                    rel="noopener noreferrer"
                  >Amber</a>{" "}
                  <span class="signin-bunker-desc-quiet">(Android)</span>.
                </p>
                <button
                  type="button"
                  class="signin-bunker-copy-btn"
                  onClick={props.onCopy}
                >
                  {props.copied ? "copied ✓" : "copy url"}
                </button>
              </div>
            </div>
          </Show>
        </div>
      </Show>

      <button type="button" class="signin-bunker-back" onClick={props.onCancel}>
        ← Back
      </button>
    </div>
  );
}

function MascotBubble(props: { text: string }) {
  let bubbleEl!: HTMLDivElement;

  onMount(() => {
    const ctrl = typewriter(bubbleEl, props.text, {
      baseDelay: 46,
      punctuationPauses: true,
      thinkingPauses: true,
      cursor: true,
      cursorIdleDelay: 140,
      onDone: () => {
        bubbleEl.classList.add("is-done");
      },
    });
    onCleanup(() => ctrl.cancel());
  });

  return <div class="signin-mascot-bubble" ref={bubbleEl} />;
}
