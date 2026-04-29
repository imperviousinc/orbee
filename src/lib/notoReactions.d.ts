// Ambient types for notoReactions.js - a hand-written library that stays
// as plain JS. Declaration mirrors the runtime surface used by Orbee.
// Particles-only since Lottie was dropped: no renderLottie, no
// getLottieData, no prefetchTop.

export function getCatalog(): Promise<any>;
export function codepointToEmoji(cp: string): string;
export function getRecents(): string[];
export function addRecent(code: string): void;
export function playReaction(
  target: HTMLElement,
  opts?: { code?: string; emoji?: string; nativeSel?: string; [k: string]: any },
): Promise<void>;

export class EmojiPicker {
  constructor(opts?: {
    onPick?: (r: { code: string; emoji: string }) => void;
    [k: string]: any;
  });
  open(anchor: HTMLElement, options?: { container?: HTMLElement; [k: string]: any }): void;
  close(): void;
  toggle(anchor: HTMLElement): void;
  [k: string]: any;
}
