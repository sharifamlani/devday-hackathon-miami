import { describe, expect, it } from "vitest";

import type { AskAnswer, AskDonor } from "../providers/local/ask";
import type { Artifact } from "../providers/local/calendarFeed";
import type { Task } from "../providers/local/tasks";
import type { DonationTarget, DonorSummary } from "../providers/local/types";
import {
  agendaFromCalendar,
  answerSummary,
  appendAnswer,
  artifactRows,
  calendarMarks,
  crmTag,
  donorMeta,
  donorTag,
  draftEmailHref,
  firstName,
  formatCompactUsd,
  giveMiamiDay,
  goalEnds,
  kindLabel,
  maskEmail,
  searchDonors,
  tasksFromApi,
  type CalendarItem,
  weekDays,
} from "./homeData";

const target = (overrides: Partial<DonationTarget>): DonationTarget =>
  ({
    period: "quarter",
    label: "Q4 2026",
    start: "2026-10-01",
    end: "2026-12-31",
    give_miami_day: null,
    ...overrides,
  }) as DonationTarget;

const donor = (id: number, overrides: Partial<DonorSummary> = {}) =>
  ({
    id,
    full_name: `Donor ${id}`,
    org_name: null,
    email: null,
    status: "on_track",
    score: 50,
    gift_count: 4,
    total_given: 2450,
    last_gift_date: "2026-09-10",
    last_gift_amount: 50,
    usual_cadence: "monthly",
    why_short: `Why ${id}`,
    ...overrides,
  }) as DonorSummary;

const answer = (
  question: string,
  donors: Partial<AskDonor>[] = [],
  overrides: Partial<AskAnswer> = {},
): AskAnswer =>
  ({
    question,
    interpretation: "Gave this quarter, not thanked",
    understood: true,
    donors: donors as AskDonor[],
    detail: null,
    ...overrides,
  }) as AskAnswer;

describe("home data: periods and names", () => {
  it("reads goal deadlines and Give Miami Day from targets, with a fallback", () => {
    const targets = {
      quarter: target({
        give_miami_day: { date: "2026-11-19", days_until: 11, in_period: true },
      }),
      month: target({
        period: "month",
        label: "November 2026",
        end: "2026-11-30",
      }),
    };
    expect(goalEnds(targets)).toEqual([
      { date: "2026-11-30", label: "November 2026 goal" },
      { date: "2026-12-31", label: "Q4 2026 goal" },
    ]);
    expect(giveMiamiDay(targets, "2026-11-08")).toBe("2026-11-19");
    expect(giveMiamiDay({}, "2026-11-08")).toBe("2026-11-19");
    expect(giveMiamiDay(undefined, "2026-12-01")).toBe("2027-11-18");
  });

  it("formats compact money in lower case and finds a first name", () => {
    expect(formatCompactUsd(105400)).toBe("$105.4k");
    expect(formatCompactUsd(null)).toBe("—");
    expect(firstName("  Denise  Shaw ")).toBe("Denise");
    expect(firstName("")).toBeNull();
    expect(firstName(undefined)).toBeNull();
  });
});

describe("home data: donors", () => {
  it("tags donors from their status, never inventing payment events", () => {
    expect(donorTag({ status: "lapsing", gift_count: 1 })).toEqual({
      label: "Late",
      tone: "alert",
    });
    expect(donorTag({ status: "due", gift_count: 1 }).label).toBe("New");
    expect(donorTag({ status: "due", gift_count: 5 }).label).toBe("Due");
    expect(donorTag({ status: "no_gifts", gift_count: 0 }).label).toBe(
      "Not yet",
    );
    expect(donorTag({ status: "lapsed", gift_count: 9 }).label).toBe("Lapsed");
    expect(donorTag({ status: "on_track", gift_count: 9 }).label).toBe(
      "On track",
    );
  });

  it("describes a donor in one line", () => {
    expect(donorMeta(donor(1))).toBe("Monthly · $50");
    expect(
      donorMeta(donor(1, { gift_count: 1, last_gift_date: "2026-10-22" })),
    ).toBe("First gift Oct 22");
    expect(donorMeta(donor(1, { gift_count: 0 }))).toBe("No gifts yet");
  });

  it("masks email addresses", () => {
    expect(maskEmail("priya@example.org")).toBe("p•••@example.org");
    expect(maskEmail(null)).toBe("—");
    expect(maskEmail("@example.org")).toBe("•••");
  });

  it("searches name, email and organization word by word", () => {
    const list = [
      donor(1, { full_name: "Priya Raman", email: "p@example.org", score: 10 }),
      donor(2, {
        full_name: "Marcus Bell",
        org_name: "Bell Foundation",
        score: 20,
      }),
      donor(3, { full_name: "Rosa Delgado", score: 30 }),
    ];
    expect(searchDonors(list, "priya").map((d) => d.id)).toEqual([1]);
    expect(searchDonors(list, "bell found").map((d) => d.id)).toEqual([2]);
    expect(searchDonors(list, "example.org").map((d) => d.id)).toEqual([1]);
    expect(searchDonors(list, "").map((d) => d.id)).toEqual([3, 2, 1]);
    expect(searchDonors(list, "nobody")).toEqual([]);
  });
});

