import type { ApiTarget } from "./apiTypes";
import { parseTargets } from "./parse";

// GET /targets?period=quarter on the seed as of 2026-11-07 (SAMPLE goal).
const quarter: ApiTarget = {
  period: "quarter",
  label: "Q4 2026",
  start: "2026-10-01",
  end: "2026-12-31",
  as_of: "2026-11-07",
  goal: 150000,
  goal_is_sample: true,
  raised: 50050,
  percent: 33.4,
  days_left: 54,
  donors_count: 2,
  gifts_count: 2,
  by_channel: [
    { channel: "check", amount: 50000 },
    { channel: "online", amount: 50 },
  ],
  new_vs_returning: {
    new: 0,
    returning: 2,
    new_amount: 0,
    returning_amount: 50050,
  },
  give_miami_day: { date: "2026-11-19", days_until: 12, in_period: true },
  top_donor_ids: [9, 3],
  donor_ids: [9, 3],
};

describe("parseTargets", () => {
  it("reads both periods from GET /targets", () => {
    const month = { ...quarter, period: "month" as const, label: "November 2026" };
    const out = parseTargets({ month, quarter });
    expect(out.month?.label).toBe("November 2026");
    expect(out.quarter?.raised).toBe(50050);
    expect(out.quarter?.returning_donors).toBe(2);
    expect(out.quarter?.give_miami_day?.days_until).toBe(12);
  });

  it("reads one period from GET /targets?period=", () => {
    expect(Object.keys(parseTargets(quarter))).toEqual(["quarter"]);
  });

  it("falls back to top_donor_ids and tolerates an old snapshot", () => {
    const { donor_ids: _omit, ...older } = quarter;
    void _omit;
    expect(parseTargets(older).quarter?.donor_ids).toEqual([9, 3]);
    expect(parseTargets(undefined)).toEqual({});
    expect(parseTargets(null)).toEqual({});
  });
});
