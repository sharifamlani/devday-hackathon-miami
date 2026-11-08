import type {
  CampaignSummary,
  DonorStatus,
  DonorSummary,
  TargetsByPeriod,
} from "../providers/local/types";
import type { AskAnswer, AskIntentKind } from "../providers/local/ask";
import { campaignHref } from "../ask/askChips";
import { formatUsd } from "../contacts/donorFormat";
import { addDays, giveMiamiDayFor, mondayIndex } from "../outreach/dates";
import { itemsOn, type OutreachPlanItem } from "../outreach/outreachPlan";
import type { RecCampaign, Recommendation } from "../outreach/recommend";

/**
 * Pure helpers behind the home board. Every figure is read from the donor
 * service's data (score.py statuses, targets.py totals, campaign counts) or
 * the viewer's outreach plan; nothing here invents a number.
 */

/** "Needs attention" in the inbox: lapsing or lapsed donors. */
export const needsCall = (donor: Pick<DonorSummary, "status">) =>
  donor.status === "lapsing" || donor.status === "lapsed";

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
    targets?.quarter?.give_miami_day?.date ??
    targets?.month?.give_miami_day?.date;
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
  amount == null ? "—" : compactUsd.format(amount).toLowerCase();

export const greeting = (hour: number) =>
  hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";

/** "Denise Shaw" → "Denise"; null when there is no usable name. */
export const firstName = (fullName: string | null | undefined) => {
  const first = fullName?.trim().split(/\s+/)[0];
  return first ? first : null;
};

export const initials = (name: string) =>
  name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0] ?? "")
    .join("")
    .toUpperCase();

/** "2026-10-22" → "Oct 22", read as UTC so no timezone shifts the day. */
export const formatMonthDay = (iso: string | null | undefined) =>
  iso
    ? new Date(`${iso.slice(0, 10)}T00:00:00Z`).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        timeZone: "UTC",
      })
    : "—";

/** "Oct 1 – Dec 31" for a goal period. */
export const formatRange = (start: string, end: string) =>
  `${formatMonthDay(start)} – ${formatMonthDay(end)}`;

const capitalize = (text: string) =>
  text ? text[0].toUpperCase() + text.slice(1) : text;

/* ---------- Donor tags (CRM tile) ---------- */

export type TagTone = "alert" | "warn" | "good" | "quiet";

export interface DonorTag {
  label: string;
  tone: TagTone;
}

type TagDonor = Pick<DonorSummary, "status" | "gift_count">;

/**
 * A short status tag from score.py's status. There is no payment-failure or
 * thank-you feed yet, so "Card failed" and "Thanked" are not shown.
 */
export const donorTag = (donor: TagDonor): DonorTag => {
  if (donor.status === "lapsing") return { label: "Late", tone: "alert" };
  if (donor.status === "lapsed") return { label: "Lapsed", tone: "quiet" };
  if (donor.status === "no_gifts") return { label: "Not yet", tone: "quiet" };
  if (donor.gift_count === 1) return { label: "New", tone: "good" };
  if (donor.status === "due") return { label: "Due", tone: "warn" };
  return { label: "On track", tone: "good" };
};

const ATTENTION: Record<DonorStatus, boolean> = {
  lapsing: true,
  due: true,
  lapsed: true,
  on_track: false,
  no_gifts: false,
};

/** Donors worth a look today: late, due, lapsed or brand new; highest score first. */
export const attentionDonors = <
  T extends Pick<DonorSummary, "status" | "gift_count" | "score">,
>(
  donors: T[],
  limit = 5,
): T[] =>
  donors
    .filter((d) => ATTENTION[d.status] || d.gift_count === 1)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

/** One line under a donor's name: "Monthly · $50" or "First gift Oct 22". */
export const donorMeta = (
  donor: Pick<
    DonorSummary,
    "usual_cadence" | "last_gift_amount" | "last_gift_date" | "gift_count"
  >,
) => {
  if (donor.gift_count === 1 && donor.last_gift_date)
    return `First gift ${formatMonthDay(donor.last_gift_date)}`;
  if (donor.gift_count === 0) return "No gifts yet";
  return [
    donor.usual_cadence ? capitalize(donor.usual_cadence) : null,
    donor.last_gift_amount != null ? formatUsd(donor.last_gift_amount) : null,
  ]
    .filter(Boolean)
    .join(" · ");
};

