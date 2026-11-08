import { describe, expect, it } from "vitest";

import type { CrmEvent } from "../providers/local/crmTypes";
import { addPlanItem, updatePlanItem } from "../outreach/outreachPlan";
import {
  campaignEndsFrom,
  giveMiamiDayFrom,
  mergeAgenda,
  taskCalendarEntries,
  taskLabel,
  taskOrigin,
  tasksFromFeed,
  tasksFromPlan,
} from "./planLayer";

const event = (
  id: number,
  title: string,
  starts_at: string,
  extra: Partial<CrmEvent> & { event_kind?: string } = {},
): CrmEvent =>
  ({
    id,
    title,
    starts_at,
    ends_at: null,
    place: null,
    audience: null,
    source: null,
    source_url: null,
    audience_count: null,
    drafts_ready: null,
    ...extra,
  }) as CrmEvent;

const NOW = new Date("2026-11-08T15:00:00Z");

describe("calendar plan layer", () => {
  it("takes Give Miami Day from the events, else the date rule", () => {
    expect(
      giveMiamiDayFrom(
        [event(1, "Give Miami Day", "2026-11-19T00:00:00")],
        "2026-11-08",
      ),
    ).toBe("2026-11-19");
    expect(giveMiamiDayFrom([], "2026-11-08")).toBe("2026-11-19");
    expect(giveMiamiDayFrom([], "2026-11-25")).toBe("2027-11-18");
  });

  it("marks the end of multi-day fundraising campaigns only", () => {
    const ends = campaignEndsFrom([
      event(1, "Year-end appeal", "2026-11-15T09:00:00", {
        ends_at: "2026-12-31T23:00:00",
        event_kind: "year_end",
      }),
      event(2, "Give Miami 5K", "2026-11-15T07:30:00", {
        ends_at: "2026-11-15T10:00:00",
      }),
      event(3, "Gala", "2026-12-01T19:00:00", {
        ends_at: "2026-12-02T01:00:00",
      }),
    ]);
    expect(ends).toEqual([{ date: "2026-12-31", label: "Year-end appeal" }]);
  });

  it("turns the snapshot build's local plan into tasks, entries and agenda lines", () => {
    let items = addPlanItem(
      [],
      { date: "2026-11-15", donor_id: 1, label: "Rosa" },
      NOW,
    );
    items = addPlanItem(
      items,
      { date: "2026-11-02", donor_id: 2, label: "Old" },
      NOW,
    );
    items = addPlanItem(
      items,
      { date: "2026-11-10", campaign_id: 3, label: "Thanks" },
      NOW,
    );
    items = updatePlanItem(items, items[2].id, { done: true });

    const tasks = tasksFromPlan(items);
    const entries = taskCalendarEntries(tasks);
    expect(entries[0]).toMatchObject({ title: "Contact Rosa", allDay: true });
    expect(entries[2].title).toBe("Done: Review Thanks");

    const agenda = mergeAgenda(
      [event(9, "Give Miami 5K", "2026-11-15T07:30:00")],
      tasks,
      "2026-11-08",
    );
    expect(
      agenda.map((e) => (e.kind === "event" ? e.event.title : e.task.title)),
    ).toEqual(["Review Thanks", "Give Miami 5K", "Contact Rosa"]);
  });

  it("reads tasks (not events) from GET /calendar, with who added them", () => {
    const tasks = tasksFromFeed([
      {
        date: "2026-11-10",
        time: null,
        title: "Call Dana",
        kind: "task",
        source: "agent",
        ref: "task:7",
        done: false,
        task_kind: "call",
      },
      {
        date: "2026-11-10",
        time: "10:00",
        title: "Board coffee",
        kind: "event",
        source: null,
        ref: 3,
      },
      {
        date: "2026-11-11",
        time: null,
        title: "Welcome Sam",
        kind: "task",
        source: "generator",
        ref: "task:8",
        done: true,
      },
    ]);
    expect(tasks.map((t) => t.id)).toEqual(["7", "8"]);
    expect(tasks[0]).toMatchObject({ date: "2026-11-10", kind: "call" });
    expect(taskLabel(tasks[0])).toBe("Call Dana (added by agent)");
    expect(taskLabel(tasks[1])).toBe("Done: Welcome Sam");
    expect(taskOrigin(tasks[0])).toBe("added by agent");
    expect(taskOrigin(tasks[1])).toBe("suggested from your data");
    expect(taskOrigin({ source: "staff" })).toBeNull();
  });

  it("lists events before tasks on a day, tasks by time", () => {
    const agenda = mergeAgenda(
      [event(1, "Gala", "2026-11-10T19:00:00")],
      tasksFromFeed([
        {
          date: "2026-11-10",
          time: "14:00",
          title: "B",
          kind: "task",
          source: null,
          ref: "task:2",
        },
        {
          date: "2026-11-10",
          time: "09:00",
          title: "A",
          kind: "task",
          source: null,
          ref: "task:1",
        },
        {
          date: "2026-11-01",
          time: null,
          title: "Past",
          kind: "task",
          source: null,
          ref: "task:3",
        },
      ]),
      "2026-11-08",
    );
    expect(
      agenda.map((e) => (e.kind === "event" ? e.event.title : e.task.title)),
    ).toEqual(["Gala", "A", "B"]);
  });
});
