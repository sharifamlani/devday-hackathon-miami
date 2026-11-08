import { describe, expect, it } from "vitest";

import { computeDayMarks, describeDay, monthWeeks } from "./calendarMonth";
import {
  addWorkdays,
  daysBetween,
  giveMiamiDayFor,
  onOrNextWorkday,
} from "./dates";
import {
  addPlanItem,
  isPlannedFrom,
  itemsOn,
  parsePlan,
  planStorageKey,
  readPlan,
  removePlanItem,
  updatePlanItem,
  writePlan,
  type OutreachPlanItem,
} from "./outreachPlan";
import { recommendOutreach, scoreDonor, type RecDonor } from "./recommend";

const NOW = new Date("2026-11-08T15:00:00Z");

const donor = (overrides: Partial<RecDonor> & { id: number }): RecDonor => ({
  full_name: `Donor ${overrides.id}`,
  donor_type: "individual",
  status: "due",
  tier: "small",
  is_star: false,
  score: 50,
  why_short: "Usually gives in November",
  last_gift_date: "2025-11-20",
  give_miami_day_days_away: 11,
  ...overrides,
});

const memoryStorage = () => {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
  };
};

describe("dates", () => {
  it("finds Give Miami Day as the third Thursday of November", () => {
    expect(giveMiamiDayFor(2026)).toBe("2026-11-19");
    expect(giveMiamiDayFor(2025)).toBe("2025-11-20");
  });

  it("skips weekends when counting workdays", () => {
    // 2026-11-08 is a Sunday.
    expect(onOrNextWorkday("2026-11-08")).toBe("2026-11-09");
    expect(addWorkdays("2026-11-13", 1)).toBe("2026-11-16");
    expect(daysBetween("2026-11-08", "2026-11-19")).toBe(11);
  });
});

describe("outreach plan storage", () => {
  it("adds, dedupes per day, updates and removes", () => {
    let items: OutreachPlanItem[] = [];
    items = addPlanItem(items, { date: "2026-11-10", donor_id: 4, label: "Rosa" }, NOW);
    const again = addPlanItem(items, { date: "2026-11-10", donor_id: 4, label: "Rosa" }, NOW);
    expect(again).toBe(items);
    items = addPlanItem(items, { date: "2026-11-11", donor_id: 4, label: "Rosa" }, NOW);
    items = addPlanItem(items, { date: "2026-11-10", campaign_id: 2, label: "Thank-you" }, NOW);
    expect(items).toHaveLength(3);

    const [first] = items;
    items = updatePlanItem(items, first.id, { done: true, note: "Left a voicemail" });
    expect(itemsOn(items, "2026-11-10").map((i) => i.label)).toEqual(["Thank-you", "Rosa"]);
    expect(items[0]).toMatchObject({ done: true, note: "Left a voicemail" });

    items = removePlanItem(items, first.id);
    expect(items).toHaveLength(2);
  });

  it("rejects an item naming neither or both targets, or a bad date", () => {
    expect(addPlanItem([], { date: "2026-11-10", label: "x" }, NOW)).toEqual([]);
    expect(
      addPlanItem([], { date: "2026-11-10", donor_id: 1, campaign_id: 2, label: "x" }, NOW),
    ).toEqual([]);
    expect(addPlanItem([], { date: "Nov 10", donor_id: 1, label: "x" }, NOW)).toEqual([]);
  });

  it("round-trips through storage per viewer and ignores junk", () => {
    const storage = memoryStorage();
    const items = addPlanItem([], { date: "2026-11-10", donor_id: 4, label: "Rosa" }, NOW);
    expect(writePlan(storage, planStorageKey(7), items)).toBe(true);
    expect(readPlan(storage, planStorageKey(7))).toEqual(items);
    expect(readPlan(storage, planStorageKey(null))).toEqual([]);
    expect(planStorageKey(null)).toBe("donor-desk:outreach-plan:v1:guest");

    expect(parsePlan("not json")).toEqual([]);
    expect(parsePlan('{"a":1}')).toEqual([]);
    expect(
      parsePlan(JSON.stringify([{ id: "a", date: "2026-11-10" }, { ...items[0] }])),
    ).toHaveLength(1);
  });

  it("survives a storage that throws", () => {
    const broken = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("quota");
      },
    };
    expect(readPlan(broken, "k")).toEqual([]);
    expect(writePlan(broken, "k", [])).toBe(false);
    expect(readPlan(null, "k")).toEqual([]);
  });

  it("knows what is still planned from a day on", () => {
    const items = addPlanItem([], { date: "2026-11-10", donor_id: 4, label: "Rosa" }, NOW);
    expect(isPlannedFrom(items, { donor_id: 4 }, "2026-11-09")).toBe(true);
    expect(isPlannedFrom(items, { donor_id: 4 }, "2026-11-11")).toBe(false);
    const done = updatePlanItem(items, items[0].id, { done: true });
    expect(isPlannedFrom(done, { donor_id: 4 }, "2026-11-09")).toBe(false);
  });
});

