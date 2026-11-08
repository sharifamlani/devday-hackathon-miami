import { buildBriefing, LATE_QUESTION } from "./briefing";
import type { HomeTask } from "./homeData";
import type { HomeSummary } from "../providers/local/homeSummary";

const summary = (over: Partial<HomeSummary> = {}): HomeSummary => ({
  gifts_at_risk: 0,
  duplicates: 0,
  tasks_today: 0,
  next_event: null,
  reached_today: 0,
  suggestions: [],
  ...over,
});

const task = (id: number, title: string): HomeTask => ({
  key: `task-${id}`,
  id,
  kind: "call",
  title,
  why: null,
  donorId: null,
  chips: [],
  source: null,
});

describe("buildBriefing", () => {
  it("is null until the summary arrives", () => {
    expect(buildBriefing(null, [])).toBeNull();
    expect(buildBriefing(undefined, [task(1, "Call Ana")])).toBeNull();
  });

  it("says nothing is urgent when every count is zero", () => {
    expect(buildBriefing(summary(), [])).toEqual({
      headline: "Nothing urgent today.",
      lines: [],
    });
  });

  it("orders lines tasks, late, duplicates, event, reached and keeps only nonzero ones", () => {
    const b = buildBriefing(
      summary({
        gifts_at_risk: 4,
        duplicates: 10,
        tasks_today: 2,
        next_event: { title: "Give Miami Day", date: "2026-11-20", days: 12 },
        reached_today: 1,
      }),
      [task(7, "Call Ana Ruiz"), task(8, "Email Ben")],
    )!;
    expect(b.headline).toBe("Here’s your day.");
    expect(b.lines.map((l) => l.key)).toEqual([
      "tasks",
      "late",
      "duplicates",
      "event",
      "reached",
    ]);
    expect(b.lines[0]).toEqual({
      key: "tasks",
      text: "2 tasks today. First up: Call Ana Ruiz",
      action: { kind: "task", taskKey: "task-7", label: "Start" },
    });
    expect(b.lines[1].text).toBe("4 usual gifts look late.");
    expect(b.lines[1].action).toEqual({
      kind: "ask",
      question: LATE_QUESTION,
      label: "Show me",
    });
    expect(b.lines[2].text).toBe("10 possible duplicates to review.");
    expect(b.lines[3].text).toBe(
      "Next event: Give Miami Day, in 12 days (Nov 20).",
    );
    expect(b.lines[3].action).toEqual({
      kind: "panel",
      view: "calendar",
      label: "Open calendar",
      date: "2026-11-20",
    });
    expect(b.lines[4]).toEqual({
      key: "reached",
      text: "You’ve reached 1 person today.",
      action: null,
    });
  });

  it("uses singular wording and today/tomorrow for near events", () => {
    const b = buildBriefing(
      summary({
        gifts_at_risk: 1,
        duplicates: 1,
        next_event: { title: "Board meeting", date: "2026-11-09", days: 1 },
      }),
      [],
    )!;
    expect(b.lines.map((l) => l.text)).toEqual([
      "1 usual gift looks late.",
      "1 possible duplicate to review.",
      "Next event: Board meeting, tomorrow.",
    ]);
    const today = buildBriefing(
      summary({ next_event: { title: "Gala", date: "2026-11-08", days: 0 } }),
      [],
    )!;
    expect(today.lines[0].text).toBe("Next event: Gala, today.");
  });

  it("falls back to the summary's task count with a panel link when the list isn't loaded", () => {
    const b = buildBriefing(summary({ tasks_today: 3 }), [])!;
    expect(b.lines[0]).toEqual({
      key: "tasks",
      text: "3 tasks today.",
      action: { kind: "panel", view: "tasks", label: "See tasks" },
    });
  });
});
