import { describe, expect, it } from "vitest";

import type { CrmEvent } from "../../providers/local/crmTypes";
import { fieldErrors, eventId, type CalendarEvent } from "../../providers/local/events";
import { ApiError } from "../../providers/local/httpClient";
import { weekRange, weekStrip } from "../AgendaList";
import {
  buildSuggestions,
  emptyForm,
  eventDays,
  formToInput,
  stripLabel,
  weekOffsetFor,
  validateEventForm,
} from "./eventsModel";
import { addDays } from "../../outreach/dates";

const TODAY = "2026-11-08"; // a Sunday
const ev = (title: string, date: string, time: string | null, extra: Partial<CalendarEvent> = {}): CalendarEvent => ({
  date, time, title, kind: "event", source: "staff", ref: `event:${title.length}`, ...extra,
});

describe("week math", () => {
  it("Nov 8 2026 is a Sunday: S M T W T F S, 8-14, and arrows move 7 days", () => {
    expect(weekStrip(TODAY).map((d) => d.letter)).toEqual(["S", "M", "T", "W", "T", "F", "S"]);
    expect(weekStrip(TODAY).map((d) => d.day)).toEqual([8, 9, 10, 11, 12, 13, 14]);
    expect(weekRange(TODAY)).toBe("Nov 8 – 14");
    expect(weekRange(addDays(TODAY, 7))).toBe("Nov 15 – 21");
    expect(weekRange(addDays(TODAY, -7))).toBe("Nov 1 – 7");
  });
});

describe("eventDays (events only)", () => {
  const days = eventDays(
    [
      ev("Board coffee", "2026-11-12", "08:00", { place: "Coral Room" }),
      ev("Give Miami Day: early giving opens", "2026-11-14", null, { source: "website", source_url: "https://www.miamifoundation.org/x" }),
      { ...ev("Call Maria", "2026-11-09", "10:00"), kind: "task" } as unknown as CalendarEvent,
      ev("Out of week", "2026-11-20", null),
    ],
    TODAY,
  );
  it("lists all 7 days, drops tasks and out-of-week items", () => {
    expect(days.map((d) => d.date)).toHaveLength(7);
    expect(days.flatMap((d) => d.rows.map((r) => r.title))).toEqual([
      "Board coffee",
      "Give Miami Day: early giving opens",
    ]);
    expect(days[0].rows).toEqual([]); // empty day -> "Nothing scheduled"
  });
  it("labels strip cells and provenance", () => {
    expect(stripLabel(days[0])).toBe("–");
    expect(stripLabel(days[4])).toBe("1 event");
    expect(stripLabel(days[6])).toBe("♥ Give Miami");
    expect(days[4].rows[0]).toMatchObject({ time: "8:00 AM", provenance: "added by you", editable: true });
    expect(days[6].rows[0]).toMatchObject({ time: "All day", provenance: "miamifoundation.org", editable: false });
  });
});

describe("event form", () => {
  const ok = { ...emptyForm("2026-11-12"), title: "Board coffee", allDay: false, start: "08:00" };
  it("requires a title, a real date and a start time", () => {
    expect(validateEventForm(ok)).toEqual({});
    expect(validateEventForm({ ...ok, title: " " }).title).toBeTruthy();
    expect(validateEventForm({ ...ok, date: "2026-02-31" }).date).toBeTruthy();
    expect(validateEventForm({ ...ok, date: "" }).date).toBeTruthy();
    expect(validateEventForm({ ...ok, start: "" }).start).toBeTruthy();
    expect(validateEventForm({ ...ok, end: "07:00" }).end).toBeTruthy();
  });
  it("builds the POST body", () => {
    expect(formToInput({ ...ok, place: "Coral Room", kind: "stewardship" })).toEqual({
      title: "Board coffee", starts_at: "2026-11-12T08:00", ends_at: null, place: "Coral Room", event_kind: "stewardship", notes: null,
    });
    expect(formToInput({ ...ok, allDay: true }).starts_at).toBe("2026-11-12");
  });
  it("maps a 422 to field errors and a ref to an id", () => {
    const e = new ApiError("x", 422, { detail: [{ loc: ["body", "starts_at"], msg: "bad date" }] });
    expect(fieldErrors(e)).toEqual({ date: "bad date" });
    expect(eventId("event:7")).toBe(7);
  });
});

describe("suggestions", () => {
  const crm = (o: Partial<CrmEvent>): CrmEvent => ({
    id: 1, title: "Gala", starts_at: "2026-11-12", ends_at: null, place: null, audience: null, status: "upcoming",
    kind: null, rationale: null, batch_id: null, source: "website", source_url: null, audience_count: null, drafts_ready: null, ...o,
  });
  it("derives to-dos only from real audience / draft data, due before the event", () => {
    const s = buildSuggestions(
      [crm({ id: 1, audience_count: 25 }), crm({ id: 2, title: "5K", drafts_ready: 3 }), crm({ id: 3, title: "Empty" })],
      TODAY, TODAY,
    );
    expect(s.map((x) => x.task)).toEqual([
      expect.objectContaining({ title: "Invite 25 people to Gala", kind: "email", due: "2026-11-11" }),
      expect.objectContaining({ title: "Review 3 drafted invites for 5K", kind: "review", due: "2026-11-11" }),
    ]);
  });
  it("invents nothing and skips past or out-of-week events", () => {
    expect(buildSuggestions([], TODAY, TODAY)).toEqual([]);
    expect(buildSuggestions([crm({ audience_count: 9, starts_at: "2026-11-30" })], TODAY, TODAY)).toEqual([]);
    expect(buildSuggestions([crm({ audience_count: 9, starts_at: "2026-11-01" })], TODAY, TODAY)).toEqual([]);
  });
});

describe("briefing focus", () => {
  it("lands on the rolling week containing the focused date", () => {
    expect(weekOffsetFor(TODAY, "2026-11-08")).toBe(0);
    expect(weekOffsetFor(TODAY, "2026-11-14")).toBe(0);
    expect(weekOffsetFor(TODAY, "2026-11-15")).toBe(1);
    expect(weekOffsetFor(TODAY, "2026-11-19T09:00:00")).toBe(1);
    expect(weekOffsetFor(TODAY, "2026-12-06")).toBe(4);
    expect(weekOffsetFor(TODAY, "2026-11-07")).toBe(-1);
  });
});
