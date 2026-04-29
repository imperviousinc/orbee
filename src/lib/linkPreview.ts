import { createStore } from "solid-js/store";

const PREVIEW_BASE = "https://preview.orbee.chat";

const URL_REGEX = /https?:\/\/[^\s<>)"]+/g;
const IMAGE_EXT = /\.(jpg|jpeg|png|gif|webp|svg)(\?[^\s]*)?$/i;

export interface LinkCard {
  url: string;
  finalUrl?: string;
  title?: string;
  description?: string;
  siteName?: string;
  image?: string;   // already proxied through preview.orbee.chat/image
  favicon?: string; // already proxied
}

type CacheState = LinkCard | "loading" | "missing";

// Reactive cache so any component can read by URL and re-render on update.
// "missing" = fetch finished but the page had no usable preview (or errored).
const [cache, setCache] = createStore<Record<string, CacheState>>({});

const inflight = new Map<string, Promise<void>>();

export function getPreviewState(url: string): CacheState | undefined {
  return cache[url];
}

/** Extract preview-worthy URLs (skips image URLs - those render as inline media). */
export function extractUrls(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const matches = text.match(URL_REGEX);
  if (!matches) return out;
  for (const raw of matches) {
    // Strip trailing punctuation that's almost never part of a URL.
    const cleaned = raw.replace(/[.,;:!?)]+$/, "");
    if (IMAGE_EXT.test(cleaned)) continue;
    if (seen.has(cleaned)) continue;
    seen.add(cleaned);
    out.push(cleaned);
  }
  return out;
}

/** Kick off a preview fetch (no-op if cached or in-flight). */
export function requestPreview(url: string): void {
  if (cache[url] !== undefined) return;
  if (inflight.has(url)) return;

  setCache(url, "loading");
  const p = (async () => {
    try {
      const res = await fetch(`${PREVIEW_BASE}/?url=${encodeURIComponent(url)}`);
      if (!res.ok) {
        setCache(url, "missing");
        return;
      }
      const data = await res.json();
      const card: LinkCard = {
        url,
        finalUrl: data.finalUrl || undefined,
        title: data.title || undefined,
        description: data.description || undefined,
        siteName: data.siteName || undefined,
        image: data.image || undefined,
        favicon: data.favicon || undefined,
      };
      // Treat fully-empty responses as missing - no point rendering an empty card.
      if (!card.title && !card.description && !card.image) {
        setCache(url, "missing");
        return;
      }
      setCache(url, card);
    } catch {
      setCache(url, "missing");
    } finally {
      inflight.delete(url);
    }
  })();
  inflight.set(url, p);
}

/** NIP-92 imeta-style preview tag. Recipients render directly from this - no refetch. */
export function cardToTag(card: LinkCard): string[] {
  const parts: string[] = ["preview", `url ${card.url}`];
  if (card.title) parts.push(`title ${card.title}`);
  if (card.description) parts.push(`summary ${card.description}`);
  if (card.image) parts.push(`image ${card.image}`);
  if (card.favicon) parts.push(`icon ${card.favicon}`);
  if (card.siteName) parts.push(`site ${card.siteName}`);
  if (card.finalUrl && card.finalUrl !== card.url) parts.push(`final ${card.finalUrl}`);
  return parts;
}

/** Parse a `preview` tag back into a LinkCard. Returns null if no url field. */
export function tagToCard(tag: string[]): LinkCard | null {
  if (tag[0] !== "preview") return null;
  const card: Partial<LinkCard> = {};
  for (let i = 1; i < tag.length; i++) {
    const entry = tag[i];
    const sp = entry.indexOf(" ");
    if (sp < 0) continue;
    const key = entry.slice(0, sp);
    const val = entry.slice(sp + 1);
    switch (key) {
      case "url": card.url = val; break;
      case "title": card.title = val; break;
      case "summary": card.description = val; break;
      case "image": card.image = val; break;
      case "icon": card.favicon = val; break;
      case "site": card.siteName = val; break;
      case "final": card.finalUrl = val; break;
    }
  }
  if (!card.url) return null;
  return card as LinkCard;
}

/** Pull all preview cards out of an event's tags. */
export function previewsFromTags(tags: string[][]): LinkCard[] {
  const out: LinkCard[] = [];
  for (const t of tags) {
    const c = tagToCard(t);
    if (c) out.push(c);
  }
  return out;
}