describe("recommendations", () => {
  const today = "2026-11-09"; // Monday

  it("ranks lapsing star donors first and plans them for today", () => {
    const recs = recommendOutreach(
      [
        donor({ id: 1, status: "due", score: 60 }),
        donor({ id: 2, status: "lapsing", is_star: true, score: 70 }),
        donor({ id: 3, status: "on_track", score: 90 }),
        donor({ id: 4, status: "no_gifts", score: 99 }),
      ],
      { today },
    );
    expect(recs.map((r) => r.donor_id)).toEqual([2, 1]);
    expect(recs[0]).toMatchObject({ date: "2026-11-09", kind: "donor" });
    expect(recs[0].reason).toMatch(/^Lapsing star donor · /);
    expect(recs[0].reason).toContain("Give Miami Day in 11 days");
    expect(recs[1].date).toBe("2026-11-11"); // due: two workdays out
  });

  it("only recommends on-track donors when star or big before Give Miami Day", () => {
    expect(scoreDonor(donor({ id: 1, status: "on_track" }))).toBeNull();
    expect(scoreDonor(donor({ id: 1, status: "on_track", tier: "big" }))).not.toBeNull();
    expect(
      scoreDonor(donor({ id: 1, status: "on_track", tier: "big", give_miami_day_days_away: 40 })),
    ).toBeNull();
  });

  it("gift alerts make an otherwise quiet donor urgent", () => {
    const recs = recommendOutreach([donor({ id: 9, status: "on_track" })], {
      today,
      alerts: [{ donor_id: 9, label: "Monthly gift missed in October" }],
    });
    expect(recs).toHaveLength(1);
    expect(recs[0].date).toBe(today);
    expect(recs[0].reason).toContain("Monthly gift missed in October");
  });

  it("skips donors already planned or contacted in the last two weeks", () => {
    let plan = addPlanItem([], { date: "2026-11-12", donor_id: 1, label: "One" }, NOW);
    plan = addPlanItem(plan, { date: "2026-11-02", donor_id: 2, label: "Two" }, NOW);
    plan = updatePlanItem(plan, plan[1].id, { done: true });
    const recs = recommendOutreach(
      [donor({ id: 1 }), donor({ id: 2 }), donor({ id: 3 })],
      { today, plan },
    );
    expect(recs.map((r) => r.donor_id)).toEqual([3]);
  });

  it("spreads donors over days and never past the day before Give Miami Day", () => {
    const donors = Array.from({ length: 5 }, (_, i) =>
      donor({ id: i + 1, status: "lapsing", score: 80 - i }),
    );
    const recs = recommendOutreach(donors, { today, perDay: 2 });
    const perDay = recs.reduce<Record<string, number>>((acc, r) => {
      acc[r.date] = (acc[r.date] ?? 0) + 1;
      return acc;
    }, {});
    expect(Math.max(...Object.values(perDay))).toBeLessThanOrEqual(2);

    const late = recommendOutreach(
      [donor({ id: 1, status: "lapsed", give_miami_day_days_away: 3 })],
      { today: "2026-11-16", giveMiamiDay: "2026-11-19" },
    );
    expect(late[0].date <= "2026-11-18").toBe(true);
  });

  it("recommends reviewing campaigns with drafts waiting, sooner when ending", () => {
    const recs = recommendOutreach([], {
      today,
      campaigns: [
        { id: 1, name: "Thank-you", drafts: 4, ends_on: "2026-11-19" },
        { id: 2, name: "Old", drafts: 0 },
      ],
    });
    expect(recs).toHaveLength(1);
    expect(recs[0]).toMatchObject({ kind: "campaign", campaign_id: 1, date: today });
    expect(recs[0].reason).toBe("4 drafts waiting for your approval · ends in 10 days");
  });
});

describe("calendar month", () => {
  it("builds Monday-first weeks covering the month", () => {
    const weeks = monthWeeks(2026, 10); // November 2026 starts on a Sunday
    expect(weeks[0][0].date).toBe("2026-10-26");
    expect(weeks[0][6]).toMatchObject({ date: "2026-11-01", inMonth: true });
    expect(weeks.at(-1)!.at(-1)!.date).toBe("2026-12-06");
    expect(weeks.every((w) => w.length === 7)).toBe(true);
  });

  it("computes dots for planned, done, campaign ends, events and Give Miami Day", () => {
    let plan = addPlanItem([], { date: "2026-11-10", donor_id: 1, label: "A" }, NOW);
    plan = addPlanItem(plan, { date: "2026-11-10", donor_id: 2, label: "B" }, NOW);
    plan = updatePlanItem(plan, plan[1].id, { done: true });
    const marks = computeDayMarks({
      plan,
      campaignEnds: [{ date: "2026-12-31", label: "Q4 2026 goal" }],
      events: [{ date: "2026-11-15T07:30:00", label: "Give Miami 5K" }],
      giveMiamiDay: "2026-11-19",
    });
    expect(marks.get("2026-11-10")).toMatchObject({ planned: 1, done: 1 });
    expect(marks.get("2026-12-31")?.campaignEnds).toEqual(["Q4 2026 goal"]);
    expect(marks.get("2026-11-15")?.events).toEqual(["Give Miami 5K"]);
    expect(marks.get("2026-11-19")?.giveMiamiDay).toBe(true);
    expect(marks.has("2026-11-11")).toBe(false);

    expect(describeDay("2026-11-19", marks.get("2026-11-19"), "2026-11-08")).toBe(
      "Thursday, November 19, 2026. Give Miami Day",
    );
    expect(describeDay("2026-11-10", marks.get("2026-11-10"), "2026-11-10")).toBe(
      "Tuesday, November 10, 2026, today. 1 outreach planned. 1 outreach done",
    );
  });
});
