/**
 * NIP-65 relay-list lookup (kind:10002).
 *
 * Queries the user's published relay list and returns the URLs they
 * write to (and read from). Used by the Spaces zone publisher so the
 * `addr.nostr` record value can be `[npub, write_relay_1, ...]` -
 * giving Spaces resolvers a hint about where to fetch the user's
 * Nostr events without a separate NIP-05 dance.
 *
 * The kind:10002 event tags look like:
 *   ["r", "wss://relay.example.com"]            ← read+write
 *   ["r", "wss://relay.example.com", "read"]    ← read-only
 *   ["r", "wss://relay.example.com", "write"]   ← write-only
 *
 * We expose write + read separately so callers can choose; for the
 * Spaces nostr addr record, write relays are the right pick (where
 * to find the author's events).
 */

import { profileRelay } from "./nostr";
import type { NostrEvent } from "./keys";

export interface RelayList {
  /** URLs the user reads from (no marker, or "read" marker). */
  read: string[];
  /** URLs the user writes to (no marker, or "write" marker). */
  write: string[];
}

const TIMEOUT_MS = 4_000;

export async function fetchRelayList(pubkey: string): Promise<RelayList | null> {
  return new Promise((resolve) => {
    let latest: NostrEvent | null = null;
    const sub = profileRelay.subscribe(
      { kinds: [10002], authors: [pubkey], limit: 1 },
      (event) => {
        if (!latest || event.created_at > latest.created_at) latest = event;
      },
      () => {
        profileRelay.unsubscribe(sub);
        resolve(latest ? parseRelayList(latest) : null);
      },
    );
    setTimeout(() => {
      profileRelay.unsubscribe(sub);
      resolve(latest ? parseRelayList(latest) : null);
    }, TIMEOUT_MS);
  });
}

function parseRelayList(event: NostrEvent): RelayList {
  const read: string[] = [];
  const write: string[] = [];
  for (const tag of event.tags) {
    if (tag[0] !== "r" || !tag[1]) continue;
    const url = tag[1].trim();
    const marker = tag[2]?.trim();
    if (!marker) { read.push(url); write.push(url); }
    else if (marker === "read") read.push(url);
    else if (marker === "write") write.push(url);
  }
  return { read: dedupe(read), write: dedupe(write) };
}

function dedupe(urls: string[]): string[] {
  return [...new Set(urls)];
}