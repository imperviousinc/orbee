import { createSignal } from "solid-js";

// Which pubkey's profile is currently taking over the main column, or null
// if the main column is showing a station feed (or one of the other modes).
//
// Set from anywhere a handle/npub is clickable (msg-handle, member-handle,
// reply-ref-author). Cleared when the user picks a station, edits their own
// profile, or hits Esc.
export const [viewingProfile, setViewingProfile] = createSignal<string | null>(null);

export function openProfile(pubkey: string) {
  setViewingProfile(pubkey);
}

export function closeProfile() {
  setViewingProfile(null);
}
