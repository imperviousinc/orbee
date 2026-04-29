import { createSignal } from "solid-js";

/**
 * Floating profile card. Click a handle → the card pops
 * up anchored near the click with avatar + handle + roles + a "Go to
 * profile" button. Clicking elsewhere / Esc closes it.
 *
 * Only one open at a time. Opening a new one replaces the current.
 */
export interface ProfileCardRequest {
  pubkey: string;
  /** Viewport coords of the click - the card positions itself near these. */
  x: number;
  y: number;
}

export const [profileCard, setProfileCard] = createSignal<ProfileCardRequest | null>(null);

export function openProfileCard(pubkey: string, x: number, y: number) {
  setProfileCard({ pubkey, x, y });
}

/**
 * Toggle behavior - if the card is already open for this pubkey, close
 * it; otherwise (closed, or open for a different pubkey) open/swap to
 * this one. Lets a second click on the same handle dismiss the card
 * the user just opened.
 */
export function toggleProfileCard(pubkey: string, x: number, y: number) {
  const cur = profileCard();
  if (cur && cur.pubkey === pubkey) {
    setProfileCard(null);
    return;
  }
  setProfileCard({ pubkey, x, y });
}

export function closeProfileCard() {
  setProfileCard(null);
}
