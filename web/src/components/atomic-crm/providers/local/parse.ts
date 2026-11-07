import type {
  ApiDonorDetail,
  ApiDonorRow,
  ApiDuplicate,
  ApiOutreachDraft,
  ApiWhy,
} from "./apiTypes";
import type {
  DonorDetail,
  DonorStatus,
  DonorSummary,
  DuplicatePair,
  FactUsed,
  OutreachDraft,
  ScoreFactor,
} from "./types";

/**
 * The one parser for both data modes: GET responses and snapshot.json share
 * these shapes. Wording here only restates score.py's numbers; nothing is
 * computed that score.py did not compute.
 */

const STATUSES: DonorStatus[] = [
  "lapsing",
  "due",
  "on_track",
  "lapsed",
  "no_gifts",
];

// score.py WEIGHTS: the most points each bucket can contribute.
const POINT_MAX = { urgency: 55, value: 25, frequency: 12, engagement: 8 };

const usd = (n: number) =>
  n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });

const weekdayDate = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });

const longDate = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

export const cadenceLabel = (why: ApiWhy | null): string | null => {
  if (!why?.usual_cadence_days) return null;
  const days = why.usual_cadence_days;
  const base =
    days <= 45
      ? "monthly"
      : days <= 120
        ? "quarterly"
        : days <= 240
          ? "twice a year"
          : days <= 500
            ? "yearly"
            : `every ~${Math.round(days / 365)} yrs`;
  if (why.cadence_basis === "assumed_yearly") return "yearly (assumed)";
  return why.pattern && base === "yearly"
    ? `yearly · ${why.pattern.month_name.slice(0, 3)}`
    : base;
};

/** "2022–2025" for consecutive years, else "2021, 2023, 2025". */
const yearSpan = (years: number[]) => {
  const sorted = [...years].sort();
  const consecutive = sorted.every((y, i) => i === 0 || y === sorted[i - 1] + 1);
  return consecutive && sorted.length > 1
    ? `${sorted[0]}–${sorted[sorted.length - 1]}`
    : sorted.join(", ");
};

const isGiveMiamiDayGiver = (why: ApiWhy) =>
  why.pattern?.channel === "Give Miami Day" ||
  why.last_gift?.channel === "Give Miami Day";

export const whyShort = (why: ApiWhy | null): string => {
  if (!why) return "not scored yet";
  const year = why.as_of.slice(0, 4);
  const reasons = new Set(why.reasons);
  let text: string;
  if (reasons.has("no_gifts")) {
    text = "no gifts on record";
  } else if (reasons.has("missed_seasonal_window") && why.pattern) {
    text = isGiveMiamiDayGiver(why)
      ? `gave on Give Miami Day ${yearSpan(why.pattern.years)}; not yet in ${year}`
      : `usually gives in ${why.pattern.month_name}; not yet in ${year}`;
  } else if (reasons.has("seasonal_window_next_month") && why.pattern) {
    text = `usual ${why.pattern.month_name} gift is next month`;
  } else if (reasons.has("overdue_vs_cadence")) {
    text = `${why.days_since_last_gift} days since last gift vs. usual ${why.usual_cadence_days}`;
  } else if (why.status === "lapsed") {
    text = `no gift in ${why.days_since_last_gift} days`;
  } else if (reasons.has("gave_recently_vs_cadence")) {
    text = "gave recently; on schedule";
  } else if (reasons.has("single_gift")) {
    text = "one gift so far";
  } else {
    text = why.status.replace("_", " ");
  }
  if (why.give_miami_day && isGiveMiamiDayGiver(why) && why.status !== "on_track") {
    text += ` · Give Miami Day in ${plural(why.give_miami_day.days_away, "day")}`;
  }
  return text;
};

/** The drawer's WHY paragraph: score.py's facts, in plain words. */
export const whySentence = (why: ApiWhy | null): string => {
  if (!why) return "This donor has not been scored yet.";
  if (why.reasons.includes("no_gifts") || !why.last_gift) {
    return "No gifts on record yet, so there is nothing to score.";
  }
  const parts: string[] = [];
  const year = why.as_of.slice(0, 4);
  if (why.pattern && why.pattern.years.length > 1) {
    const via = why.pattern.channel ? `, usually via ${why.pattern.channel}` : "";
    parts.push(
      `Gave every ${why.pattern.month_name} ${yearSpan(why.pattern.years)}${via}.`,
    );
  } else if (why.gift_count > 1 && why.usual_cadence_days) {
    parts.push(
      `${plural(why.gift_count, "gift")}, about every ${why.usual_cadence_days} days.`,
    );
  }
  parts.push(
    `Last gift ${usd(why.last_gift.amount)} on ${longDate(why.last_gift.date)} (${plural(
      why.days_since_last_gift ?? 0,
      "day",
    )} ago).`,
  );
  if (why.status === "lapsing" || why.status === "due") {
    if (why.gave_this_year === false) parts.push(`Nothing yet in ${year}.`);
    if (why.give_miami_day && isGiveMiamiDayGiver(why)) {
      parts.push(
        `Give Miami Day is ${weekdayDate(why.give_miami_day.date)}, ${plural(
          why.give_miami_day.days_away,
          "day",
        )} away.`,
      );
    } else if (why.days_left_in_year != null) {
      parts.push(`${plural(why.days_left_in_year, "day")} left in the year.`);
    }
  }
  if (why.reasons.includes("shack_society_level")) {
    parts.push("Shack Society level: $1M+ lifetime.");
  }
  return parts.join(" ");
};

