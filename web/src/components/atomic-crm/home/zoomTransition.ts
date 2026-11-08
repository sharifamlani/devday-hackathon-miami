/**
 * Zoom transition runner (FLIP). The new state is rendered at its final layout at once, then
 * only `transform` and `opacity` are animated through the Web Animations API, so the work stays
 * on the compositor: no layout, paint or snapshot capture per frame. View Transitions are not
 * used for open/close: their per-frame snapshot compositing missed the 17.5 ms frame budget.
 *
 *  open   the panel frame grows from the box of the tile; a ghost copy of the overview fades
 *         out; panel content fades in once the frame is nearly full size (text never scaled).
 *  close  a ghost frame (empty shell + toolbar) shrinks into the tile; the overview fades in.
 *  switch the body crossfades inside the persistent frame.
 *  The chat column snaps to its new width once and glides there with translateX only.
 */
import { notifyManager } from "@tanstack/react-query";
import { motionMs, prefersReducedMotion as reducedMotion } from "@/lib/motion";

/** open/close/switch: workspace panels (FLIP). overview: the left column. pane: the right Ask/transcript pane (both View Transitions, zoom.css). */
export type ZoomKind = "open" | "close" | "switch" | "overview" | "pane";

type FlipDoc = {
  documentElement: HTMLElement;
  querySelector: (sel: string) => Element | null;
  body?: HTMLElement;
};

/** The tile each workspace zooms out of / back into. */
const TILE: Record<string, string> = {
  calendar: '[data-zoom-source="calendar"]',
  tasks: '[data-zoom-source="tasks"]',
  crm: '[data-zoom-source="crm"]',
  impact: '[data-zoom-source="impact"]',
};

