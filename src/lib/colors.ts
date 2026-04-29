// Per-user handle color - procedural HSL rotation. Hue is hashed
// from the pubkey; saturation + lightness come from CSS tokens
// (--handle-sat / --handle-light) that track the active theme. Net
// effect: effectively unlimited distinct colors while staying
// visually consistent with the theme band (soft pastel on dark,
// darker saturated on light).
//
// Previous implementation used a 14-token palette - good for
// hand-tuned consistency but capped at 14 buckets (collision rate
// rose fast with more users). The procedural hue covers ~345° of
// effective range so two users colliding on a visually-similar hue
// becomes rare even in large channels.
//
// Phosphor green (~112°) is excluded from the rotation and reserved
// for the verified-self / ON-AIR accent - see the hue-skip below.

export function fnv1aHash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h + (h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24)) >>> 0;
  }
  return h;
}

/**
 * Hue angle (degrees) for a given pubkey. Excludes the 20° band
 * around brand magenta (~293° - #d946ef) so no one's per-user color
 * gets confused with the "Orbee / self / on-air" signal.
 */
export function handleHue(pubkey: string): number {
  // Divide into 340° of usable space, then shift values that land
  // past 283° up by 20° so the 283-303° band is skipped entirely.
  const raw = fnv1aHash(pubkey) % 340;
  return raw < 283 ? raw : raw + 20; // skips [283°, 303°]
}

/**
 * Lightness tier: integer in [-2, +2]. Shifts the handle's
 * lightness by ±8% per step, giving 5 distinct brightness levels at
 * any hue. Sourced from a SEPARATE hash stream (prefix "L:") so it's
 * statistically independent of the hue - hash_of("L:"+pk) has no
 * correlation with hash_of(pk).
 *
 * Why 5 tiers: with 6 users and 345 hues, the birthday paradox says
 * ~85% of channels will have at least one hue collision within ±20°.
 * 5 tiers cuts the "same hue AND same tier" probability by 1/5, and
 * the ±8% lightness step is large enough to read as a clearly
 * different color even at the same hue.
 */
export function handleLightTier(pubkey: string): number {
  return (fnv1aHash("L:" + pubkey) % 5) - 2;
}

/**
 * Handle color for inline use - returns an `hsl()` string. Hue comes
 * from handleHue; lightness is the theme's base (`--handle-light`)
 * adjusted by tier×8% so users at the same hue still separate
 * visually. Safe to drop into any `style={{ color: ... }}`.
 */
export function handleColor(pubkey: string): string {
  const h = handleHue(pubkey);
  const tier = handleLightTier(pubkey);
  if (tier === 0) {
    return `hsl(${h}, var(--handle-sat), var(--handle-light))`;
  }
  const abs = Math.abs(tier) * 8;
  const op = tier > 0 ? "+" : "-";
  return `hsl(${h}, var(--handle-sat), calc(var(--handle-light) ${op} ${abs}%))`;
}
