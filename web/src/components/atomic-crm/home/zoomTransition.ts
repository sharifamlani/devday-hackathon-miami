/**
 * Zoom transition runner: wraps a state update in document.startViewTransition.
 * react-router's own `viewTransition` option is not used: the app runs on react-admin's
 * HashRouter (a declarative router), where that option is not honored.
 */
import { motionMs, prefersReducedMotion as reducedMotion } from "@/lib/motion";

/** open/close/switch: workspace panels. overview: the left column. pane: the right Ask/transcript pane. */
export type ZoomKind = "open" | "close" | "switch" | "overview" | "pane";

type VT = {
  skipTransition: () => void;
  finished: Promise<unknown>;
  ready?: Promise<unknown>;
  updateCallbackDone?: Promise<unknown>;
};
type VTDoc = {
  startViewTransition?: (cb: () => void | Promise<void>) => VT;
  documentElement: HTMLElement;
};

export const FRAME_NAME = "zoom-frame";
/** Read from the motion variables (src/index.css) at each transition, so one edit retimes them all. */
const duration = (kind: ZoomKind, exit = false): number => {
  const slow = motionMs("slow");
  if (kind === "close" || exit) return Math.round(slow * exitRatio());
  if (kind === "switch") return Math.round(motionMs("base") * 0.9);
  return slow;
};
/** --exit-ratio (index.css): closing takes this share of opening's time. */
const exitRatio = (root: HTMLElement = document.documentElement): number => {
  const value = parseFloat(
    getComputedStyle(root).getPropertyValue("--exit-ratio"),
  );
  return Number.isNaN(value) ? 0.75 : value;
};
/** Reduced motion: a short crossfade instead of movement. */
const REDUCED_FADE_MS = 120;

let active: VT | null = null;
let lastSource: HTMLElement | null = null;
let commitWaiters: Array<() => void> = [];

export function getLastSource() {
  return lastSource;
}

/** Resolves when notifyCommitted() fires (or after timeoutMs, so a transition never hangs). */
export function waitForCommit(timeoutMs = 600): Promise<void> {
  return new Promise((resolve) => {
    const t = setTimeout(done, timeoutMs);
    function done() {
      clearTimeout(t);
      commitWaiters = commitWaiters.filter((w) => w !== done);
      resolve();
    }
    commitWaiters.push(done);
  });
}

export function notifyCommitted() {
  const waiters = commitWaiters;
  commitWaiters = [];
  waiters.forEach((w) => w());
}

/** The "Reduce motion" choice, falling back to the OS setting (src/lib/motion.ts). */
export function prefersReducedMotion(win: Window = window) {
  return reducedMotion(win);
}

export function runZoomTransition(opts: {
  kind: ZoomKind;
  update: () => void | Promise<void>;
  /** The overview or pane is going away: time it as a close (see --exit-ratio). */
  exit?: boolean;
  sourceEl?: HTMLElement | null;
  doc?: VTDoc;
  win?: Window;
}): { mechanism: "view-transition" | "instant" } {
  const doc = (opts.doc ?? document) as VTDoc;
  const win = opts.win ?? window;
  const { kind, update } = opts;

  if (typeof doc.startViewTransition !== "function") {
    update();
    return { mechanism: "instant" };
  }

  // Never queue: a running transition is skipped, the new one starts immediately.
  if (active) {
    active.skipTransition();
    active = null;
  }

  const reduced = prefersReducedMotion(win);
  const root = doc.documentElement;
  root.dataset.zoom = reduced ? "fade" : kind;
  root.style.setProperty(
    "--zoom-dur",
    `${reduced ? REDUCED_FADE_MS : duration(kind, opts.exit)}ms`,
  );

  const morph = !reduced && kind !== "switch";
  if (opts.sourceEl) lastSource = opts.sourceEl;
  const source = morph ? (opts.sourceEl ?? lastSource) : null;
  // open: name the tile so the old snapshot is the tile; the panel carries the name in CSS.
  if (source && kind === "open") source.style.viewTransitionName = FRAME_NAME;

  const vt = doc.startViewTransition(async () => {
    if (source && kind === "open") source.style.viewTransitionName = "";
    await update();
    // close: hand the name to the tile so the new snapshot is the tile.
    if (source && kind === "close" && source.isConnected) {
      source.style.viewTransitionName = FRAME_NAME;
    }
  });
  active = vt;
  // A skipped transition rejects ready/updateCallbackDone; that is expected, not an error.
  vt.ready?.catch(() => {});
  vt.updateCallbackDone?.catch(() => {});
  const cleanup = () => {
    if (active === vt) active = null;
    if (source) source.style.viewTransitionName = "";
    delete root.dataset.zoom;
  };
  vt.finished.then(cleanup, cleanup);
  return { mechanism: "view-transition" };
}
