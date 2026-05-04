import { createSignal, Show } from "solid-js";
import { type Signer } from "../lib/signer";
import { clearBackupPending } from "../lib/backup";
import { loadClaimedHandle } from "../lib/handle";
import { IconCopy } from "./icons";

/**
 * Inline backup view - replaces the old BackupModal. Runs as a
 * takeover in the main column (same shell as ProfileEditor / etc.)
 * so users get the full column width for reading long keys +
 * downloading the .spacecert file.
 *
 * Two sections (each self-contained, independently copy/downloadable):
 *   1. Nostr recovery key (nsec)         - only for local-key sessions
 *   2. Spaces handle (secret + cert)     - only when a handle has been claimed
 *
 * Hitting "I've saved all of this" clears the banner-pending flag so
 * the persistent amber banner stops nagging.
 */
export default function BackupView(props: { signer: Signer; onClose: () => void }) {
  const claim = loadClaimedHandle();

  const canShowNsec = props.signer.hasLocalKey;
  const hasHandle = !!claim;

  return (
    <div class="backup-view">
      <div class="backup-view-inner">
        <div class="backup-view-header">
          <div class="backup-view-eyebrow">Back up your account</div>
          <h2 class="backup-view-title">Save these before you go.</h2>
          <p class="backup-view-body">
            Anyone with these values can sign in as you. Losing them means
            losing this account - there's no server-side copy.
          </p>
        </div>

        <Show when={canShowNsec}>
          <NostrSection signer={props.signer} />
        </Show>

        <Show when={hasHandle}>
          <SpacesSection claim={claim!} />
        </Show>

        <Show when={!canShowNsec && !hasHandle}>
          <div class="backup-view-empty">
            Nothing to back up on this device - you're signed in with a
            remote signer and haven't claimed a handle yet.
          </div>
        </Show>

        <button
          type="button"
          class="backup-view-confirm"
          onClick={() => {
            clearBackupPending(props.signer.pubkey);
            props.onClose();
          }}
        >
          I've saved everything
        </button>
      </div>
    </div>
  );
}


function NostrSection(props: { signer: Signer }) {
  const [nsec, setNsec] = createSignal("");
  const [revealError, setRevealError] = createSignal("");
  const [copied, setCopied] = createSignal(false);
  const revealed = () => !!nsec();

  async function reveal() {
    try {
      const value = await props.signer.exportNsec();
      setNsec(value);
    } catch (e: any) {
      setRevealError(e?.message || "Couldn't read the key.");
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(nsec());
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch { /* user can still select */ }
  }

  return (
    <section class="backup-section">
      <div class="backup-section-header">
        <div class="backup-section-label">1 · Nostr recovery key</div>
        <div class="backup-section-hint">
          Paste this into any Nostr client to sign in as you.
        </div>
      </div>

      <div class="backup-section-body">
        <Show
          when={revealed()}
          fallback={
            <>
              <button type="button" class="backup-reveal" onClick={reveal}>
                Reveal key
              </button>
              <Show when={revealError()}>
                <div class="backup-error">{revealError()}</div>
              </Show>
            </>
          }
        >
          <code class="backup-code">{nsec()}</code>
          <div class="backup-actions">
            <button type="button" class="backup-action" onClick={copy}>
              <IconCopy />
              {copied() ? "Copied" : "Copy"}
            </button>
          </div>
        </Show>
      </div>
    </section>
  );
}


function SpacesSection(props: { claim: { name: string; full: string; certificate: string; secretKey?: string } }) {
  const [revealed, setRevealed] = createSignal(false);
  const [copied, setCopied] = createSignal(false);

  const secret = props.claim.secretKey || "";

  async function copySecret() {
    try {
      await navigator.clipboard.writeText(secret);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch { /* ignore */ }
  }

  function downloadCert() {
    const bytes = base64ToBytes(props.claim.certificate);
    const blob = new Blob([bytes as BlobPart], { type: "application/octet-stream" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${props.claim.full}.spacecert`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  return (
    <section class="backup-section">
      <div class="backup-section-header">
        <div class="backup-section-label">2 · Spaces handle</div>
        <div class="backup-section-hint">
          The secret key signs updates to <code>{props.claim.full}</code>.
          The certificate proves you own it - keep both together.
        </div>
      </div>

      <div class="backup-section-body">
        {/* Secret key - reveal + copy */}
        <div class="backup-sub">
          <div class="backup-sub-label">Secret key (64-char hex)</div>
          <Show
            when={revealed()}
            fallback={
              <button
                type="button"
                class="backup-reveal"
                onClick={() => setRevealed(true)}
              >
                Reveal secret key
              </button>
            }
          >
            <code class="backup-code">{secret || "(missing - claim may be incomplete)"}</code>
            <Show when={secret}>
              <div class="backup-actions">
                <button type="button" class="backup-action" onClick={copySecret}>
                  <IconCopy />
                  {copied() ? "Copied" : "Copy"}
                </button>
              </div>
            </Show>
          </Show>
        </div>

        {/* Certificate - download only; not meant to be read by eye */}
        <div class="backup-sub">
          <div class="backup-sub-label">Certificate file</div>
          <div class="backup-actions">
            <button type="button" class="backup-action" onClick={downloadCert}>
              Download .spacecert
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}
