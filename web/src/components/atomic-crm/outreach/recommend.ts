import { formatMonthYear } from "../contacts/donorFormat";
import type { DonorStatus, DonorSummary } from "../providers/local/types";
import {
  addWorkdays,
  daysBetween,
  onOrNextWorkday,
  previousWorkday,
} from "./dates";
import { isPlannedFrom, type OutreachPlanItem } from "./outreachPlan";

/**
 * "Recommended by the outreach agent": plain rules over the donor data, no
 * model call. Each recommendation names who, which day and one line of why.
 * Every number it reads comes from score.py (score, status, tier, star, Give
 * Miami Day distance); this file only orders them and spreads them over days.
 */

export type RecDonor = Pick<
  DonorSummary,
  | "id"
  | "full_name"
  | "donor_type"
  | "status"
  | "tier"
  | "is_star"
  | "score"
  | "why_short"
  | "last_gift_date"
  | "give_miami_day_days_away"
>;

/** A campaign with drafts waiting, and its end date when one is known. */
export interface RecCampaign {
  id: number;
  name: string;
  drafts: number;
  ends_on?: string | null; // YYYY-MM-DD
}

/** A gift-alert signal (e.g. a missed monthly gift) when an alerts feed exists. */
export interface RecAlert {
  donor_id: number;
  label: string; // "Monthly gift missed in October"
}

export interface Recommendation {
  key: string; // "donor-12" | "campaign-3"
  kind: "donor" | "campaign";
  donor_id: number | null;
  campaign_id: number | null;
  label: string;
  date: string; // suggested day, always a weekday
  reason: string; // one line, shown under the name
  priority: number; // higher first; 0-150ish, for ordering and the bar
}

export interface RecommendOptions {
  today: string; // YYYY-MM-DD
  plan?: OutreachPlanItem[];
  campaigns?: RecCampaign[];
  alerts?: RecAlert[];
  /** Give Miami Day as reported by the service, if known. */
  giveMiamiDay?: string | null;
  limit?: number; // default 8
  perDay?: number; // most donor recommendations on one day, default 3
}

const STATUS_POINTS: Record<DonorStatus, number> = {
  lapsing: 25,
  due: 15,
  lapsed: 8,
  on_track: 0,
  no_gifts: 0,
};

const STATUS_HEADLINE: Record<DonorStatus, string> = {
  lapsing: "Lapsing",
  due: "Due for a gift",
  lapsed: "Lapsed",
  on_track: "On track",
  no_gifts: "No gifts yet",
};

/** Within this many days, Give Miami Day pulls outreach forward. */
export const GIVE_MIAMI_DAY_WINDOW = 21;
/** A donor contacted (marked done) this recently is left alone. */
export const RECENTLY_DONE_DAYS = 14;

const gmdSoon = (donor: RecDonor) =>
  donor.give_miami_day_days_away != null &&
  donor.give_miami_day_days_away >= 0 &&
  donor.give_miami_day_days_away <= GIVE_MIAMI_DAY_WINDOW;

const who = (donor: RecDonor) =>
  donor.is_star
    ? "star donor"
    : donor.tier === "big"
      ? "big donor"
      : donor.donor_type === "organization"
        ? "organization"
        : null;

/**
 * Should this donor be recommended at all, and how strongly? null = no.
 * on_track donors only qualify as star or big donors before Give Miami Day.
 */
export const scoreDonor = (
  donor: RecDonor,
  alert?: RecAlert | null,
): { priority: number; workdaysOut: number } | null => {
  const eligible =
    alert != null ||
    donor.status === "lapsing" ||
    donor.status === "due" ||
    donor.status === "lapsed" ||
    (donor.status === "on_track" &&
      (donor.is_star || donor.tier === "big") &&
      gmdSoon(donor));
  if (!eligible) return null;

  let priority = donor.score + STATUS_POINTS[donor.status];
  if (donor.is_star) priority += 12;
  if (donor.tier === "big") priority += 8;
  else if (donor.tier === "mid") priority += 3;
  if (gmdSoon(donor)) {
    // Closer is stronger: 10 points on the day, fading out over the window.
    priority += Math.round(
      10 * (1 - (donor.give_miami_day_days_away ?? 0) / GIVE_MIAMI_DAY_WINDOW),
    );
  }
  if (alert) priority += 20;

  const important = donor.is_star || donor.tier === "big";
  const workdaysOut = alert
    ? 0
    : donor.status === "lapsing"
      ? important
        ? 0
        : 1
      : donor.status === "due"
        ? 2
        : donor.status === "lapsed"
          ? 3
          : 4;
  return { priority, workdaysOut };
};

