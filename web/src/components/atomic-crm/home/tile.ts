/**
 * Dashboard tiles use a borderless frosted surface with centered warmth.
 * The shared tile utility remains available to the rest of the app.
 */
export const tile = "tile home-tile";

/** The dark focus card: same glow, stronger, on the primary (ink) fill. */
export const focusCard =
  "rounded-2xl bg-strong text-strong-foreground " +
  "bg-[image:radial-gradient(80%_70%_at_0%_100%,color-mix(in_oklab,var(--brand)_22%,transparent),transparent_70%),radial-gradient(80%_70%_at_100%_100%,color-mix(in_oklab,color-mix(in_oklab,var(--brand),var(--chart-2)_45%)_18%,transparent),transparent_70%)]";

/** Section heading inside a tile. */
export const tileTitle = "text-sm font-semibold";

export const tagTone = {
  alert: "bg-alert text-alert-foreground",
  warn: "bg-warn text-warn-foreground",
  good: "bg-good text-good-foreground",
  quiet: "bg-quiet text-quiet-foreground",
} as const;

export const focusRing =
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";
