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
      "340ms",
    );
    await transitions[0].cb();
    expect(update).toHaveBeenCalled();
    expect(src.style.viewTransitionName).toBe("");
  });
  it("close is 280ms and gives the name back to the tile", async () => {
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
      "280ms",
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