export const donorReason = (
  donor: RecDonor,
  alert?: RecAlert | null,
): string => {
  const kind = who(donor);
  const parts = [
    kind ? `${STATUS_HEADLINE[donor.status]} ${kind}` : STATUS_HEADLINE[donor.status],
  ];
  if (alert) parts.push(alert.label);
  if (donor.why_short) parts.push(donor.why_short);
  else if (donor.last_gift_date)
    parts.push(`last gift ${formatMonthYear(donor.last_gift_date)}`);
  if (gmdSoon(donor)) {
    const days = donor.give_miami_day_days_away ?? 0;
    parts.push(
      days === 0
        ? "Give Miami Day is today"
        : `Give Miami Day in ${days} ${days === 1 ? "day" : "days"}`,
    );
  }
  return parts.join(" · ");
};

export const campaignReason = (campaign: RecCampaign, today: string) => {
  const parts = [
    `${campaign.drafts} ${campaign.drafts === 1 ? "draft" : "drafts"} waiting for your approval`,
  ];
  if (campaign.ends_on) {
    const days = daysBetween(today, campaign.ends_on);
    if (days >= 0)
      parts.push(
        days === 0 ? "ends today" : `ends in ${days} ${days === 1 ? "day" : "days"}`,
      );
  }
  return parts.join(" · ");
};

const recentlyDone = (
  plan: OutreachPlanItem[],
  target: { donor_id?: number; campaign_id?: number },
  today: string,
) =>
  plan.some(
    (item) =>
      item.done &&
      (target.donor_id != null
        ? item.donor_id === target.donor_id
        : item.campaign_id === target.campaign_id) &&
      daysBetween(item.date, today) <= RECENTLY_DONE_DAYS,
  );

/**
 * Who to contact on which day. Donors already planned (open, today or later)
 * or contacted in the last two weeks are skipped. Each donor gets a target
 * weekday from its urgency, never after the weekday before Give Miami Day when
 * that is close, and days fill up to `perDay` before spilling to the next one.
 */
export const recommendOutreach = (
  donors: RecDonor[],
  options: RecommendOptions,
): Recommendation[] => {
  const {
    today,
    plan = [],
    campaigns = [],
    alerts = [],
    giveMiamiDay = null,
    limit = 8,
    perDay = 3,
  } = options;
  const firstDay = onOrNextWorkday(today);
  const alertFor = new Map(alerts.map((alert) => [alert.donor_id, alert]));
  const gmdCutoff =
    giveMiamiDay && daysBetween(today, giveMiamiDay) > 1
      ? previousWorkday(giveMiamiDay)
      : null;

  const campaignRecs: Recommendation[] = campaigns
    .filter(
      (campaign) =>
        campaign.drafts > 0 &&
        !isPlannedFrom(plan, { campaign_id: campaign.id }, today) &&
        !recentlyDone(plan, { campaign_id: campaign.id }, today),
    )
    .map((campaign) => {
      const endsSoon =
        campaign.ends_on != null &&
        daysBetween(today, campaign.ends_on) >= 0 &&
        daysBetween(today, campaign.ends_on) <= 14;
      return {
        key: `campaign-${campaign.id}`,
        kind: "campaign" as const,
        donor_id: null,
        campaign_id: campaign.id,
        label: campaign.name,
        date: firstDay,
        reason: campaignReason(campaign, today),
        priority: 70 + Math.min(campaign.drafts, 30) + (endsSoon ? 20 : 0),
      };
    });

  const scored = donors
    .filter(
      (donor) =>
        !isPlannedFrom(plan, { donor_id: donor.id }, today) &&
        !recentlyDone(plan, { donor_id: donor.id }, today),
    )
    .flatMap((donor) => {
      const alert = alertFor.get(donor.id) ?? null;
      const result = scoreDonor(donor, alert);
      return result ? [{ donor, alert, ...result }] : [];
    })
    .sort((a, b) => b.priority - a.priority || a.donor.id - b.donor.id)
    .slice(0, limit);

  const load = new Map<string, number>();
  const donorRecs: Recommendation[] = scored.map(
    ({ donor, alert, priority, workdaysOut }) => {
      let day = addWorkdays(firstDay, workdaysOut);
      if (gmdCutoff && gmdSoon(donor) && day > gmdCutoff) day = gmdCutoff;
      if (day < firstDay) day = firstDay;
      while ((load.get(day) ?? 0) >= perDay) day = addWorkdays(day, 1);
      load.set(day, (load.get(day) ?? 0) + 1);
      return {
        key: `donor-${donor.id}`,
        kind: "donor" as const,
        donor_id: donor.id,
        campaign_id: null,
        label: donor.full_name,
        date: day,
        reason: donorReason(donor, alert),
        priority,
      };
    },
  );

  return [...campaignRecs, ...donorRecs]
    .sort((a, b) => a.date.localeCompare(b.date) || b.priority - a.priority)
    .slice(0, limit);
};
