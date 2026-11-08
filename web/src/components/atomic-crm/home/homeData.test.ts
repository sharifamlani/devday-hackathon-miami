import { describe, expect, it } from "vitest";

import type { AskAnswer, AskDonor } from "../providers/local/ask";
import type {
  CampaignSummary,
  DonationTarget,
  DonorSummary,
} from "../providers/local/types";
import type { OutreachPlanItem } from "../outreach/outreachPlan";
import type { Recommendation } from "../outreach/recommend";
import {
  agendaLines,
  answerSummary,
  appendAnswer,
  attentionDonors,
  buildTasks,
  donorFacts,
  donorMeta,
  donorTag,
  draftEmailHref,
  firstName,
  formatCompactUsd,
  giveMiamiDay,
  goalEnds,
  maskEmail,
  searchDonors,
  toRecCampaigns,
  weekDays,
} from "./homeData";

const campaign = (
  id: number,
  status: "draft" | "sent",
  draft = 4,
): CampaignSummary => ({
  id,
  name: `Campaign ${id}`,
  intent: "thank_you",
  channel: "email",
  created_at: "2026-11-01T10:00:00Z",
  created_by: null,
  status,
  counts: {
    total: 10,
    draft,
    approved: 3,
    sent: 2,
    skipped: 1,
    needs_individual_approval: 0,
    flagged: 0,
    bulk_approvable: 0,
  },
});

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

const planItem = (
  id: string,
  overrides: Partial<OutreachPlanItem> = {},
): OutreachPlanItem => ({
  id,
  date: "2026-11-07",
  donor_id: null,
  campaign_id: null,
  label: `Item ${id}`,
  note: "",
  done: false,
  source: "staff",
  created_at: "2026-11-01T00:00:00Z",
  ...overrides,
});

const rec = (
  key: string,
  overrides: Partial<Recommendation> = {},
): Recommendation => ({
  key,
  kind: "donor",
  donor_id: null,
  campaign_id: null,
  label: key,
  date: "2026-11-09",
  reason: `Reason ${key}`,
  priority: 100,
  ...overrides,
});

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

describe("home data: periods and campaigns", () => {
  it("keeps draft campaigns for the recommendation rules", () => {
    expect(
      toRecCampaigns([campaign(1, "draft"), campaign(2, "sent", 0)]).map(
        (c) => [c.id, c.drafts],
      ),
    ).toEqual([[1, 4]]);
  });

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

  it("lists donors needing attention by score", () => {
    const list = [
      donor(1, { status: "on_track", score: 99 }),
      donor(2, { status: "lapsing", score: 60 }),
      donor(3, { status: "on_track", gift_count: 1, score: 70 }),
      donor(4, { status: "due", score: 80 }),
    ];
    expect(attentionDonors(list).map((d) => d.id)).toEqual([4, 3, 2]);
    expect(attentionDonors(list, 1).map((d) => d.id)).toEqual([4]);
  });

  it("describes a donor in one line and a few facts", () => {
    expect(donorMeta(donor(1))).toBe("Monthly · $50");
    expect(
      donorMeta(donor(1, { gift_count: 1, last_gift_date: "2026-10-22" })),
    ).toBe("First gift Oct 22");
    expect(donorMeta(donor(1, { gift_count: 0 }))).toBe("No gifts yet");
    expect(donorFacts(donor(1))).toEqual([
      "Lifetime $2,450",
      "Last gift Sep 10",
      "Monthly",
    ]);
    expect(
      donorFacts(donor(1, { last_gift_date: null, usual_cadence: null })),
    ).toEqual(["Lifetime $2,450"]);
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

describe("home data: tasks", () => {
  const today = "2026-11-07";

  it("puts today's open plan items first, then recommendations, then donors needing a call", () => {
    const tasks = buildTasks({
      today,
      plan: [
        planItem("a", { donor_id: 1, label: "Rosa Delgado" }),
        planItem("b", { donor_id: 2, label: "Done one", done: true }),
        planItem("c", { donor_id: 3, date: "2026-11-08" }),
        planItem("d", {
          campaign_id: 9,
          label: "Gala thanks",
          note: "Approve",
        }),
      ],
      recommendations: [
        rec("donor-1", { donor_id: 1, label: "Rosa Delgado" }),
        rec("campaign-5", {
          kind: "campaign",
          campaign_id: 5,
          label: "Year end",
        }),
      ],
      donors: [
        donor(1, { full_name: "Rosa Delgado" }),
        donor(7, { full_name: "Marcus Bell", status: "lapsing", score: 90 }),
        donor(8, { status: "on_track" }),
      ],
    });
    expect(tasks.map((t) => [t.key, t.title])).toEqual([
      ["plan-a", "Contact Rosa Delgado"],
      ["plan-d", "Review Gala thanks"],
      ["campaign-5", "Review drafts for Year end"],
      ["donor-7", "Call Marcus Bell"],
    ]);
    expect(tasks[0]).toMatchObject({
      source: "plan",
      planItemId: "a",
      why: "Why 1", // falls back to the donor's why_short
    });
    expect(tasks[1].why).toBe("Approve");
  });

  it("drops dismissed tasks and respects the limit", () => {
    const donors = [1, 2, 3].map((id) =>
      donor(id, { status: "lapsed", score: 10 * id }),
    );
    expect(
      buildTasks({
        today,
        plan: [],
        recommendations: [],
        donors,
        dismissed: new Set(["donor-3"]),
        limit: 1,
      }).map((t) => t.key),
    ).toEqual(["donor-2"]);
  });

  it("links Draft email to a one-donor campaign or the campaign review", () => {
    expect(
      draftEmailHref(
        { kind: "donor", donorId: 4, campaignId: null },
        { status: "lapsing" },
      ),
    ).toBe("/campaigns/new?donors=4&intent=re_engage&channel=email");
    expect(
      draftEmailHref(
        { kind: "campaign", donorId: null, campaignId: 5 },
        undefined,
      ),
    ).toBe("/campaigns/5");
    expect(
      draftEmailHref(
        { kind: "donor", donorId: 4, campaignId: null },
        undefined,
      ),
    ).toBeNull();
  });
});

describe("home data: week and agenda", () => {
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

  it("merges events, plan days and Give Miami Day from today on", () => {
    const lines = agendaLines({
      today: "2026-11-07",
      events: [
        { date: "2026-11-01", label: "Past event" },
        { date: "2026-11-12", label: "Board coffee" },
      ],
      plan: [
        planItem("a", { date: "2026-11-10", donor_id: 1 }),
        planItem("b", { date: "2026-11-10", donor_id: 2 }),
        planItem("c", { date: "2026-11-11", donor_id: 3, done: true }),
      ],
      giveMiamiDay: "2026-11-19",
      limit: 5,
    });
    expect(lines).toEqual([
      { date: "2026-11-10", label: "2 planned contacts" },
      { date: "2026-11-12", label: "Board coffee" },
      { date: "2026-11-19", label: "Give Miami Day" },
    ]);
    expect(
      agendaLines({
        today: "2026-11-07",
        events: [{ date: "2026-11-19", label: "Give Miami Day 2026" }],
        plan: [],
        giveMiamiDay: "2026-11-19",
      }),
    ).toEqual([{ date: "2026-11-19", label: "Give Miami Day 2026" }]);
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
});
