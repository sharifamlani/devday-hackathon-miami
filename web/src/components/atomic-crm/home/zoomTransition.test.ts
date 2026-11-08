import { beforeEach, describe, expect, it, vi } from "vitest";
import { runZoomTransition } from "./zoomTransition";

function makeDoc(withVT = true) {
  const transitions: { skip: ReturnType<typeof vi.fn>; cb: () => unknown }[] =
    [];
  const doc = {
    documentElement: document.createElement("html"),
    startViewTransition: withVT
      ? (cb: () => unknown) => {
          const t = { skip: vi.fn(), cb };
          transitions.push(t);
          return {
            skipTransition: t.skip,
            finished: new Promise(() => {}),
          };
        }
      : undefined,
  };
  return { doc, transitions };
}
const win = (reduced: boolean) =>
  ({ matchMedia: () => ({ matches: reduced }) }) as unknown as Window;

describe("runZoomTransition", () => {
  beforeEach(() => vi.clearAllMocks());
  it("falls back to an instant update without View Transitions", () => {
    const { doc } = makeDoc(false);
    const update = vi.fn();
    const r = runZoomTransition({ kind: "open", update, doc, win: win(false) });
    expect(r.mechanism).toBe("instant");
    expect(update).toHaveBeenCalled();
  });
  it("runs update inside the transition and names the source", async () => {
    const { doc, transitions } = makeDoc();
    const src = document.createElement("div");
    const update = vi.fn();
    runZoomTransition({
      kind: "open",
      update,
      sourceEl: src,
      doc,
      win: win(false),
    });
    expect(src.style.viewTransitionName).toBe("zoom-frame");
    expect(doc.documentElement.dataset.zoom).toBe("open");
    expect(doc.documentElement.style.getPropertyValue("--zoom-dur")).toBe(
      "320ms", // --duration-slow
    );
    await transitions[0].cb();
    expect(update).toHaveBeenCalled();
    expect(src.style.viewTransitionName).toBe("");
  });
  it("close takes --exit-ratio of open (240ms) and gives the name back to the tile", async () => {
    const { doc, transitions } = makeDoc();
    const src = document.createElement("div");
    document.body.append(src);
    runZoomTransition({
      kind: "close",
      update: () => {},
      sourceEl: src,
      doc,
      win: win(false),
    });
    expect(doc.documentElement.style.getPropertyValue("--zoom-dur")).toBe(
      "240ms",
    );
    await transitions[0].cb();
    expect(src.style.viewTransitionName).toBe("zoom-frame");
  });
  it("interrupts a running transition with skipTransition, never queues", () => {
    const { doc, transitions } = makeDoc();
    runZoomTransition({ kind: "open", update: () => {}, doc, win: win(false) });
    runZoomTransition({
      kind: "close",
      update: () => {},
      doc,
      win: win(false),
    });
    expect(transitions[0].skip).toHaveBeenCalledTimes(1);
    expect(transitions).toHaveLength(2);
  });
  it("overview and pane slides use the slow speed", () => {
    for (const kind of ["overview", "pane"] as const) {
      const { doc } = makeDoc();
      runZoomTransition({ kind, update: () => {}, doc, win: win(false) });
      expect(doc.documentElement.dataset.zoom).toBe(kind);
      expect(doc.documentElement.style.getPropertyValue("--zoom-dur")).toBe(
        "320ms",
      );
    }
  });
  it("an exiting overview or pane is timed as a close", () => {
    const { doc } = makeDoc();
    runZoomTransition({
      kind: "pane",
      exit: true,
      update: () => {},
      doc,
      win: win(false),
    });
    expect(doc.documentElement.style.getPropertyValue("--zoom-dur")).toBe(
      "240ms",
    );
  });
  it("timings follow the motion variables, including --motion-scale", () => {
    const root = document.documentElement;
    root.style.setProperty("--duration-slow", "400ms");
    root.style.setProperty("--motion-scale", "2");
    try {
      const { doc } = makeDoc();
      runZoomTransition({
        kind: "open",
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
      const { doc } = makeDoc();
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
  it("reduced motion: 120ms fade, no source naming", () => {
    const { doc } = makeDoc();
    const src = document.createElement("div");
    runZoomTransition({
      kind: "open",
      update: () => {},
      sourceEl: src,
      doc,
      win: win(true),
    });
    expect(doc.documentElement.dataset.zoom).toBe("fade");
    expect(doc.documentElement.style.getPropertyValue("--zoom-dur")).toBe(
      "120ms",
    );
    expect(src.style.viewTransitionName).toBe("");
  });
});
