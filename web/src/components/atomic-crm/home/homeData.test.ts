import { describe, expect, it } from "vitest";

import type { CampaignSummary, DonationTarget } from "../providers/local/types";
import {
  campaignProgress,
  draftsAwaiting,
  featuredCampaign,
  giveMiamiDay,
  goalEnds,
  toRecCampaigns,
} from "./homeData";

const campaign = (
  id: number,
  created_at: string,
  status: "draft" | "sent",
  counts: Partial<CampaignSummary["counts"]> = {},
): CampaignSummary => ({
  id,
  name: `Campaign ${id}`,
  intent: "thank_you",
  channel: "email",
  created_at,
  created_by: null,
  status,
  counts: {
    total: 10,
    draft: 4,
    approved: 3,
    sent: 2,
    skipped: 1,
    needs_individual_approval: 0,
    flagged: 0,
    bulk_approvable: 0,
    ...counts,
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

describe("home data", () => {
  it("sums drafts and picks the newest campaign still in draft", () => {
    const list = [
      campaign(1, "2026-11-01T10:00:00Z", "draft"),
      campaign(2, "2026-11-05T10:00:00Z", "sent", { draft: 0 }),
      campaign(3, "2026-11-03T10:00:00Z", "draft", { draft: 2 }),
    ];
    expect(draftsAwaiting(list)).toBe(6);
    expect(featuredCampaign(list)?.id).toBe(3);
    expect(featuredCampaign([list[1]])?.id).toBe(2);
    expect(featuredCampaign([])).toBeNull();
    expect(toRecCampaigns(list).map((c) => [c.id, c.drafts])).toEqual([
      [1, 4],
      [3, 2],
    ]);
  });

  it("counts approved and sent against messages not skipped", () => {
    expect(campaignProgress(campaign(1, "", "draft")).percent).toBe(56); // 5 of 9
    expect(
      campaignProgress(
        campaign(1, "", "draft", {
          total: 0,
          draft: 0,
          approved: 0,
          sent: 0,
          skipped: 0,
        }),
      ).percent,
    ).toBe(0);
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
});