const task = (id: number, overrides: Partial<Task> = {}): Task => ({
  id,
  kind: "call",
  title: `Task ${id}`,
  why: `Why ${id}`,
  person_id: id,
  chips: [`Lifetime $${id}00`],
  due: "2026-11-08",
  time: null,
  done: false,
  source: "generator",
  ...overrides,
});

const item = (overrides: Partial<CalendarItem>): CalendarItem => ({
  date: "2026-11-08",
  time: null,
  title: "Thing",
  kind: "task",
  source: "generator",
  ref: "task:1",
  ...overrides,
});

describe("home data: tasks from GET /tasks", () => {
  it("keeps open tasks in the service's order, with their own chips", () => {
    const list = tasksFromApi([
      task(1),
      task(2, { done: true }),
      task(3, { kind: "review", person_id: null, chips: [] }),
    ]);
    expect(list.map((t) => t.id)).toEqual([1, 3]);
    expect(list[0]).toMatchObject({
      key: "task-1",
      title: "Task 1",
      donorId: 1,
      chips: ["Lifetime $100"],
    });
    expect(tasksFromApi(undefined)).toEqual([]);
  });

  it("keeps overdue and undated open tasks, drops only done ones, whatever the kind", () => {
    const list = tasksFromApi([
      task(1, { due: "2026-11-06" }),
      task(2, { due: null, kind: "prep" }),
      task(3, { due: "2026-11-08", done: true }),
      task(4, { due: "2026-11-08", kind: "follow_up" }),
    ]);
    expect(list.map((t) => t.id)).toEqual([1, 2, 4]);
  });

  it("names the kind and links Draft email only for person tasks", () => {
    expect(kindLabel("call")).toBe("Call");
    expect(kindLabel("prep")).toBe("Prep");
    expect(kindLabel("follow_up")).toBe("Follow up");
    expect(draftEmailHref({ kind: "call", donorId: 4 })).toBe(
      "/campaigns/new?donors=4&intent=re_engage&channel=email",
    );
    expect(draftEmailHref({ kind: "email", donorId: 4 })).toBe(
      "/campaigns/new?donors=4&intent=thank_you&channel=email",
    );
    expect(draftEmailHref({ kind: "review", donorId: 4 })).toBeNull();
    expect(draftEmailHref({ kind: "call", donorId: null })).toBeNull();
  });
});

describe("home data: CRM badges from GET /people/attention", () => {
  it("names the service's 'failed' badge and passes the rest to attentionTag", () => {
    expect(crmTag("failed")).toEqual({ label: "Card failed", tone: "alert" });
    expect(crmTag("late")).toEqual({ label: "Late", tone: "alert" });
    expect(crmTag("not_yet")).toEqual({ label: "Not yet", tone: "quiet" });
    expect(crmTag("new").tone).toBe("good");
  });
});

