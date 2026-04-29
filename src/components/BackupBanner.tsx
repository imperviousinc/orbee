import { Show } from "solid-js";
import { isLocalSigner, type Signer } from "../lib/signer";
import { snoozeBackup, useBackupState } from "../lib/backup";

/** Backup nag banner for LocalSigner sessions only (extensions/bunkers don't
 *  expose the key). Snoozable (1h) or click-through to BackupView. */
export default function BackupBanner(props: { signer: Signer; onOpen: () => void }) {
  const state = useBackupState(() => props.signer.pubkey);

  function snooze() {
    snoozeBackup(props.signer.pubkey);
  }

  if (!isLocalSigner(props.signer)) return null;

  return (
    <Show when={state().shouldShow}>
      <div class="backup-banner" role="status">
        <span class="backup-banner-dot" aria-hidden="true" />
        <span class="backup-banner-text">
          Your recovery key isn't backed up yet.
        </span>
        <button
          type="button"
          class="backup-banner-primary"
          onClick={props.onOpen}
        >
          Back it up
        </button>
        <button
          type="button"
          class="backup-banner-dismiss"
          onClick={snooze}
          title="Remind me in an hour"
        >
          Remind me later
        </button>
      </div>
    </Show>
  );
}
