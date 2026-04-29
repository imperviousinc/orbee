import { createSignal, Show, For, onMount, onCleanup } from "solid-js";
import { createStore, produce, unwrap } from "solid-js/store";
import { type Signer } from "../lib/signer";
import { profiles, publishProfile } from "../lib/profiles";
import { uploadToBlossom } from "../lib/blossom";
import { resetAllCaches } from "../lib/cacheReset";
import { confirmDialog } from "../lib/dialog";
import { loadClaimedHandle } from "../lib/handle";
import {
  republishSpacesZone,
  loadEditableRecords,
  loadManagedSnapshot,
  type SpacesRecord,
  type ManagedSnapshot,
} from "../lib/spacesPublish";
import { fetchRelayList } from "../lib/nip65";
import { IconX } from "./icons";
import TakeoverCard from "./TakeoverCard";

type Tab = "nostr" | "spaces";

/** Inline kind:0 profile editor (display_name + picture + about). */
export default function ProfileEditor(props: {
  signer: Signer;
  onClose: () => void;
}) {
  const existing = () => profiles[props.signer.pubkey];
  console.log("[profile/editor mount]", {
    pubkey: props.signer.pubkey.slice(0, 10),
    existing: existing()
      ? {
          display_name: existing()!.display_name,
          name: existing()!.name,
          handle: existing()!.handle,
          picture: existing()!.picture,
          about: existing()!.about,
          fetchedAt: existing()!.fetchedAt,
        }
      : "(none)",
  });
  const [displayName, setDisplayName] = createSignal(existing()?.display_name || existing()?.name || "");
  const [picture, setPicture] = createSignal(existing()?.picture || "");
  const [about, setAbout] = createSignal(existing()?.about || "");
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal("");
  const [uploading, setUploading] = createSignal(false);
  const [uploadProgress, setUploadProgress] = createSignal(0);
  const [uploadError, setUploadError] = createSignal<string | null>(null);
  const [dragOver, setDragOver] = createSignal(false);
  let fileInputRef!: HTMLInputElement;

  async function uploadPicture(file: File) {
    if (!file.type.startsWith("image/")) {
      setUploadError("Please pick an image file.");
      return;
    }
    setUploading(true);
    setUploadProgress(0);
    setUploadError(null);
    try {
      const result = await uploadToBlossom(file, props.signer, setUploadProgress);
      setPicture(result.url);
    } catch (e: any) {
      setUploadError(e?.message || "Upload failed.");
    } finally {
      setUploading(false);
    }
  }

  function handleFileInput(e: Event) {
    const file = (e.currentTarget as HTMLInputElement).files?.[0];
    if (file) uploadPicture(file);
    (e.currentTarget as HTMLInputElement).value = "";
  }

  function handleDrop(e: DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer?.files?.[0];
    if (file) uploadPicture(file);
  }

  function handleDocumentPaste(e: ClipboardEvent) {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of items) {
      if (item.type.startsWith("image/")) {
        e.preventDefault();
        const file = item.getAsFile();
        if (file) uploadPicture(file);
        return;
      }
    }
  }

  function preventWindowDragDefault(e: DragEvent) { e.preventDefault(); }

  onMount(() => {
    document.addEventListener("paste", handleDocumentPaste);
    window.addEventListener("dragover", preventWindowDragDefault);
    window.addEventListener("drop", preventWindowDragDefault);
    onCleanup(() => {
      document.removeEventListener("paste", handleDocumentPaste);
      window.removeEventListener("dragover", preventWindowDragDefault);
      window.removeEventListener("drop", preventWindowDragDefault);
    });
  });

  async function handleResetCache() {
    const ok = await confirmDialog({
      title: "Reset local cache?",
      body:
        "Wipes cached messages, reactions, profiles, and avatars stored " +
        "in this browser. Your account and joined stations are kept. " +
        "The page will reload.",
      confirmLabel: "Reset",
      destructive: true,
    });
    if (!ok) return;
    setBusy(true);
    try {
      await resetAllCaches();
      window.location.reload();
    } catch (e: any) {
      setError(e?.message || "Couldn't reset cache.");
      setBusy(false);
    }
  }

  const [didFail, setDidFail] = createSignal(false);
  const [tab, setTab] = createSignal<Tab>("nostr");

  const claim = () => loadClaimedHandle();
  const hasClaim = () => !!claim()?.certificate && !!claim()?.secretKey;
  const [republishBusy, setRepublishBusy] = createSignal(false);
  const [republishMsg, setRepublishMsg] = createSignal<string | null>(null);
  const [republishErr, setRepublishErr] = createSignal<string | null>(null);
  const [previewRelays, setPreviewRelays] = createSignal<string[] | null>(null);
  const [managed, setManaged] = createSignal<ManagedSnapshot | null>(null);
  // Store (not signal-of-array) so per-row inputs keep focus while typing.
  const [extraRecords, setExtraRecords] = createStore<SpacesRecord[]>([]);
  const [recordsLoaded, setRecordsLoaded] = createSignal(false);

  async function refreshRelayPreview() {
    const list = await fetchRelayList(props.signer.pubkey);
    setPreviewRelays(list?.write ?? []);
  }

  async function loadSpacesRecords() {
    const c = claim();
    if (!c?.full) { setRecordsLoaded(true); return; }
    try {
      const [recs, snap] = await Promise.all([
        loadEditableRecords(c.full),
        loadManagedSnapshot(c.full),
      ]);
      setExtraRecords(recs);
      setManaged(snap);
    } finally {
      setRecordsLoaded(true);
    }
  }

  /** Poll fabric until seq.version >= expected, then refresh from that state. */
  async function confirmPublishedSeq(handle: string, expectedSeq: number) {
    const deadline = Date.now() + 15_000;
    let lastSeq: number | null = null;
    while (Date.now() < deadline) {
      const snap = await loadManagedSnapshot(handle);
      lastSeq = snap.currentSeq;
      if (snap.currentSeq != null && snap.currentSeq >= expectedSeq) {
        const recs = await loadEditableRecords(handle);
        setExtraRecords(recs);
        setManaged(snap);
        setRepublishMsg("Zone republished - relays caught up.");
        return;
      }
      await new Promise((r) => setTimeout(r, 1500));
    }
    setRepublishMsg(
      `Published, but the relay we polled is still on seq ${lastSeq ?? "?"} ` +
      `(expected ${expectedSeq}). It'll catch up shortly - your edits are saved.`,
    );
  }

  async function handleRepublish() {
    setRepublishBusy(true);
    setRepublishMsg(null);
    setRepublishErr(null);
    try {
      const c = claim();
      if (!c?.certificate || !c?.secretKey) {
        throw new Error("Missing cert or secret - claim flow incomplete.");
      }
      // unwrap to plain objects: worker structured-clone rejects store proxies.
      await republishSpacesZone({
        signer: props.signer,
        certBase64: c.certificate,
        secretKey: c.secretKey,
        handle: c.full,
        extraRecords: unwrap(extraRecords).map((r) => ({ ...r })),
        includeRelayList: true,
      });
      setRepublishMsg("Zone republished - waiting for propagation…");
      // Poll for the bumped seq before swapping editor state - a single
      // re-fetch could hit a lagging relay and clobber local edits.
      const expectedSeq = (managed()?.nextSeq ?? 1);
      void confirmPublishedSeq(c.full, expectedSeq);
    } catch (e: any) {
      setRepublishErr(e?.message || "Republish failed.");
    } finally {
      setRepublishBusy(false);
    }
  }

  function addRecord() {
    setExtraRecords(extraRecords.length, { type: "txt", key: "", value: "" });
  }
  function updateRecord(i: number, field: keyof SpacesRecord, value: string) {
    setExtraRecords(i, field as any, value);
  }
  function removeRecord(i: number) {
    setExtraRecords(produce((arr) => { arr.splice(i, 1); }));
  }

  async function handleSave() {
    setBusy(true);
    setError("");
    setDidFail(false);
    try {
      const result = await publishProfile(props.signer, {
        display_name: displayName().trim() || undefined,
        picture: picture().trim() || undefined,
        about: about().trim() || undefined,
      });
      if (!result.ok) {
        const reason = result.message || "unknown";
        console.warn("[profile] publish failed:", reason);
        setError(`Couldn't save - ${reason === "timeout" ? "relay didn't respond" : reason}`);
        setDidFail(true);
        return;
      }
      props.onClose();
    } catch (e: any) {
      console.warn("[profile] publish threw:", e);
      setError(e?.message || "Couldn't save profile.");
      setDidFail(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <TakeoverCard onClose={props.onClose}>
        <div class="station-preview-label">Your profile</div>

        <div class="profile-tabs" role="tablist">
          <button
            type="button"
            class={`profile-tab ${tab() === "nostr" ? "active" : ""}`}
            role="tab"
            aria-selected={tab() === "nostr"}
            onClick={() => setTab("nostr")}
          >
            Nostr
          </button>
          <button
            type="button"
            class={`profile-tab ${tab() === "spaces" ? "active" : ""}`}
            role="tab"
            aria-selected={tab() === "spaces"}
            onClick={() => {
              setTab("spaces");
              if (previewRelays() === null) refreshRelayPreview();
              if (!recordsLoaded()) loadSpacesRecords();
            }}
          >
            Spaces
          </button>
        </div>

        <Show when={tab() === "nostr"}>
        <div class="station-preview-row">
          <label class="station-preview-relay-label">HANDLE</label>
          <div class="profile-handle-display">
            {existing()?.handle || <span class="profile-handle-empty">no handle</span>}
          </div>
        </div>

        <div class="station-preview-row">
          <label class="station-preview-relay-label">DISPLAY NAME</label>
          <input
            type="text"
            class="station-preview-relay"
            placeholder="how you want to appear"
            value={displayName()}
            onInput={(e) => { setDisplayName(e.currentTarget.value); setError(""); }}
            disabled={busy()}
          />
          <div class="profile-handle-hint">
            Friendly label shown alongside your handle.
          </div>
        </div>

        <div class="station-preview-row">
          <label class="station-preview-relay-label">PICTURE</label>
          <div
            class={`pic-zone ${dragOver() ? "drag-over" : ""} ${picture() ? "has-image" : ""}`}
            onClick={() => !uploading() && fileInputRef.click()}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
          >
            <Show
              when={picture()}
              fallback={
                <div class="pic-zone-empty">
                  Drop an image, or click to upload
                </div>
              }
            >
              <img class="pic-zone-img" src={picture()} alt="" />
              <button
                type="button"
                class="pic-zone-clear"
                onClick={(e) => { e.stopPropagation(); setPicture(""); setUploadError(null); }}
                title="Remove picture"
                aria-label="Remove picture"
              >
                <IconX />
              </button>
            </Show>
            <Show when={uploading()}>
              <div class="pic-zone-overlay">
                <div class="upload-progress">
                  <div class="upload-progress-bar" style={{ width: `${uploadProgress()}%` }} />
                </div>
              </div>
            </Show>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              style={{ display: "none" }}
              onChange={handleFileInput}
            />
          </div>
          <Show when={uploadError()}>
            <div class="station-preview-error">{uploadError()}</div>
          </Show>
        </div>

        <div class="station-preview-row">
          <label class="station-preview-relay-label">ABOUT</label>
          <textarea
            class="station-preview-relay station-settings-textarea"
            placeholder="a sentence about yourself"
            value={about()}
            onInput={(e) => { setAbout(e.currentTarget.value); setError(""); }}
            disabled={busy()}
            rows={3}
          />
        </div>

        <div class="station-preview-row">
          <label class="station-preview-relay-label">CACHE</label>
          <button
            type="button"
            class="profile-cache-reset"
            onClick={handleResetCache}
            disabled={busy()}
          >
            Reset local cache
          </button>
          <div class="profile-key-hint">
            Wipes cached messages, reactions, profiles, and avatars from
            this browser. Your account and joined stations are kept; the
            page will reload after.
          </div>
        </div>

        <Show when={error()}>
          <div class="station-preview-error">{error()}</div>
        </Show>

        <div class="station-preview-actions">
          <button
            type="button"
            class="station-preview-cancel"
            onClick={props.onClose}
            disabled={busy()}
          >
            Cancel
          </button>
          <button
            type="button"
            class="station-preview-join"
            onClick={handleSave}
            disabled={busy()}
          >
            {busy() ? "Saving…" : didFail() ? "Try again" : "Save profile"}
          </button>
        </div>
        </Show>

        <Show when={tab() === "spaces"}>
          <Show
            when={hasClaim()}
            fallback={
              <div class="station-preview-row">
                <div class="profile-handle-hint">
                  No Spaces handle claimed yet. Run the onboarding flow
                  or import a `.spacecert` to publish records.
                </div>
              </div>
            }
          >
            <div class="station-preview-row">
              <label class="station-preview-relay-label">HANDLE</label>
              <div class="profile-handle-display">{claim()!.full}</div>
            </div>

            <div class="station-preview-row">
              <label class="station-preview-relay-label">MANAGED RECORDS</label>
              <div class="profile-handle-hint">
                Auto-regenerated on each republish. <code>seq</code>
                bumps so certrelay accepts the update; <code>addr.nostr</code>
                always carries your npub plus your NIP-65 write relays.
              </div>

              <div class="spaces-managed">
                <div class="spaces-managed-row">
                  <span class="spaces-managed-key">seq.version</span>
                  <Show
                    when={recordsLoaded()}
                    fallback={<span class="spaces-managed-val muted">loading…</span>}
                  >
                    <span class="spaces-managed-val">
                      {managed()?.currentSeq ?? "-"}
                      <span class="spaces-managed-arrow">→</span>
                      <strong>{managed()?.nextSeq ?? 1}</strong>
                    </span>
                  </Show>
                </div>

                <div class="spaces-managed-row">
                  <span class="spaces-managed-key">addr.nostr</span>
                  <Show
                    when={previewRelays() !== null}
                    fallback={<span class="spaces-managed-val muted">looking up NIP-65…</span>}
                  >
                    <ul class="spaces-managed-val spaces-relay-list-ul">
                      <li class="own-npub">{`npub (your nostr pubkey)`}</li>
                      <For each={previewRelays() ?? []}>{(u) => <li>{u}</li>}</For>
                      <Show when={(previewRelays() ?? []).length === 0}>
                        <li class="muted">no NIP-65 relay list - record will publish with npub only</li>
                      </Show>
                    </ul>
                  </Show>
                </div>

                <Show when={managed()?.nostrAddr && (managed()!.nostrAddr!.length > 0)}>
                  <div class="spaces-managed-row spaces-managed-prev">
                    <span class="spaces-managed-key muted">currently published</span>
                    <ul class="spaces-managed-val spaces-relay-list-ul">
                      <For each={managed()!.nostrAddr!}>{(v) => <li>{String(v)}</li>}</For>
                    </ul>
                  </div>
                </Show>
              </div>
            </div>

            <div class="station-preview-row">
              <label class="station-preview-relay-label">EXTRA RECORDS</label>
              <div class="profile-handle-hint">
                Optional SIP-7 records (e.g. <code>txt</code>, additional
                <code> addr</code> keys). The <code>seq</code> +
                <code> addr.nostr</code> rows are managed automatically.
              </div>
              <div class="spaces-records">
                <For each={extraRecords}>
                  {(rec, i) => (
                    <div class="spaces-record-row">
                      <input
                        class="station-preview-relay spaces-record-type"
                        placeholder="type"
                        value={rec.type}
                        onInput={(e) => updateRecord(i(), "type", e.currentTarget.value)}
                      />
                      <input
                        class="station-preview-relay spaces-record-key"
                        placeholder="key"
                        value={rec.key ?? ""}
                        onInput={(e) => updateRecord(i(), "key", e.currentTarget.value)}
                      />
                      <input
                        class="station-preview-relay spaces-record-value"
                        placeholder="value"
                        value={typeof rec.value === "string" ? rec.value : JSON.stringify(rec.value ?? "")}
                        onInput={(e) => updateRecord(i(), "value", e.currentTarget.value)}
                      />
                      <button
                        type="button"
                        class="spaces-record-remove"
                        onClick={() => removeRecord(i())}
                        aria-label="Remove record"
                      >
                        <IconX />
                      </button>
                    </div>
                  )}
                </For>
                <button
                  type="button"
                  class="spaces-record-add"
                  onClick={addRecord}
                >
                  + add record
                </button>
              </div>
            </div>

            <Show when={republishMsg()}>
              <div class="station-preview-hint">{republishMsg()}</div>
            </Show>
            <Show when={republishErr()}>
              <div class="station-preview-error">{republishErr()}</div>
            </Show>

            <div class="station-preview-actions">
              <button
                type="button"
                class="station-preview-cancel"
                onClick={props.onClose}
                disabled={republishBusy()}
              >
                Close
              </button>
              <button
                type="button"
                class="station-preview-join"
                onClick={handleRepublish}
                disabled={republishBusy()}
              >
                {republishBusy() ? "Publishing…" : "Republish zone"}
              </button>
            </div>
          </Show>
        </Show>
    </TakeoverCard>
  );
}
