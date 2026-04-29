import { Show, For, createSignal, onCleanup, onMount } from "solid-js";
import { profileCard, closeProfileCard } from "../lib/profileCard";
import { openProfile } from "../lib/profileView";
import { identityParts, avatarSrc, profiles, markAvatarBroken } from "../lib/profiles";
import { displayStateFor } from "../lib/verify";
import { handleColor } from "../lib/colors";
import { isAdminOf, getMemberRoles, activeStation } from "../lib/stations";
import { pubkeyToNpub, truncateNpub } from "../lib/keys";
import IdentityPrimary from "./IdentityPrimary";
import { IconCopy } from "./icons";

/**
 * Floating profile card - pops up next to a clicked handle. Shows the
 * full identity (including the claimed handle even when unverified -
 * the card is the place to be honest about the claim), the display
 * name, station-scoped roles, and a "Go to profile" button that swaps
 * the main column to the full ProfileView.
 *
 * One card at a time; outside-click / Esc closes.
 */
const CARD_WIDTH = 260;
const CARD_MAX_HEIGHT = 360;
const EDGE_PAD = 12;

export default function ProfileCard() {
  let cardRef: HTMLDivElement | undefined;

  onMount(() => {
    function onDown(e: MouseEvent) {
      if (!profileCard()) return;
      const t = e.target as HTMLElement;
      if (cardRef && cardRef.contains(t)) return;
      // Let the trigger's click handler decide; mousedown would close
      // before click fires and the trigger would re-open the card.
      if (t.closest("[data-profile-trigger]")) return;
      closeProfileCard();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && profileCard()) {
        closeProfileCard();
      }
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    onCleanup(() => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    });
  });

  // Position within viewport bounds - avoid the card spilling off the
  // right edge on a left-rail click or off the bottom on a long roster.
  const position = () => {
    const req = profileCard();
    if (!req) return { left: 0, top: 0 };
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let left = req.x + 12;
    let top = req.y + 8;
    if (left + CARD_WIDTH + EDGE_PAD > vw) left = vw - CARD_WIDTH - EDGE_PAD;
    if (top + CARD_MAX_HEIGHT + EDGE_PAD > vh) top = Math.max(EDGE_PAD, vh - CARD_MAX_HEIGHT - EDGE_PAD);
    if (left < EDGE_PAD) left = EDGE_PAD;
    if (top < EDGE_PAD) top = EDGE_PAD;
    return { left, top };
  };

  const [copied, setCopied] = createSignal(false);
  let copyResetTimer: number | undefined;
  onCleanup(() => {
    if (copyResetTimer) clearTimeout(copyResetTimer);
  });

  return (
    <Show when={profileCard()}>
      {(req) => {
        const pk = () => req().pubkey;
        const parts = () => identityParts(pk());
        const state = () => displayStateFor(pk());
        const color = () => handleColor(pk());
        const isAdmin = () => isAdminOf(activeStation(), pk());
        const roles = () => getMemberRoles(activeStation(), pk());
        const hasAnyRole = () => isAdmin() || roles().length > 0;

        function goToProfile() {
          openProfile(pk());
          closeProfileCard();
        }

        // Copy the full handle (or npub1... for non-handled) - npub is
        // the canonical shareable form, more useful than the truncated
        // display string the card shows.
        function copyIdentity() {
          const text = parts().hasHandle ? parts().primary : pubkeyToNpub(pk());
          navigator.clipboard.writeText(text).then(() => {
            setCopied(true);
            if (copyResetTimer) clearTimeout(copyResetTimer);
            copyResetTimer = window.setTimeout(() => setCopied(false), 1400);
          }).catch((e) => {
            console.warn("[profile-card] copy failed:", e);
          });
        }

        return (
          <div
            ref={cardRef}
            class="profile-card"
            role="dialog"
            aria-label="Profile preview"
            style={{
              left: `${position().left}px`,
              top: `${position().top}px`,
            }}
          >
            <div class="profile-card-avatar-wrap">
              <img
                class="profile-card-avatar"
                src={avatarSrc(pk())}
                alt=""
                onError={() => {
                  const u = profiles[pk()]?.picture;
                  if (u) markAvatarBroken(u);
                }}
              />
            </div>

            <div class="profile-card-identity">
              <span
                class={`profile-card-handle ${parts().hasHandle ? "" : "is-npub"}`}
                style={{ color: parts().hasHandle ? color() : "var(--text-secondary)" }}
              >
                <IdentityPrimary identity={parts()} />
              </span>
              <button
                type="button"
                class={`profile-card-copy ${copied() ? "is-copied" : ""}`}
                onClick={copyIdentity}
                title={parts().hasHandle ? "Copy handle" : "Copy npub"}
                aria-label="Copy identity"
              >
                <Show when={copied()} fallback={<IconCopy />}>
                  <span class="profile-card-copy-done">Copied</span>
                </Show>
              </button>
              <Show when={state() === "orange"}>
                <span
                  class="profile-card-verified"
                  title="Sovereign handle pinned to a trusted anchor"
                  aria-label="Verified"
                >
                  <svg viewBox="0 0 8 8" aria-hidden="true">
                    <path d="M1.7 4.2 L3.2 5.6 L6.3 2.5" />
                  </svg>
                </span>
              </Show>
              <Show when={state() === "unverified" && parts().hasHandle}>
                <span
                  class="profile-card-unverified"
                  title="No trust anchor pinned - this handle claim cannot be verified"
                >
                  unverified
                </span>
              </Show>
            </div>

            <Show when={parts().secondary}>
              <div class="profile-card-alias">{parts().secondary}</div>
            </Show>

            {/* When the claimed handle can't be verified, surface the
                canonical npub below so the user knows the *actual*
                identity beneath the claim. */}
            <Show when={state() === "unverified" && parts().hasHandle}>
              <div class="profile-card-npub-line">
                <span class="profile-card-npub-label">npub</span>
                <span class="profile-card-npub-value">{truncateNpub(pk())}</span>
              </div>
            </Show>

            <Show when={hasAnyRole()}>
              <div class="profile-card-section">
                <div class="profile-card-section-label">Roles</div>
                <div class="profile-card-role-chips">
                  <Show when={isAdmin()}>
                    <span class="role-badge admin">admin</span>
                  </Show>
                  <For each={roles()}>
                    {(role) => <span class="role-badge">{role}</span>}
                  </For>
                </div>
              </div>
            </Show>

            <button class="profile-card-goto" onClick={goToProfile}>
              Go to profile →
            </button>
          </div>
        );
      }}
    </Show>
  );
}
