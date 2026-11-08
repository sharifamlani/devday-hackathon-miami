import {
  TOUR_IDS,
  TOUR_STOPS,
  availableStops,
  placeCoachMark,
  tourSelector,
} from "./tour";

describe("tour stops", () => {
  it("covers every data-tour id once", () => {
    expect(TOUR_STOPS.map((s) => s.id).sort()).toEqual([...TOUR_IDS].sort());
    expect(tourSelector("voice")).toBe('[data-tour="voice"]');
  });

  it("skips targets that are missing or have no box", () => {
    const present = new Set(["ask", "progress", "tasks"]);
    const hidden = new Set(["tasks"]); // display:none → no client rects
    const found = availableStops(TOUR_STOPS, (id) =>
      present.has(id)
        ? { getClientRects: () => ({ length: hidden.has(id) ? 0 : 1 }) }
        : null,
    );
    expect(found.map((s) => s.id)).toEqual(["progress", "ask"]);
  });

  it("follows the homepage: left column, the agent, then the header buttons", () => {
    expect(TOUR_STOPS.map((s) => s.id)).toEqual([
      "progress",
      "calendar",
      "tasks",
      "projects",
      "composer",
      "voice",
      "ask",
    ]);
  });
});

describe("placeCoachMark", () => {
  const viewport = { width: 1280, height: 800 };
  const card = { width: 340, height: 180 };

  it("goes below the target, centered on it", () => {
    expect(
      placeCoachMark(
        { top: 100, left: 400, width: 200, height: 50 },
        card,
        viewport,
      ),
    ).toEqual({
      top: 162,
      left: 330,
      side: "below",
    });
  });

  it("goes above when there is no room below", () => {
    expect(
      placeCoachMark(
        { top: 600, left: 400, width: 200, height: 100 },
        card,
        viewport,
      ),
    ).toMatchObject({
      top: 408,
      side: "above",
    });
  });

  it("stays inside the viewport at the edges", () => {
    expect(
      placeCoachMark(
        { top: 10, left: 1240, width: 40, height: 40 },
        card,
        viewport,
      ).left,
    ).toBe(924);
    expect(
      placeCoachMark(
        { top: 10, left: 0, width: 40, height: 40 },
        card,
        viewport,
      ).left,
    ).toBe(16);
  });

  it("centers on screen when the target fills the view", () => {
    expect(
      placeCoachMark(
        { top: 0, left: 0, width: 1280, height: 800 },
        card,
        viewport,
      ),
    ).toEqual({
      top: 310,
      left: 470,
      side: "center",
    });
  });
});
