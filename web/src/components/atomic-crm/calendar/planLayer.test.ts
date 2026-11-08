import { describe, expect, it } from "vitest";

import type { CrmEvent } from "../providers/local/crmTypes";
import { addPlanItem, updatePlanItem } from "../outreach/outreachPlan";
import {
  campaignEndsFrom,
  giveMiamiDayFrom,
  mergeAgenda,
  planCalendarEntries,
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

  it("turns plan items into all-day entries and merges them into the agenda by day", () => {
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

    const entries = planCalendarEntries(items);
    expect(entries[0]).toMatchObject({ title: "Contact Rosa", allDay: true });
    expect(entries[2].title).toBe("Done: Review Thanks");

    const agenda = mergeAgenda(
      [event(9, "Give Miami 5K", "2026-11-15T07:30:00")],
      items,
      "2026-11-08",
    );
    expect(
      agenda.map((e) => (e.kind === "event" ? e.event.title : e.item.label)),
    ).toEqual(["Thanks", "Give Miami 5K", "Rosa"]);
  });
});
