import type {
  CampaignSummary,
  DonorSummary,
  TargetsByPeriod,
} from "../providers/local/types";
import { giveMiamiDayFor } from "../outreach/dates";
import type { RecCampaign } from "../outreach/recommend";

/**
 * Pure helpers behind the home dashboard. Every figure is read from the donor
 * service's data (score.py statuses, targets.py totals, campaign counts);
 * nothing here invents a number.
 */

/** "Needs attention" in the inbox: lapsing or lapsed donors. */
export const needsCall = (donor: Pick<DonorSummary, "status">) =>
  donor.status === "lapsing" || donor.status === "lapsed";

/** Campaign messages still waiting for a human. */
export const draftsAwaiting = (campaigns: CampaignSummary[]) =>
  campaigns.reduce((sum, campaign) => sum + campaign.counts.draft, 0);

/** The campaign worth showing: the newest one still in draft, else the newest. */
export const featuredCampaign = (
  campaigns: CampaignSummary[],
): CampaignSummary | null => {
  const newest = [...campaigns].sort((a, b) =>
    b.created_at.localeCompare(a.created_at),
  );
  return newest.find((c) => c.status === "draft") ?? newest[0] ?? null;
};

export interface CampaignProgress {
  total: number;
  sent: number;
  approved: number;
  draft: number;
  skipped: number;
  /** Sent or approved, as a whole percent of the messages not skipped. */
  percent: number;
}

export const campaignProgress = (
  campaign: CampaignSummary,
): CampaignProgress => {
  const { total, sent, approved, draft, skipped } = campaign.counts;
  const counted = Math.max(total - skipped, 0);
  return {
    total,
    sent,
    approved,
    draft,
    skipped,
    percent: counted ? Math.round(((sent + approved) / counted) * 100) : 0,
  };
};

/** Campaigns as the recommendation rules read them (no end date in the API yet). */
export const toRecCampaigns = (campaigns: CampaignSummary[]): RecCampaign[] =>
  campaigns
    .filter((campaign) => campaign.status === "draft")
    .map((campaign) => ({
      id: campaign.id,
      name: campaign.name,
      drafts: campaign.counts.draft,
      ends_on: null,
    }));

/**
 * Days a fundraising window closes, for the calendar's "ends" mark. Campaigns
 * carry no end date yet, so these are the month and quarter goal periods from
 * GET /targets.
 */
export const goalEnds = (targets: TargetsByPeriod | undefined) =>
  (["month", "quarter"] as const).flatMap((period) => {
    const target = targets?.[period];
    return target ? [{ date: target.end, label: `${target.label} goal` }] : [];
  });

/** Give Miami Day from the service when it reports one, else this year's (or next year's) date. */
export const giveMiamiDay = (
  targets: TargetsByPeriod | undefined,
  today: string,
): string => {
  const reported =
    targets?.quarter?.give_miami_day?.date ?? targets?.month?.give_miami_day?.date;
  if (reported) return reported.slice(0, 10);
  const year = Number(today.slice(0, 4));
  const thisYear = giveMiamiDayFor(year);
  return thisYear >= today ? thisYear : giveMiamiDayFor(year + 1);
};

const compactUsd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  notation: "compact",
  maximumFractionDigits: 1,
});

export const formatCompactUsd = (amount: number | null | undefined) =>
  amount == null ? "—" : compactUsd.format(amount);

export const greeting = (hour: number) =>
  hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";

export const initials = (name: string) =>
  name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0] ?? "")
    .join("")
    .toUpperCase();