/** Two or three fact chips for the focused task. */
export const donorFacts = (
  donor: Pick<DonorSummary, "total_given" | "last_gift_date" | "usual_cadence">,
): string[] =>
  [
    `Lifetime ${formatUsd(donor.total_given)}`,
    donor.last_gift_date
      ? `Last gift ${formatMonthDay(donor.last_gift_date)}`
      : null,
    donor.usual_cadence ? capitalize(donor.usual_cadence) : null,
  ].filter((fact): fact is string => fact != null);

/** "priya@example.org" → "p•••@example.org", so the pop-up never shows a full address. */
export const maskEmail = (email: string | null | undefined) => {
  if (!email) return "—";
  const at = email.indexOf("@");
  if (at < 1) return "•••";
  return `${email[0]}•••${email.slice(at)}`;
};

/**
 * The pop-up search: every word must appear in the name, email or
 * organization (case-insensitive). Empty query: the highest scores first.
 */
export const searchDonors = <
  T extends Pick<DonorSummary, "full_name" | "email" | "org_name" | "score">,
>(
  donors: T[],
  query: string,
  limit = 8,
): T[] => {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const hits = words.length
    ? donors.filter((d) => {
        const hay = [d.full_name, d.email, d.org_name]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        return words.every((w) => hay.includes(w));
      })
    : donors;
  return [...hits].sort((a, b) => b.score - a.score).slice(0, limit);
};

/* ---------- Tasks to do today ---------- */

export interface HomeTask {
  key: string;
  /** "plan" = on the viewer's outreach plan today; "agent" = recommended. */
  source: "plan" | "agent";
  kind: "donor" | "campaign";
  title: string;
  why: string;
  donorId: number | null;
  campaignId: number | null;
  planItemId: string | null;
}

/**
 * Today's tasks, in order: open plan items for today, then the outreach
 * agent's recommendations, then other donors who need a call. One task per
 * donor or campaign.
 */
export const buildTasks = ({
  today,
  plan,
  recommendations,
  donors,
  dismissed = new Set<string>(),
  limit = 6,
}: {
  today: string;
  plan: OutreachPlanItem[];
  recommendations: Recommendation[];
  donors: Pick<
    DonorSummary,
    "id" | "full_name" | "status" | "score" | "why_short"
  >[];
  dismissed?: ReadonlySet<string>;
  limit?: number;
}): HomeTask[] => {
  const seen = new Set<string>();
  const tasks: HomeTask[] = [];
  const whyOf = new Map(donors.map((d) => [d.id, d.why_short]));
  const push = (task: HomeTask) => {
    const subject =
      task.donorId != null ? `d${task.donorId}` : `c${task.campaignId}`;
    if (seen.has(subject) || dismissed.has(task.key)) return;
    seen.add(subject);
    tasks.push(task);
  };

  for (const item of itemsOn(plan, today)) {
    if (item.done) {
      // Done today: don't let a recommendation bring the same work back.
      seen.add(
        item.donor_id != null ? `d${item.donor_id}` : `c${item.campaign_id}`,
      );
      continue;
    }
    const isCampaign = item.campaign_id != null;
    push({
      key: `plan-${item.id}`,
      source: "plan",
      kind: isCampaign ? "campaign" : "donor",
      title: `${isCampaign ? "Review" : "Contact"} ${item.label}`,
      why:
        item.note ||
        (item.donor_id != null ? whyOf.get(item.donor_id) : null) ||
        "On today’s plan",
      donorId: item.donor_id,
      campaignId: item.campaign_id,
      planItemId: item.id,
    });
  }
  for (const rec of recommendations) {
    push({
      key: rec.key,
      source: "agent",
      kind: rec.kind,
      title:
        rec.kind === "campaign"
          ? `Review drafts for ${rec.label}`
          : `Call ${rec.label}`,
      why: rec.reason,
      donorId: rec.donor_id,
      campaignId: rec.campaign_id,
      planItemId: null,
    });
  }
  for (const donor of [...donors]
    .filter(needsCall)
    .sort((a, b) => b.score - a.score)) {
    push({
      key: `donor-${donor.id}`,
      source: "agent",
      kind: "donor",
      title: `Call ${donor.full_name}`,
      why: donor.why_short,
      donorId: donor.id,
      campaignId: null,
      planItemId: null,
    });
  }
  return tasks.slice(0, limit);
};

