import { useSyncExternalStore } from "react";

/**
 * One motion system for the whole app.
 *
 * The values live in CSS (src/index.css, "Motion"): three speeds, three easing curves and
 * --motion-scale, which every duration is multiplied by. Change a speed or a curve there and
 * every animation follows; set --motion-scale to 2 for a slow-motion demo, 0 for none.
 *
 * The person's choice ("Reduce motion" in the profile menu) is stored here and written to
 * <html data-motion="system|reduce|full">: "reduce" sets the scale to 0 and stops looping
 * animations; "system" follows the operating system's reduce-motion setting; "full" keeps
 * motion on even when the system asks to reduce it.
 */
export type MotionPreference = "system" | "reduce" | "full";
export type MotionSpeed = "fast" | "base" | "slow";

export const MOTION_PREFERENCES: readonly MotionPreference[] = [
  "system",
  "reduce",
  "full",
];
export const MOTION_STORAGE_KEY = "donordesk.motion";

/** The CSS defaults, used if the stylesheet can't be read (tests, SSR). */
const DEFAULT_MS: Record<MotionSpeed, number> = { fast: 120, base: 200, slow: 320 };

const isPreference = (value: unknown): value is MotionPreference =>
  MOTION_PREFERENCES.includes(value as MotionPreference);

export const readMotionPreference = (): MotionPreference => {
  try {
    const stored = window.localStorage.getItem(MOTION_STORAGE_KEY);
    return isPreference(stored) ? stored : "system";
  } catch {
    return "system";
  }
};

/** Puts the choice on <html>, where the CSS reads it. Call once before the first render. */
export const applyMotionPreference = (
  preference: MotionPreference,
  root: HTMLElement = document.documentElement,
) => {
  root.dataset.motion = preference;
};

const listeners = new Set<() => void>();

export const setMotionPreference = (preference: MotionPreference) => {
  try {
    window.localStorage.setItem(MOTION_STORAGE_KEY, preference);
  } catch {
    // Private mode or blocked storage: the choice still applies to this page.
  }
  applyMotionPreference(preference);
  listeners.forEach((listener) => listener());
};

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  const media = window.matchMedia?.("(prefers-reduced-motion: reduce)");
  media?.addEventListener?.("change", listener);
  return () => {
    listeners.delete(listener);
    media?.removeEventListener?.("change", listener);
  };
};

const currentPreference = (): MotionPreference => {
  const value = document.documentElement.dataset.motion;
  return isPreference(value) ? value : "system";
};

/** The person's choice, kept in sync across the menus that show it. */
export const useMotionPreference = (): MotionPreference =>
  useSyncExternalStore(subscribe, currentPreference, () => "system");

/**
 * Should motion be reduced right now? "reduce" always; "full" never; "system" when the
 * operating system asks for it. JavaScript-driven motion (View Transitions, rAF loops) uses this.
 */
export const prefersReducedMotion = (
  win: Window = window,
  preference: MotionPreference = currentPreference(),
): boolean => {
  if (preference === "reduce") return true;
  if (preference === "full") return false;
  return !!win.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
};

/** "320ms" or "0.32s" → 320; NaN when it isn't a time. */
export const parseTimeMs = (value: string): number => {
  const text = value.trim();
  const number = parseFloat(text);
  if (Number.isNaN(number)) return NaN;
  return text.endsWith("ms") ? number : text.endsWith("s") ? number * 1000 : NaN;
};

/**
 * A speed from the CSS variables, in milliseconds, already multiplied by --motion-scale
 * (so 0 when motion is reduced). For timings set from JavaScript.
 */
export const motionMs = (
  speed: MotionSpeed,
  root: HTMLElement = document.documentElement,
): number => {
  const style = getComputedStyle(root);
  const base = parseTimeMs(style.getPropertyValue(`--duration-${speed}`));
  const scale = parseFloat(style.getPropertyValue("--motion-scale"));
  return Math.round(
    (Number.isNaN(base) ? DEFAULT_MS[speed] : base) *
      (Number.isNaN(scale) ? 1 : scale),
  );
};
