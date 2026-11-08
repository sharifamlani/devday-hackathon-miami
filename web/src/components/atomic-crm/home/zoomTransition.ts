/**
 * Zoom transition runner: wraps a state update in document.startViewTransition.
 * react-router's own `viewTransition` option is not used: the app runs on react-admin's
 * HashRouter (a declarative router), where that option is not honored.
 */
export type ZoomKind = "open" | "close" | "switch";

type VT = { skipTransition: () => void; finished: Promise<unknown> };
type VTDoc = {
  startViewTransition?: (cb: () => void | Promise<void>) => VT;
  documentElement: HTMLElement;
};

export const FRAME_NAME = "zoom-frame";
const DURATION: Record<ZoomKind, number> = {
  open: 340,
  close: 280,
  switch: 180,
};

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

export function prefersReducedMotion(win: Window = window) {
  return !!win.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

export function runZoomTransition(opts: {
  kind: ZoomKind;
  update: () => void | Promise<void>;
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
  root.style.setProperty("--zoom-dur", `${reduced ? 120 : DURATION[kind]}ms`);

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
  const cleanup = () => {
    if (active === vt) active = null;
    if (source) source.style.viewTransitionName = "";
    delete root.dataset.zoom;
  };
  vt.finished.then(cleanup, cleanup);
  return { mechanism: "view-transition" };
}