describe("home data: week, agenda and artifacts", () => {
  it("returns Monday to Sunday of the current week", () => {
    expect(weekDays("2026-11-07")).toEqual([
      "2026-11-02",
      "2026-11-03",
      "2026-11-04",
      "2026-11-05",
      "2026-11-06",
      "2026-11-07",
      "2026-11-08",
    ]);
    expect(weekDays("2026-11-09")[0]).toBe("2026-11-09");
  });

  it("marks days from the calendar feed, goal ends and Give Miami Day", () => {
    const marks = calendarMarks({
      items: [
        item({ date: "2026-11-08", title: "Call A" }),
        item({ date: "2026-11-08", title: "Call B" }),
        item({ date: "2026-11-08", title: "Call C", done: true }),
        item({ date: "2026-11-12", kind: "event", title: "Board coffee" }),
      ],
      campaignEnds: [{ date: "2026-11-30", label: "November 2026 goal" }],
      giveMiamiDay: "2026-11-19",
    });
    expect(marks.get("2026-11-08")).toMatchObject({ planned: 2, done: 1 });
    expect(marks.get("2026-11-12")?.events).toEqual(["Board coffee"]);
    expect(marks.get("2026-11-19")?.giveMiamiDay).toBe(true);
    expect(marks.get("2026-11-30")?.campaignEnds).toEqual([
      "November 2026 goal",
    ]);
  });

  it("lists events and later tasks, then the next big event, soonest first", () => {
    const lines = agendaFromCalendar({
      today: "2026-11-08",
      items: [
        item({ date: "2026-11-08", title: "Today's call" }),
        item({ date: "2026-11-10", title: "Thank-you calls", source: "agent" }),
        item({ date: "2026-11-12", kind: "event", title: "Board coffee" }),
        item({ date: "2026-11-11", title: "Done call", done: true }),
        item({ date: "2026-11-01", kind: "event", title: "Past event" }),
      ],
      nextEvent: { title: "Give Miami Day", date: "2026-11-19" },
      limit: 5,
    });
    expect(lines).toEqual([
      { date: "2026-11-10", label: "Thank-you calls (added by agent)" },
      { date: "2026-11-12", label: "Board coffee" },
      { date: "2026-11-19", label: "Give Miami Day" },
    ]);
    expect(
      agendaFromCalendar({
        today: "2026-11-08",
        items: [
          item({ date: "2026-11-19", kind: "event", title: "Give Miami Day" }),
        ],
        nextEvent: { title: "Give Miami Day", date: "2026-11-19" },
      }),
    ).toEqual([{ date: "2026-11-19", label: "Give Miami Day" }]);
    expect(
      agendaFromCalendar({ today: "2026-11-08", items: [], nextEvent: null }),
    ).toEqual([]);
  });

  it("sorts artifacts newest first and links campaigns to their review page", () => {
    const list: Artifact[] = [
      { kind: "call_note", title: "Call notes", date: "2026-11-02", ref: "n1" },
      {
        kind: "campaign",
        title: "Thank-you drafts",
        date: "2026-11-05",
        ref: 7,
      },
    ];
    const rows = artifactRows(list);
    expect(rows.map((r) => r.title)).toEqual([
      "Thank-you drafts",
      "Call notes",
    ]);
    expect(rows[0].to).toBe("/campaigns/7");
    expect(rows[1].to).toBeNull();
    expect(artifactRows(undefined)).toEqual([]);
  });
});

describe("home data: agent thread", () => {
  it("appends new questions and replaces a re-run of the last one", () => {
    const a = answer("Who gave?");
    const b = answer("Who is late?");
    const bEdited = answer("Who is late?", [], { served_from: "edited" });
    let history = appendAnswer([], a);
    expect(appendAnswer(history, a)).toBe(history);
    expect(appendAnswer(history, null)).toBe(history);
    history = appendAnswer(history, b);
    history = appendAnswer(history, bEdited);
    expect(history).toEqual([a, bEdited]);
  });

  it("summarizes an answer in a headline and up to three rows", () => {
    const donors = [1, 2, 3, 4].map((id) => ({
      id,
      full_name: `Donor ${id}`,
      total_given: 500,
      last_gift_date: "2026-10-18",
      ask:
        id === 1
          ? {
              period_total: 1000,
              period_gifts: 1,
              last_gift_date: "2026-10-19",
            }
          : null,
    }));
    const summary = answerSummary(answer("Who gave?", donors));
    expect(summary.headline).toBe("4 donors match.");
    expect(summary.rows[0]).toEqual({
      id: 1,
      name: "Donor 1",
      detail: "$1,000 · Oct 19",
    });
    expect(summary.rows[1].detail).toBe("$500 · Oct 18");
    expect(summary.more).toBe(1);
    expect(answerSummary(answer("x")).headline).toBe("No donors match.");
    expect(
      answerSummary(answer("x", [], { understood: false, detail: "Try again" }))
        .headline,
    ).toBe("Try again");
  });

  it("snapshot mode greets instead of saying it could not read the message", () => {
    const miss = (q: string) => answer(q, [], { understood: false });
    expect(answerSummary(miss("hello?"), 3, "snapshot").headline).toMatch(
      /^Hi! This public preview/,
    );
    expect(answerSummary(miss("Good morning"), 3, "snapshot").headline).toMatch(
      /^Hi! /,
    );
    expect(answerSummary(miss("what is the weather"), 3, "snapshot").headline).toBe(
      "This preview can’t answer that one. The full agent runs on the laptop. Try one of these:",
    );
    expect(answerSummary(miss("hello?"), 3, "local").headline).toMatch(
      /read that as a donor question/,
    );
  });
});
