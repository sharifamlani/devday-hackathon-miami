/**
 * The Kindred tile: thin border, card fill and a soft yellow (bottom-left)
 * and yellow-green (bottom-right) glow. Local stand-in until the shared
 * `tile` utility lands in index.css; swap this one constant for it then.
 */
export const tile =
  "rounded-[18px] border border-border bg-card " +
  "bg-[image:radial-gradient(85%_55%_at_0%_100%,color-mix(in_oklab,var(--brand)_17%,transparent),transparent_72%),radial-gradient(85%_55%_at_100%_100%,color-mix(in_oklab,color-mix(in_oklab,var(--brand),var(--chart-2)_45%)_20%,transparent),transparent_72%)] " +
  "dark:bg-[image:radial-gradient(85%_55%_at_0%_100%,color-mix(in_oklab,var(--brand)_8%,transparent),transparent_72%),radial-gradient(85%_55%_at_100%_100%,color-mix(in_oklab,color-mix(in_oklab,var(--brand),var(--chart-2)_45%)_8%,transparent),transparent_72%)]";

/** The dark focus card: same glow, stronger, on the primary (ink) fill. */
export const focusCard =
  "rounded-2xl bg-primary text-primary-foreground dark:bg-secondary dark:text-secondary-foreground " +
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
