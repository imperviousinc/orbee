import { Show, For, JSX } from "solid-js";
import {
  stations,
  stationKey,
  isAdminOf,
  promoteToAdmin,
  kickUser,
  addUser,
  assignRoles,
  getMemberRoles,
  type StationRef,
} from "../lib/stations";
import { getSigner } from "../lib/auth";
import { displayName } from "../lib/profiles";
import { confirmDialog, promptDialog } from "../lib/dialog";

/**
 * The shared admin-actions block for a single target user. Rendered inside
 * both the message-row ⋯ menu and the right-sidebar member ⋯ menu - so the
 * two menus stay in lockstep on what an admin can do (promote, kick,
 * re-add, role assign/remove).
 *
 * Context-specific items (e.g. "Delete message") are slotted in via the
 * `prepend` prop instead of being baked in here.
 */
export default function MemberActions(props: {
  station: StationRef;
  targetPubkey: string;
  onClose: () => void;
  /** Items rendered above the shared ones (e.g. message-only actions). */
  prepend?: JSX.Element;
}) {
  const mySigner = () => getSigner();
  const myPubkey = () => mySigner().pubkey;
  const data = () => stations[stationKey(props.station)];
  const isMe = () => props.targetPubkey === myPubkey();
  const isAdmin = () => !!data()?.admins.includes(props.targetPubkey);
  const isMember = () => !!data()?.members.includes(props.targetPubkey);
  const iAmAdmin = () => isAdminOf(props.station, myPubkey());

  // Demote / kick only make sense for non-admin members.
  const canActOnMember = () => iAmAdmin() && !isMe() && !isAdmin() && isMember();
  // Re-add for users who were kicked or never joined.
  const canReadd = () => iAmAdmin() && !isMe() && !isMember();
  // Roles are open to ANY target the viewer can administrate - including
  // self. (kick/promote stay non-self so an admin can't accidentally
  // demote themselves; labelling yourself "host" is harmless.)
  const canManageRoles = () => iAmAdmin();

  const roles = () => getMemberRoles(props.station, props.targetPubkey);
  const label = () => displayName(props.targetPubkey);

  async function handlePromote() {
    props.onClose();
    const ok = await confirmDialog({
      title: `Make ${label()} an admin?`,
      body: "They'll be able to kick, promote, and edit station settings.",
      confirmLabel: "Make admin",
    });
    if (!ok) return;
    const result = await promoteToAdmin(mySigner(), props.station, props.targetPubkey);
    if (!result.ok) console.error("Promote rejected by relay:", result.message);
  }

  async function handleKick() {
    props.onClose();
    const ok = await confirmDialog({
      title: `Kick ${label()}?`,
      body: "They'll have to request access to rejoin (closed station) or you can re-add them.",
      confirmLabel: "Kick",
      destructive: true,
    });
    if (!ok) return;
    const result = await kickUser(mySigner(), props.station, props.targetPubkey);
    if (!result.ok) console.error("Kick rejected by relay:", result.message);
  }

  async function handleReadd() {
    props.onClose();
    const result = await addUser(mySigner(), props.station, props.targetPubkey);
    if (!result.ok) console.error("Add user rejected by relay:", result.message);
  }

  async function handleAddRole() {
    props.onClose();
    const raw = await promptDialog({
      title: "Add role",
      body: `Give ${label()} a custom role label.`,
      placeholder: "moderator, host, …",
      confirmLabel: "Add",
    });
    const role = raw?.trim();
    if (!role) return;
    const current = roles();
    if (current.includes(role)) return;
    const next = [...current, role];
    if (isAdmin()) next.push("admin");
    const result = await assignRoles(mySigner(), props.station, props.targetPubkey, next);
    if (!result.ok) console.error("Assign role rejected:", result.message);
  }

  async function handleRemoveRole(role: string) {
    props.onClose();
    const next = roles().filter((r) => r !== role);
    if (isAdmin()) next.push("admin");
    const result = await assignRoles(mySigner(), props.station, props.targetPubkey, next);
    if (!result.ok) console.error("Remove role rejected:", result.message);
  }

  return (
    <>
      <div class="msg-mod-heading">Admin actions</div>
      {props.prepend}
      <Show when={canActOnMember()}>
        <button class="msg-mod-item" onClick={handlePromote}>
          Make admin
        </button>
        <button class="msg-mod-item" onClick={handleKick}>
          Kick user
        </button>
      </Show>
      <Show when={canReadd()}>
        <button class="msg-mod-item" onClick={handleReadd}>
          Add user back
        </button>
      </Show>
      <Show when={canManageRoles()}>
        <For each={roles()}>
          {(role) => (
            <button class="msg-mod-item" onClick={() => handleRemoveRole(role)}>
              Remove role: {role}
            </button>
          )}
        </For>
        <button class="msg-mod-item" onClick={handleAddRole}>
          Add role…
        </button>
      </Show>
    </>
  );
}
