import { describe, expect, it } from "vitest";

import type { CalendarItem } from "../providers/local/calendarFeed";
import {
  agendaDays,
  clock,
  dayHeading,
  weekRange,
  weekStrip,
} from "./AgendaList";

const item = (
  title: string,
  date: string,
  time: string | null,
  extra: Partial<CalendarItem> = {},
) =>
  ({
    date,
    time,
    title,
    kind: "event",
    task_kind: null,
    done: false,
    source: "generator",
    ref: `${date}-${title}`,
    ...extra,
  }) as CalendarItem;

const TODAY = "2026-11-08";

describe("week strip", () => {
  it("starts today with the real weekday letters (Nov 8, 2026 is a Sunday)", () => {
    const strip = weekStrip(TODAY);
    expect(strip.map((d) => d.letter)).toEqual([
      "S",
      "M",
      "T",
      "W",
      "T",
      "F",
      "S",
    ]);
    expect(strip.map((d) => d.day)).toEqual([8, 9, 10, 11, 12, 13, 14]);
    expect(weekRange(TODAY)).toBe("Nov 8 – 14");
  });

  it("derives letters from the dates, shifts by a week, and spans month ends", () => {
    expect(weekStrip("2026-11-09").map((d) => d.letter)).toEqual([
      "M",
      "T",
      "W",
      "T",
      "F",
      "S",
      "S",
    ]);
    expect(weekRange("2026-11-29")).toBe("Nov 29 – Dec 5");
  });
});

describe("formats", () => {
  it("writes times as h:mm AM/PM", () => {
    expect(clock(9 * 60)).toBe("9:00 AM");
    expect(clock(12 * 60 + 30)).toBe("12:30 PM");
    expect(clock(0)).toBe("12:00 AM");
    expect(clock(15 * 60 + 5)).toBe("3:05 PM");
  });

  it("spells the weekday out and marks today", () => {
    expect(dayHeading(TODAY, TODAY)).toBe("Today · Sunday, Nov 8");
    expect(dayHeading("2026-11-10", TODAY)).toBe("Tuesday, Nov 10");
    // a date-only value stays on its own day (parseWhen), not the evening before
    expect(dayHeading("2026-11-14", TODAY)).toBe("Saturday, Nov 14");
  });
});

describe("agendaDays", () => {
  it("groups by day, today first, skips empty days, past, done and out-of-range items", () => {
    const days = agendaDays(
      [
        item("Donor lunch", "2026-11-10", "12:30"),
        item("Board call", TODAY, "09:00"),
        item("Yesterday", "2026-11-07", "09:00"),
        item("Finished", TODAY, "10:00", { done: true }),
        item("Far away", "2026-12-25", "09:00"),
        item("Early coffee", "2026-11-10", "08:15"),
      ],
      TODAY,
      TODAY,
    );
    expect(days.map((d) => d.date)).toEqual([TODAY, "2026-11-10"]);
    expect(days[1].rows.map((r) => [r.time, r.label])).toEqual([
      ["8:15 AM", "Early coffee"],
      ["12:30 PM", "Donor lunch"],
    ]);
  });

  it("lists All day rows first, one summary row for untimed tasks, and flags agent rows", () => {
    const [today, later] = agendaDays(
      [
        item("Planning", TODAY, "14:00", { source: "agent" }),
        ...["call", "call", "call", "review"].map((k, n) =>
          item(`T${n}`, TODAY, null, { kind: "task", task_kind: k }),
        ),
        item("Give Miami Day", "2026-11-10", null, { source: "agent" }),
        item("Early", "2026-11-10", "07:00"),
        item("Review B", "2026-11-10", null, {
          kind: "task",
          task_kind: "review",
        }),
      ],
      TODAY,
      TODAY,
    );
    expect(today.rows.map((r) => [r.time, r.label, r.byAgent])).toEqual([
      ["All day", "3 calls · 1 review", false],
      ["2:00 PM", "Planning", true],
    ]);
    expect(later.rows.map((r) => [r.time, r.label])).toEqual([
      ["All day", "Give Miami Day"],
      ["All day", "Review B"],
      ["7:00 AM", "Early"],
    ]);
  });

  it("always lists today, empty when nothing is scheduled, but not when today is out of range", () => {
    const days = agendaDays(
      [item("Later", "2026-11-10", "09:00")],
      TODAY,
      TODAY,
    );
    expect(days.map((d) => [d.date, d.rows.length])).toEqual([
      [TODAY, 0],
      ["2026-11-10", 1],
    ]);
    expect(agendaDays([], "2026-11-22", TODAY)).toEqual([]);
  });
});
