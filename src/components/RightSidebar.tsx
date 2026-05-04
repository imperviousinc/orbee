import { For, Show, createSignal, createEffect, onMount, onCleanup } from "solid-js";
import { createStore } from "solid-js/store";
import { profiles, requestProfiles, avatarSrc, markAvatarBroken } from "../lib/profiles";
import { identityPartsVerified } from "../lib/verify";
import { IconX, IconDotsThreeVertical } from "./icons";
import type { NostrEvent } from "../lib/keys";
import { handleColor } from "../lib/colors";
import {
  stations,
  stationKey,
  addUser,
  dismissPendingRequest,
  addPendingRequest,
  visiblePendingRequests,
  type StationRef,
} from "../lib/stations";
import MemberActions from "./MemberActions";
import AddMemberModal from "./AddMemberModal";
import IdentityPrimary from "./IdentityPrimary";
import { toggleProfileCard } from "../lib/profileCard";
import { getSigner } from "../lib/auth";
import TrustAnchor from "./TrustAnchor";

function recentActivity(pubkey: string, events: NostrEvent[]): number | null {
  let latest: number | null = null;
  for (const e of events) {
    if (e.pubkey !== pubkey) continue;
    if (latest == null || e.created_at > latest) latest = e.created_at;
  }
  return latest;
}

