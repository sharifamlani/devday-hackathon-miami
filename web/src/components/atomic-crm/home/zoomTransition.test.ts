import { describe, expect, it, vi } from "vitest";
import {
  interruptZoom,
  notifyCommitted,
  runZoomTransition,
} from "./zoomTransition";

const win = (reduced: boolean) =>
  ({
    matchMedia: (q: string) => ({ matches: reduced && q.includes("reduced") }),
  }) as unknown as Window;

/** A document with no Web Animations support (element.animate is undefined in jsdom). */
function plainDoc() {
  const body = document.createElement("div");
  (body as unknown as { animate?: unknown }).animate = undefined;
  return {
    documentElement: document.createElement("html"),
    querySelector: () => null,
    body,
  };
}
function animDoc() {
  const body = document.createElement("div");
  const animate = vi.fn(() => ({
    cancel: vi.fn(),
    finished: new Promise(() => {}),
  }));
  (body as unknown as { animate: unknown }).animate = animate;
  return {
    doc: {
      documentElement: document.createElement("html"),
      querySelector: () => null,
      body,
    },
    animate,
  };
}

/** A document with View Transitions, for the overview/pane slides. */
function makeVTDoc() {
  const transitions: { skip: ReturnType<typeof vi.fn> }[] = [];
  const doc = {
    documentElement: document.createElement("html"),
    querySelector: () => null,
    startViewTransition: (cb: () => unknown) => {
      void cb;
      const t = { skip: vi.fn() };
      transitions.push(t);
      return { skipTransition: t.skip, finished: new Promise(() => {}) };
    },
  };
  return { doc, transitions };
}

describe("overview and pane slides (View Transitions)", () => {
  it("use the slow speed and mark the root", () => {
    for (const kind of ["overview", "pane"] as const) {
      const { doc } = makeVTDoc();
      const r = runZoomTransition({
        kind,
        update: () => {},
        doc,
        win: win(false),
      });
      expect(r.mechanism).toBe("view-transition");
      expect(doc.documentElement.dataset.zoom).toBe(kind);
      expect(doc.documentElement.style.getPropertyValue("--zoom-dur")).toBe(
        "320ms",
      );
    }
  });
  it("timings follow the motion variables, including --motion-scale", () => {
    const root = document.documentElement;
    root.style.setProperty("--duration-slow", "400ms");
    root.style.setProperty("--motion-scale", "2");
    try {
      const { doc } = makeVTDoc();
      runZoomTransition({
        kind: "pane",
        update: () => {},
        doc,
        win: win(false),
      });
      expect(doc.documentElement.style.getPropertyValue("--zoom-dur")).toBe(
        "800ms",
      );
    } finally {
      root.style.removeProperty("--duration-slow");
      root.style.removeProperty("--motion-scale");
    }
  });
  it("the Reduce motion choice fades even when the system doesn't ask", () => {
    document.documentElement.dataset.motion = "reduce";
    try {
      const { doc } = makeVTDoc();
      runZoomTransition({
        kind: "pane",
        update: () => {},
        doc,
        win: win(false),
      });
      expect(doc.documentElement.dataset.zoom).toBe("fade");
    } finally {
      delete document.documentElement.dataset.motion;
    }
  });
  it("a new slide skips the running one, never queues", () => {
    const { doc, transitions } = makeVTDoc();
    runZoomTransition({
      kind: "overview",
      update: () => {},
      doc,
      win: win(false),
    });
    runZoomTransition({ kind: "pane", update: () => {}, doc, win: win(false) });
    expect(transitions[0].skip).toHaveBeenCalledTimes(1);
    expect(transitions).toHaveLength(2);
  });
});

describe("runZoomTransition (FLIP)", () => {
  it("falls back to an instant update without the Web Animations API", () => {
    const update = vi.fn();
    const r = runZoomTransition({
      kind: "open",
      update,
      doc: plainDoc(),
      win: win(false),
    });
    expect(r.mechanism).toBe("instant");
    expect(update).toHaveBeenCalledTimes(1);
  });

  it("runs update, marks the root while zooming and clears it on interrupt", () => {
    const { doc } = animDoc();
    const update = vi.fn();
    const r = runZoomTransition({ kind: "open", update, doc, win: win(false) });
    expect(r.mechanism).toBe("flip");
    expect(update).toHaveBeenCalledTimes(1);
    expect(doc.documentElement.dataset.zoom).toBe("open");
    expect(doc.documentElement.style.getPropertyValue("--zoom-dur")).toBe(
      "320ms", // --duration-slow,
    );
    interruptZoom();
    expect(doc.documentElement.dataset.zoom).toBeUndefined();
  });

  it("close is 280ms; reduced motion is a 120ms fade", () => {
    const a = animDoc();
    runZoomTransition({
      kind: "close",
      update: () => {},
      doc: a.doc,
      win: win(false),
    });
    expect(a.doc.documentElement.style.getPropertyValue("--zoom-dur")).toBe(
      "280ms",
    );
    const b = animDoc();
    runZoomTransition({
      kind: "open",
      update: () => {},
      doc: b.doc,
      win: win(true),
    });
    expect(b.doc.documentElement.dataset.zoom).toBe("fade");
    expect(b.doc.documentElement.style.getPropertyValue("--zoom-dur")).toBe(
      "120ms",
    );
    interruptZoom();
  });

  it("a new zoom ends the running one first (never queues)", () => {
    const a = animDoc();
    runZoomTransition({
      kind: "open",
      update: () => {},
      doc: a.doc,
      win: win(false),
    });
    const b = animDoc();
    runZoomTransition({
      kind: "close",
      update: () => {},
      doc: b.doc,
      win: win(false),
    });
    expect(a.doc.documentElement.dataset.zoom).toBeUndefined();
    expect(b.doc.documentElement.dataset.zoom).toBe("close");
    notifyCommitted();
    interruptZoom();
  });
});