const INTENT: Record<DonorStatus, AskIntentKind> = {
  lapsing: "re_engage",
  lapsed: "re_engage",
  due: "check_in",
  on_track: "thank_you",
  no_gifts: "check_in",
};

/** Where "Draft email" goes: a one-donor campaign draft, or the campaign's review page. */
export const draftEmailHref = (
  task: Pick<HomeTask, "kind" | "donorId" | "campaignId">,
  donor: Pick<DonorSummary, "status"> | undefined,
): string | null => {
  if (task.kind === "campaign" && task.campaignId != null)
    return `/campaigns/${task.campaignId}`;
  if (task.donorId != null && donor)
    return campaignHref([task.donorId], {
      kind: INTENT[donor.status],
      channel_hint: "email",
    });
  return null;
};

/* ---------- Week calendar ---------- */

/** Monday to Sunday of the week holding `today`, as YYYY-MM-DD. */
export const weekDays = (today: string): string[] => {
  const monday = addDays(today, -mondayIndex(today));
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
};

export interface AgendaLine {
  date: string;
  label: string;
}

/**
 * The next few things on the calendar from today on: org events, the
 * viewer's open plan items (several on one day read as one line) and Give
 * Miami Day.
 */
export const agendaLines = ({
  today,
  events,
  plan,
  giveMiamiDay: gmd,
  limit = 3,
}: {
  today: string;
  events: { date: string; label: string }[];
  plan: OutreachPlanItem[];
  giveMiamiDay: string | null;
  limit?: number;
}): AgendaLine[] => {
  const lines: AgendaLine[] = events
    .filter((e) => e.date >= today)
    .map((e) => ({ date: e.date, label: e.label }));
  const hasGmd = lines.some((l) => /give\s*miami\s*day/i.test(l.label));
  if (gmd && gmd >= today && !hasGmd)
    lines.push({ date: gmd, label: "Give Miami Day" });

  const byDay = new Map<string, OutreachPlanItem[]>();
  for (const item of plan) {
    if (item.done || item.date < today) continue;
    byDay.set(item.date, [...(byDay.get(item.date) ?? []), item]);
  }
  for (const [date, items] of byDay) {
    const label =
      items.length === 1
        ? `${items[0].campaign_id != null ? "Review" : "Contact"} ${items[0].label}`
        : `${items.length} planned contacts`;
    lines.push({ date, label });
  }
  return lines.sort((a, b) => a.date.localeCompare(b.date)).slice(0, limit);
};

/* ---------- Agent thread ---------- */

/**
 * The thread keeps each answered question once: a re-run of the same
 * question (a chip edit in the Ask pane) replaces the last entry.
 */
export const appendAnswer = (
  history: AskAnswer[],
  answer: AskAnswer | null,
  max = 20,
): AskAnswer[] => {
  if (!answer) return history;
  const last = history[history.length - 1];
  if (last === answer) return history;
  const base =
    last && last.question === answer.question ? history.slice(0, -1) : history;
  return [...base, answer].slice(-max);
};

export interface AnswerSummary {
  headline: string;
  detail: string | null;
  rows: { id: number; name: string; detail: string }[];
  more: number;
}

/** A compact reading of an Ask answer for the home thread. */
export const answerSummary = (answer: AskAnswer, max = 3): AnswerSummary => {
  if (!answer.understood)
    return {
      headline:
        answer.detail ??
        "I couldn’t read that as a donor question. Try one of the suggestions.",
      detail: null,
      rows: [],
      more: 0,
    };
  const count = answer.donors.length;
  const rows = answer.donors.slice(0, max).map((d) => {
    const amount =
      d.ask && d.ask.period_total > 0 ? d.ask.period_total : d.total_given;
    const date = d.ask?.last_gift_date ?? d.last_gift_date;
    return {
      id: d.id,
      name: d.full_name,
      detail: [formatUsd(amount), date ? formatMonthDay(date) : null]
        .filter(Boolean)
        .join(" · "),
    };
  });
  return {
    headline:
      count === 0
        ? "No donors match."
        : `${count} ${count === 1 ? "donor matches" : "donors match"}.`,
    detail: answer.interpretation || null,
    rows,
    more: Math.max(count - rows.length, 0),
  };
};