export const EASE = "cubic-bezier(0.32,0.72,0,1)";
/** Read from the motion variables (src/index.css) at each transition, so one edit retimes them all. */
const duration = (kind: ZoomKind, exit = false): number => {
  const slow = motionMs("slow");
  // An exiting overview or pane closes faster (--exit-ratio). The panel close keeps its own
  // staged timing, tuned with the FLIP choreography (#214).
  if (exit) return Math.round(slow * exitRatio());
  if (kind === "close") return Math.round(slow * 0.875);
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

/**
 * Query results that land mid-zoom would re-render the whole Home tree (100+ ms) inside the
 * animation. Hold React Query's notifications while a zoom runs and release them just after.
 */
let held: Array<() => void> = [];
let schedulerInstalled = false;
function installNotifyHold() {
  if (schedulerInstalled) return;
  schedulerInstalled = true;
  notifyManager.setScheduler((cb) => {
    if (active) held.push(cb);
    else setTimeout(cb, 0);
  });
}
function releaseHeld() {
  const cbs = held;
  held = [];
  if (cbs.length) setTimeout(() => cbs.forEach((cb) => cb()), 120);
}

/**
 * Close, step 1: the panel body unmounts on its own frame, hidden under the ghost frame, so the
 * layout swap that follows is not also paying for the unmount (one 30-45 ms frame became two
 * ~15-20 ms frames).
 */
const closingListeners = new Set<() => void>();
export function isZoomActive() {
  return !!active;
}

/**
 * The panel is unmounting and no zoom is running (browser Back/Forward): play the close shrink
 * anyway. Called from the frame's layout-effect cleanup, while its DOM is still attached.
 */
export function closeAfterHistoryNav() {
  if (active) return;
  runZoomTransition({ kind: "close", update: () => {}, preUnmount: false });
}

export function onZoomClosing(fn: () => void) {
  closingListeners.add(fn);
  return () => {
    closingListeners.delete(fn);
  };
}

type Active = { done: () => void };
let active: Active | null = null;
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

/** Ends a running zoom at its final state (never queues) and removes its ghosts. */
export function interruptZoom() {
  active?.done();
}

const has = (r: DOMRect | null): r is DOMRect =>
  !!r && r.width > 0 && r.height > 0;
const rectOf = (el: Element | null | undefined) =>
  el ? el.getBoundingClientRect() : null;

/** transform that maps the box `to` onto the box `from` (both anchored top-left). */
function invert(from: DOMRect, to: DOMRect) {
  return `translate(${from.left - to.left}px, ${from.top - to.top}px) scale(${from.width / to.width}, ${from.height / to.height})`;
}

const radiusOf = (el: Element | null | undefined, fallback = 20) => {
  const r = el ? parseFloat(getComputedStyle(el).borderTopLeftRadius) : NaN;
  return Number.isNaN(r) ? fallback : r;
};
/** border-radius that reads as `radius` px once the box is scaled from `big` to `small` (paint only). */
const radiusAfterScale = (radius: number, small: DOMRect, big: DOMRect) =>
  `${radius / (small.width / big.width)}px / ${radius / (small.height / big.height)}px`;

function ghostOf(
  src: Element,
  rect: DOMRect,
  deep: boolean,
  host: HTMLElement,
): HTMLElement {
  const g = src.cloneNode(deep) as HTMLElement;
  g.removeAttribute("id");
  g.removeAttribute("hidden");
  g.querySelectorAll("[id]").forEach((n) => n.removeAttribute("id"));
  g.setAttribute("aria-hidden", "true");
  g.setAttribute("inert", "");
  g.dataset.zoomGhost = "1";
  Object.assign(g.style, {
    position: "fixed",
    left: `${rect.left}px`,
    top: `${rect.top}px`,
    width: `${rect.width}px`,
    height: `${rect.height}px`,
    margin: "0",
    zIndex: "45",
    pointerEvents: "none",
    transformOrigin: "0 0",
  });
  host.append(g);
  return g;
}

type VT = {
  skipTransition: () => void;
  finished: Promise<unknown>;
  ready?: Promise<unknown>;
  updateCallbackDone?: Promise<unknown>;
};
type VTDoc = FlipDoc & {
  startViewTransition?: (cb: () => void | Promise<void>) => VT;
};
let activeVT: VT | null = null;

/**
 * overview (left column) and pane (right Ask pane) slide in and out through a View Transition
 * (named layers in zoom.css). Workspace panels use the FLIP path above instead.
 */
function runViewTransition(opts: {
  kind: ZoomKind;
  update: () => void | Promise<void>;
  exit?: boolean;
  doc?: FlipDoc;
  win?: Window;
}): { mechanism: "instant" | "view-transition" } {
  const doc = (opts.doc ?? document) as VTDoc;
  const win = opts.win ?? window;
  const { kind, update } = opts;
  interruptZoom();
  if (typeof doc.startViewTransition !== "function") {
    update();
    return { mechanism: "instant" };
  }
  // Never queue: a running transition is skipped, the new one starts immediately.
  activeVT?.skipTransition();
  activeVT = null;
  const reduced = prefersReducedMotion(win);
  const root = doc.documentElement;
  root.dataset.zoom = reduced ? "fade" : kind;
  root.style.setProperty(
    "--zoom-dur",
    `${reduced ? REDUCED_FADE_MS : duration(kind, opts.exit)}ms`,
  );
  const vt = doc.startViewTransition(async () => {
    await update();
  });
  activeVT = vt;
  // A skipped transition rejects ready/updateCallbackDone; that is expected, not an error.
  vt.ready?.catch(() => {});
  vt.updateCallbackDone?.catch(() => {});
  const cleanup = () => {
    if (activeVT === vt) activeVT = null;
    delete root.dataset.zoom;
  };
  vt.finished.then(cleanup, cleanup);
  return { mechanism: "view-transition" };
}

export function runZoomTransition(opts: {
  kind: ZoomKind;
  update: () => void | Promise<void>;
  /** The overview or pane is going away: time it as a close (see --exit-ratio). */
  exit?: boolean;
  /** false when the DOM is about to change anyway (browser Back): skip the staged unmount. */
  preUnmount?: boolean;
  sourceEl?: HTMLElement | null;
  /** The workspace being opened/closed: finds its tile when no sourceEl is given. */
  view?: string | null;
  doc?: FlipDoc;
  win?: Window;
}): { mechanism: "flip" | "instant" | "view-transition" } {
  const doc = (opts.doc ?? document) as FlipDoc;
  const win = opts.win ?? window;
  const { kind, update } = opts;
  const root = doc.documentElement;
  const host = doc.body ?? root;

  installNotifyHold();
  if (kind === "overview" || kind === "pane") return runViewTransition(opts);
  activeVT?.skipTransition();
  interruptZoom();
  if (
    typeof (host as Partial<HTMLElement>).animate !== "function" ||
    typeof (host as Partial<HTMLElement>).cloneNode !== "function"
  ) {
    update();
    return { mechanism: "instant" };
  }

  const reduced = prefersReducedMotion(win);
  const dur = reduced ? REDUCED_FADE_MS : duration(kind);
  // short fixed timings (tile fade, content fade) follow --motion-scale like every other speed
  const scale = parseFloat(
    getComputedStyle(root).getPropertyValue("--motion-scale"),
  );
  const ms = (n: number) => Math.round(n * (Number.isNaN(scale) ? 1 : scale));
  const phone = !!win.matchMedia?.("(max-width: 767px)").matches;
  const viewName = opts.view ?? null;
  const tileOf = (v: string | null | undefined) => {
    const sel = v ? TILE[v] : undefined;
    return sel ? (doc.querySelector(sel) as HTMLElement | null) : null;
  };
  const resolveSource = (v: string | null | undefined = viewName) => {
    const el = opts.sourceEl?.isConnected
      ? opts.sourceEl
      : (tileOf(v) ?? (lastSource?.isConnected ? lastSource : null));
    if (el) lastSource = el;
    return el;
  };
  const q = (s: string) => doc.querySelector(s) as HTMLElement | null;

  // ---- first: measure before the state changes
  const chat0 = rectOf(q(".home-conversation"));
  const panel0 = q(".desk-main-panel");
  const panelRect0 = rectOf(panel0);
  const ghosts: HTMLElement[] = [];
  const anims: Animation[] = [];
  const timing = (
    delay = 0,
    d = dur,
    easing = EASE,
  ): KeyframeAnimationOptions => ({ duration: d, delay, easing, fill: "both" });
  const run = (
    el: HTMLElement | null,
    kf: Keyframe[],
    o: KeyframeAnimationOptions,
  ) => {
    if (el) anims.push(el.animate(kf, o));
  };
  const fade: Keyframe[] = [{ opacity: 0 }, { opacity: 1 }];

  // The ghosts must exist before the old DOM leaves.
  let closeGhost: HTMLElement | null = null;
  if (kind === "close" && !reduced && panel0 && has(panelRect0)) {
    closeGhost = ghostOf(panel0, panelRect0, false, host);
    const bar = panel0.querySelector(".desk-panel-toolbar");
    if (bar) closeGhost.append(bar.cloneNode(true));
    // a faint copy of the first rows, so the card is not blank while it shrinks (skipped for big
    // bodies: cloning them would cost frames)
    const body = panel0.querySelector(".desk-panel-body");
    if (body && body.querySelectorAll("*").length <= 300) {
      closeGhost.append(body.cloneNode(true));
    }
    ghosts.push(closeGhost);
  }
  // Open: only the source tile is copied (the panel starts exactly on it and the tile content
  // fades out over it); copying the whole overview cost ~15 ms of layout in the first frame.
  let openGhost: HTMLElement | null = null;
  const source0 = kind === "open" ? resolveSource() : null;
  source0?.scrollIntoView?.({ block: "nearest", behavior: "instant" });
  const tileRect0 = rectOf(source0);
  if (kind === "open" && !reduced && !phone && source0 && has(tileRect0)) {
    openGhost = ghostOf(source0, tileRect0, true, host);
    ghosts.push(openGhost);
  }

  root.dataset.zoom = reduced ? "fade" : kind;
  root.style.setProperty("--zoom-dur", `${dur}ms`);

  // ---- update. The router commits asynchronously (React transition), so the final layout
  // is only measured once the layout effect in useWorkspaceView reports the commit; the
  // microtask runs before the next paint, so the first painted frame is already inverted.
  let finished = false;
  let touched: Array<HTMLElement | null> = [];
  const me: Active = {
    done: () => {
      if (finished) return;
      finished = true;
      if (active === me) active = null;
      anims.forEach((a) => {
        try {
          a.cancel();
        } catch {
          /* already gone */
        }
      });
      ghosts.forEach((g) => g.remove());
      touched.forEach((el) => {
        if (el) {
          el.style.willChange = "";
          el.style.transformOrigin = "";
        }
      });
      delete root.dataset.zoom;
      releaseHeld();
    },
  };
  active = me;
  const committed = waitForCommit(500);
  if (
    kind === "close" &&
    closeGhost &&
    opts.preUnmount !== false &&
    closingListeners.size
  ) {
    closingListeners.forEach((f) => f());
    // two frames: let the unmount paint (under the ghost) before the layout swap
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        if (!finished) update();
      }),
    );
  } else {
    update();
  }

  const play = () => {
    if (finished) return;
    // Nothing to land on (left Home, or the panel is still mounted): drop the ghost.
    if (
      kind === "close" &&
      (q(".desk-main-panel:not([data-zoom-ghost])") || !q(".home-board"))
    ) {
      me.done();
      return;
    }
    const panel1 = q(".desk-main-panel");
    const chatEl = q(".home-conversation");
    const chat1 = rectOf(chatEl);
    const panelRect1 = rectOf(panel1);
    const overview1 = q(".home-overview");
    touched = [panel1, overview1, chatEl];
    const promote = (el: HTMLElement | null) => {
      if (el) el.style.willChange = "transform, opacity";
    };

    // ---- invert + play
    if (reduced) {
      run(
        kind === "close" ? overview1 : panel1,
        fade,
        timing(0, dur, "linear"),
      );
    } else if (kind === "switch") {
      run(q(".desk-panel-body"), fade, timing(0, dur, "linear"));
    } else if (kind === "open" && panel1 && has(panelRect1)) {
      promote(panel1);
      const tileRect = tileRect0;
      const from = phone
        ? "translateY(100%)"
        : has(tileRect)
          ? invert(tileRect, panelRect1)
          : "scale(0.94)";
      panel1.style.transformOrigin = "0 0";
      const rPanel = radiusOf(panel1);
      const rStart =
        !phone && has(tileRect)
          ? radiusAfterScale(radiusOf(source0), tileRect, panelRect1)
          : `${rPanel}px`;
      run(
        panel1,
        [
          { transform: from, borderRadius: rStart },
          { transform: "none", borderRadius: `${rPanel}px` },
        ],
        timing(),
      );
      // content appears once the frame is nearly full size, so text is never shown scaled
      panel1
        .querySelectorAll<HTMLElement>(".desk-panel-toolbar,.desk-panel-body")
        .forEach((c) => run(c, fade, timing(dur * 0.6, dur * 0.4, "linear")));
      run(
        openGhost,
        [{ opacity: 1 }, { opacity: 0 }],
        timing(0, ms(120), "linear"),
      );
    } else if (kind === "close") {
      if (closeGhost && has(panelRect0)) {
        const tile = resolveSource(panel0?.dataset.workspace);
        // keep the tile in view: the shrink must land on something the user can see
        tile?.scrollIntoView?.({ block: "nearest", behavior: "instant" });
        const tileRect = rectOf(tile);
        const to = phone
          ? "translateY(100%)"
          : has(tileRect)
            ? invert(tileRect, panelRect0)
            : "scale(0.94)";
        promote(closeGhost);
        // the corners travel too: they end at the tile's radius once the frame is scaled
        const rPanel = radiusOf(panel0);
        const rEnd =
          !phone && has(tileRect)
            ? radiusAfterScale(radiusOf(tile), tileRect, panelRect0)
            : `${rPanel}px`;
        run(
          closeGhost,
          [
            {
              transform: "none",
              opacity: 1,
              borderRadius: `${rPanel}px`,
              easing: EASE,
            },
            { transform: to, opacity: 1, borderRadius: rEnd, offset: 0.9 },
            { transform: to, opacity: 0, borderRadius: rEnd },
          ],
          // the curve eases the shrink over 90% of the time; the last 10% fades the frame out
          timing(0, dur, "linear"),
        );
        closeGhost
          .querySelectorAll<HTMLElement>(".desk-panel-toolbar,.desk-panel-body")
          .forEach((c) =>
            run(
              c,
              [{ opacity: 1 }, { opacity: 0 }],
              timing(0, ms(110), "linear"),
            ),
          );
      }
      promote(overview1);
      run(overview1, fade, timing(dur * 0.45, dur * 0.5, "linear"));
    }

    // chat column: its width snapped above; glide the left edge with translateX only
    if (!reduced && kind !== "switch" && has(chat0) && has(chat1)) {
      const dx = chat0.left - chat1.left;
      if (chatEl && Math.abs(dx) > 1) {
        promote(chatEl);
        // The width snapped to its final value at the commit; while it travels, show only the
        // part that was visible before (clip-path is paint-only), so a column that grows never
        // pokes past the right edge of the page mid-glide.
        const grow = Math.max(0, chat1.width - chat0.width);
        run(
          chatEl,
          [
            {
              transform: `translateX(${dx}px)`,
              opacity: 0.2,
              clipPath: `inset(0 ${grow}px 0 0)`,
            },
            { transform: "none", opacity: 1, clipPath: "inset(0 0 0 0)" },
          ],
          timing(),
        );
      }
    }

    Promise.all(anims.map((a) => a.finished)).then(me.done, () => {});
    if (!anims.length) me.done();
  };
  void committed.then(play);
  return { mechanism: "flip" };
}