const scoreFactors = (why: ApiWhy | null): ScoreFactor[] => {
  if (!why?.points) return [];
  const p = why.points;
  return [
    {
      label: "Urgency",
      points: p.urgency,
      max: POINT_MAX.urgency,
      detail: `${why.days_since_last_gift} days since last gift vs. usual ${why.usual_cadence_days}`,
    },
    {
      label: "Value",
      points: p.value,
      max: POINT_MAX.value,
      detail: `${usd(why.lifetime_total ?? 0)} lifetime`,
    },
    {
      label: "Frequency",
      points: p.frequency,
      max: POINT_MAX.frequency,
      detail: plural(why.gift_count, "gift"),
    },
    {
      label: "Engagement",
      points: p.engagement,
      max: POINT_MAX.engagement,
      detail: why.gave_this_year ? "gave this year" : "recent activity",
    },
  ];
};

const parseFactsUsed = (raw: ApiOutreachDraft["facts_used"]): FactUsed[] => {
  let list: unknown = raw;
  if (typeof raw === "string") {
    try {
      list = JSON.parse(raw);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(list)) return [];
  return list
    .map((f) => ({
      fact: String(f?.fact ?? ""),
      source_url: String(f?.source_url ?? f?.url ?? ""),
    }))
    .filter((f) => f.fact && f.source_url);
};

const parseDraft = (raw: ApiOutreachDraft): OutreachDraft => ({
  id: raw.id,
  channel: raw.channel,
  subject: raw.subject,
  body: raw.body,
  call_script: raw.call_script ?? null,
  facts_used: parseFactsUsed(raw.facts_used),
  status: raw.status,
  approved_by: raw.approved_by,
  approved_at: raw.approved_at,
});

export const parseDonorRow = (row: ApiDonorRow): DonorSummary => {
  const why = row.why;
  return {
    id: row.id,
    full_name: row.full_name,
    org_name: row.org_name,
    donor_type: row.donor_type ?? (row.org_name ? "organization" : "individual"),
    email: row.email,
    city: row.city,
    fund_type: row.fund_type,
    tier: row.tier ?? "small",
    is_star: !!row.is_star,
    score: row.score ?? 0,
    status: STATUSES.includes(row.status as DonorStatus)
      ? (row.status as DonorStatus)
      : "no_gifts",
    why_short: whyShort(why),
    last_gift_date: why?.last_gift?.date ?? null,
    last_gift_amount: why?.last_gift?.amount ?? null,
    usual_cadence: cadenceLabel(why),
    gift_count: why?.gift_count ?? 0,
    total_given: why?.lifetime_total ?? 0,
    give_miami_day_days_away: why?.give_miami_day?.days_away ?? null,
  };
};

export const parseDonorDetail = (raw: ApiDonorDetail): DonorDetail => ({
  ...parseDonorRow(raw),
  phone: raw.phone,
  notes: raw.notes,
  why: whySentence(raw.why),
  score_factors: scoreFactors(raw.why),
  gifts: (raw.gifts ?? []).map(
    ({ id, amount, gift_date, channel, fund_type }) => ({
      id,
      amount,
      gift_date,
      channel,
      fund_type,
    }),
  ),
  research: (raw.research_facts ?? []).map(
    ({ id, fact, source_url, retrieved_at }) => ({
      id,
      fact,
      source_url,
      retrieved_at,
    }),
  ),
  // outreach_drafts comes newest first.
  draft: raw.outreach_drafts?.length ? parseDraft(raw.outreach_drafts[0]) : null,
});

export const parseDuplicate = (raw: ApiDuplicate): DuplicatePair => {
  const side = (row: ApiDonorRow | null, id: number, giftCount: number) => ({
    id,
    full_name: row?.full_name ?? `Donor ${id}`,
    email: row?.email ?? null,
    city: row?.city ?? null,
    gift_count: giftCount,
    total_given: row?.why?.lifetime_total ?? 0,
  });
  return {
    id: raw.id,
    reasons: raw.reasons,
    confidence: raw.confidence,
    donors: [
      side(raw.donor_a, raw.donor_a_id, raw.donor_a_gift_count),
      side(raw.donor_b, raw.donor_b_id, raw.donor_b_gift_count),
    ],
  };
};
