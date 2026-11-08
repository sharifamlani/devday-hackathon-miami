import { describe, expect, it } from "vitest";

import type { CalendarItem } from "../providers/local/calendarFeed";
import { allDayGroups } from "./WeekCalendarTile";

const item = (title: string, task_kind: string | null, kind: "task" | "event" = "task") =>
  ({ date: "2026-11-08", time: null, title, kind, task_kind, done: false, source: "generator", ref: title }) as unknown as CalendarItem;

describe("allDayGroups (the week grid's All day row)", () => {
  it("collapses a busy day into one block per kind, events first, then biggest", () => {
    const day = [
      ...Array.from({ length: 5 }, (_, i) => item(`Call ${i}`, "call")),
      ...Array.from({ length: 9 }, (_, i) => item(`Review ${i}`, "review")),
      item("Thank-you email", "email"),
      item("Board coffee", null, "event"),
    ];
    const groups = allDayGroups(day);
    expect(groups.map((g) => g.label)).toEqual(["Board coffee", "9 reviews", "5 calls", "Thank-you email"]);
    expect(groups.map((g) => g.items.length)).toEqual([1, 9, 5, 1]);
    expect(groups.flatMap((g) => g.items)).toHaveLength(day.length); // nothing dropped
  });

  it("keeps a lone item's own title and returns nothing for an empty day", () => {
    expect(allDayGroups([item("Call Rafael Quintero", "call")]).map((g) => g.label)).toEqual(["Call Rafael Quintero"]);
    expect(allDayGroups([])).toEqual([]);
  });
});