function timeAgo(ts: number): string {
  const seconds = Math.floor(Date.now() / 1000) - ts;
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

export default function RightSidebar(props: {
  events: NostrEvent[];
  station: StationRef | null;
  open?: boolean;
  onClose?: () => void;
}) {
  const station = () => props.station ? stations[stationKey(props.station)] : undefined;
  const members = () => station()?.members || [];
  const admins = () => new Set(station()?.admins || []);

  const myPubkey = () => getSigner().pubkey;
  const iAmAdmin = () => admins().has(myPubkey());

  const [openModFor, setOpenModFor] = createSignal<string | null>(null);
  const [showAddMember, setShowAddMember] = createSignal(false);

  onMount(() => {
    function handleDocClick(e: MouseEvent) {
      if (!openModFor()) return;
      const t = e.target as HTMLElement;
      if (!t.closest(".member-mod-menu") && !t.closest(".member-mod-trigger")) {
        setOpenModFor(null);
      }
    }
    document.addEventListener("click", handleDocClick);
    onCleanup(() => document.removeEventListener("click", handleDocClick));
  });


  // Pending kind:9021 requests for the active station; pruned when the
  // requester appears in kind:39002.
  const requests = () => visiblePendingRequests(props.station, myPubkey());

  createEffect(() => {
    const pks = requests().map((r) => r.pubkey).filter((pk) => !profiles[pk]);
    if (pks.length > 0) requestProfiles(pks);
  });

  const [approveErrors, setApproveErrors] = createStore<Record<string, string>>({});

  // Optimistic remove on Approve; re-queue + surface the error if the relay rejects.
  async function handleApprove(targetPubkey: string, ts: number) {
    const s = props.station;
    if (!s) return;
    setApproveErrors(targetPubkey, undefined as any);
    dismissPendingRequest(s, targetPubkey);
    const result = await addUser(getSigner(), s, targetPubkey);
    if (!result.ok) {
      addPendingRequest(s, targetPubkey, ts);
      setApproveErrors(targetPubkey, result.message || "Relay rejected the approval");
    }
  }

  function handleDismissRequest(targetPubkey: string) {
    const s = props.station;
    if (!s) return;
    dismissPendingRequest(s, targetPubkey);
    setApproveErrors(targetPubkey, undefined as any);
  }

  // kind:39002 doesn't carry timestamps; cross-reference recent feed events.
  const membersWithActivity = () => {
    const roster = members();
    return roster
      .map((pubkey) => ({ pubkey, lastSeen: recentActivity(pubkey, props.events) }))
      .sort((a, b) => {
        if (a.lastSeen == null && b.lastSeen == null) return 0;
        if (a.lastSeen == null) return 1;
        if (b.lastSeen == null) return -1;
        return b.lastSeen - a.lastSeen;
      });
  };

  return (
    <div class={`right-sidebar ${props.open ? "open" : ""}`}>
      <TrustAnchor />

      <div class="rs-header">
        Members <span class="rs-header-n">{members().length}</span>
      </div>

      <Show when={iAmAdmin() && props.station}>
        <button
          type="button"
          class="add-member-btn"
          onClick={() => setShowAddMember(true)}
        >
          + Add member
        </button>
      </Show>

      <div class="member-list">
        <Show when={iAmAdmin()}>
          <For each={requests()}>
            {(req) => {
              const reqIdentity = () => identityPartsVerified(req.pubkey);
              return (
              <div class="member member-pending">
                <div class="member-avatar">
                  <img
                    src={avatarSrc(req.pubkey)}
                    alt=""
                    loading="lazy"
                    onError={() => { const u = profiles[req.pubkey]?.picture; if (u) markAvatarBroken(u); }}
                  />
                </div>
                <div class="member-details">
                  <div
                    class={`member-handle ${reqIdentity().hasHandle ? "" : "is-npub"}`}
                    style={{ color: reqIdentity().hasHandle ? handleColor(req.pubkey) : "var(--text-secondary)" }}
                    onClick={(e) => { e.stopPropagation(); toggleProfileCard(req.pubkey, e.clientX, e.clientY); }}
                    data-profile-trigger
                    data-tip={reqIdentity().hasHandle ? reqIdentity().primary : undefined}
                  >
                    <IdentityPrimary identity={reqIdentity()} />
                  </div>
                  <div class={`member-role ${approveErrors[req.pubkey] ? "is-error" : ""}`}>
                    <Show when={reqIdentity().secondary}>
                      <span class="member-alias">{reqIdentity().secondary}</span>
                      <span class="member-sep">·</span>
                    </Show>
                    {approveErrors[req.pubkey] || "wants to join"}
                  </div>
                </div>
                <div class="join-request-actions">
                  <button
                    class="join-request-btn approve"
                    onClick={() => handleApprove(req.pubkey, req.ts)}
                    title="Approve - adds them as a member"
                  >
                    {approveErrors[req.pubkey] ? "Retry" : "Approve"}
                  </button>
                  <button
                    class="join-request-btn dismiss"
                    onClick={() => handleDismissRequest(req.pubkey)}
                    title="Hide for now (they can retry)"
                    aria-label="Dismiss"
                  >
                    <IconX />
                  </button>
                </div>
              </div>
            );
            }}
          </For>
        </Show>

        <Show
          when={members().length > 0}
          fallback={
            <Show when={requests().length === 0}>
              <div style={{ "font-size": "11px", color: "var(--text-muted)", padding: "12px 10px", "text-align": "center" }}>
                Loading member list…
              </div>
            </Show>
          }
        >
          <For each={membersWithActivity()}>
            {(m) => {
              const canModerate = () => iAmAdmin();
              const memberIdentity = () => identityPartsVerified(m.pubkey);
              return (
                <div class="member">
                  <div class="member-avatar">
                    <img
                      src={avatarSrc(m.pubkey)}
                      alt=""
                      loading="lazy"
                      onError={() => { const u = profiles[m.pubkey]?.picture; if (u) markAvatarBroken(u); }}
                    />
                  </div>
                  <div class="member-details">
                    <div class="member-handle-row">
                      <span
                        class={`member-handle ${memberIdentity().hasHandle ? "" : "is-npub"}`}
                        style={{ color: memberIdentity().hasHandle ? handleColor(m.pubkey) : "var(--text-secondary)" }}
                        onClick={(e) => { e.stopPropagation(); toggleProfileCard(m.pubkey, e.clientX, e.clientY); }}
                        data-profile-trigger
                        data-tip={memberIdentity().hasHandle ? memberIdentity().primary : undefined}
                      >
                        <IdentityPrimary identity={memberIdentity()} />
                      </span>
                    </div>
                    <div class="member-role">
                      <Show when={memberIdentity().secondary}>
                        <span class="member-alias">{memberIdentity().secondary}</span>
                        <Show when={m.lastSeen}>
                          <span class="member-sep">·</span>
                        </Show>
                      </Show>
                      {m.lastSeen ? timeAgo(m.lastSeen) : memberIdentity().secondary ? "" : "member"}
                    </div>
                  </div>
                  <Show when={canModerate()}>
                    <button
                      class="member-mod-trigger"
                      onClick={(e) => { e.stopPropagation(); setOpenModFor(openModFor() === m.pubkey ? null : m.pubkey); }}
                      title="More - moderation actions"
                      aria-label="More actions"
                    >
                      <IconDotsThreeVertical />
                    </button>
                    <Show when={openModFor() === m.pubkey && props.station}>
                      <div class="member-mod-menu" onClick={(e) => e.stopPropagation()}>
                        <MemberActions
                          station={props.station!}
                          targetPubkey={m.pubkey}
                          onClose={() => setOpenModFor(null)}
                        />
                      </div>
                    </Show>
                  </Show>
                </div>
              );
            }}
          </For>
        </Show>
      </div>

      <div class="proto-footer">
        <div class="proto-row"><span class="proto-dot on" /> station relay connected</div>
        <div class="proto-row"><span class="proto-dot relay" /> {props.station?.relay || "-"}</div>
        <div class="proto-row proto-row-tagline">messages are signed nostr events</div>
        <div class="proto-row proto-row-tagline">handles verified via spaces protocol</div>
      </div>

      <Show when={showAddMember() && props.station}>
        <AddMemberModal
          signer={getSigner()}
          station={props.station!}
          onClose={() => setShowAddMember(false)}
        />
      </Show>
    </div>
  );
}
