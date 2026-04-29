import { Show, createSignal } from "solid-js";
import { profiles, identityParts, avatarSrc, markAvatarBroken } from "../lib/profiles";
import { pubkeyToNpub } from "../lib/keys";
import { forceReVerify, verifyState } from "../lib/verify";
import IdentityPrimary from "./IdentityPrimary";
import TakeoverCard from "./TakeoverCard";

// Profile readout that takes over the main column. Now wrapped in
// TakeoverCard so it shares the same chrome-bg / border / shadow as
// StationSettings and ProfileEditor - the previous "bare console
// readout" treatment read as sloppy next to those panel-style views.
//
// "Phosphor for whatever is the primary identity" - handle when the
// kind:0 has one (verified per Spaces fabric), npub otherwise.
export default function ProfileView(props: { pubkey: string; onClose: () => void }) {
  const ident = () => identityParts(props.pubkey);
  const profile = () => profiles[props.pubkey];
  const fullNpub = () => pubkeyToNpub(props.pubkey);
  const verifyRec = () => verifyState[props.pubkey];
  // Map to the three display states from the Spaces guideline:
  //   orange     → sovereign + trusted anchor (show orange check)
  //   unverified → no trust anchor / match failed (show warning)
  //   none       → plain (semi-trusted / pending / dependent)
  type DisplayState = "plain" | "orange" | "unverified" | "pending";
  const displayState = (): DisplayState => {
    if (!ident().hasHandle) return "plain";
    const r = verifyRec();
    if (!r || r.match === "pending") return "pending";
    if (r.match !== "verified") return "unverified";
    if (r.badge === "orange") return "orange";
    if (r.badge === "unverified") return "unverified";
    return "plain";
  };
  const [reverifying, setReverifying] = createSignal(false);

  async function handleReverify() {
    if (reverifying()) return;
    const handle = profile()?.handle;
    if (!handle) return;
    setReverifying(true);
    try {
      await forceReVerify(props.pubkey, handle);
    } finally {
      // Give the batch flush one tick to resolve before unlocking.
      setTimeout(() => setReverifying(false), 600);
    }
  }

  return (
    <TakeoverCard onClose={props.onClose} maxWidth="520px">
      <div class="profile-osc">
        <div class="profile-avatar">
          <img
            src={avatarSrc(props.pubkey)}
            alt=""
            onError={() => {
              const u = profile()?.picture;
              if (u) markAvatarBroken(u);
            }}
          />
        </div>

        {/* Primary identity readout - phosphor green, mono, large. */}
        <div class="profile-primary">
          <Show
            when={ident().hasHandle}
            fallback={<span class="profile-npub-full">{fullNpub()}</span>}
          >
            <IdentityPrimary identity={ident()} />
          </Show>
        </div>

        {/* When the handle is the primary, show the full npub below as a
            secondary phosphor-tinted readout - the cryptographic substrate
            that backs the friendly handle. */}
        <Show when={ident().hasHandle}>
          <div class="profile-secondary">
            <span class="profile-npub-full">{fullNpub()}</span>
          </div>
        </Show>

        {/* Display name (only when safeName() let it through). Lower in the
            hierarchy than the cryptographic identity above. */}
        <Show when={ident().secondary}>
          <div class="profile-displayname">{ident().secondary}</div>
        </Show>

        {/* Verification chip - Spaces badge() semantics. Click to
            re-verify. "none" state is suppressed entirely (the
            absence of a badge is the signal, per the guideline). */}
        <Show when={ident().hasHandle && displayState() !== "plain"}>
          <button
            type="button"
            class={`profile-verify is-clickable profile-verify-${displayState()}`}
            onClick={handleReverify}
            disabled={reverifying()}
            title="Click to re-verify"
          >
            <Show
              when={displayState() === "orange"}
              fallback={<span class="profile-verify-dot" />}
            >
              <svg class="profile-verify-check" viewBox="0 0 14 14">
                <circle cx="7" cy="7" r="7" fill="#ff8833" />
                <path d="M3.6 7 L6 9.3 L10.4 4.8" stroke="#151513" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round" />
              </svg>
            </Show>
            {reverifying()
              ? "checking…"
              : displayState() === "orange"
                ? "verified"
                : displayState() === "unverified"
                  ? "unverified"
                  : "checking…"}
          </button>
        </Show>

        <Show when={profile()?.about}>
          <div class="profile-divider" />
          <p class="profile-bio">{profile()?.about}</p>
        </Show>
      </div>
    </TakeoverCard>
  );
}
