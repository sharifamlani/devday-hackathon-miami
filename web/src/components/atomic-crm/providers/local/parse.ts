import type {
  ApiDonorDetail,
  ApiDonorRow,
  ApiDuplicate,
  ApiEvidence,
  ApiIcpProfile,
  ApiJson,
  ApiOutreachDraft,
  ApiProspect,
  ApiWhy,
} from "./apiTypes";
import type {
  DonorDetail,
  DonorStatus,
  DonorSummary,
  DuplicatePair,
  FactUsed,
  IcpEvidence,
  IcpProfile,
  IcpStat,
  IcpTrait,
  OutreachDraft,
  ProspectDetail,
  ProspectStatus,
  ProspectSummary,
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

/** SQLite JSON columns may arrive as text or already parsed. */
const fromJson = <T>(raw: ApiJson<T>): T | null => {
  if (raw == null) return null;
  if (typeof raw !== "string") return raw;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
};

/** {fact, url} or {fact, source_url}; drops anything without both. */
const parseFactsUsed = (raw: ApiJson<unknown>): FactUsed[] => {
  const list = fromJson(raw);
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
    is_sample: !!row.is_sample,
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

/* ---------- ICP + prospects ---------- */

/** "giving_style" → "Giving style" */
const humanize = (key: string) => {
  const words = key.replace(/[_-]+/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
};

const asText = (value: unknown): string => {
  if (value == null) return "";
  if (typeof value === "number") return value.toLocaleString("en-US");
  if (Array.isArray(value)) return value.map(asText).filter(Boolean).join(", ");
  if (typeof value === "object") {
    return Object.entries(value as Record<string, unknown>)
      .map(([k, v]) => `${humanize(k)}: ${asText(v)}`)
      .join(" · ");
  }
  return String(value);
};

const parseEvidence = (raw: ApiJson<unknown>): IcpEvidence[] => {
  const list = fromJson(raw);
  if (!Array.isArray(list)) return [];
  return (list as ApiEvidence[])
    .map((e) => ({
      donor: e?.donor ?? e?.donor_name ?? null,
      fact: String(e?.fact ?? ""),
      source_url: String(e?.source_url ?? e?.url ?? ""),
    }))
    .filter((e) => e.fact && e.source_url);
};

type TraitLike = {
  label?: string;
  name?: string;
  trait?: string;
  key?: string;
  value?: unknown;
  values?: unknown;
  description?: string;
  summary?: string;
  evidence?: ApiJson<unknown>;
};

const traitFrom = (fallbackLabel: string, item: unknown): IcpTrait => {
  if (item && typeof item === "object" && !Array.isArray(item)) {
    const t = item as TraitLike;
    return {
      label: t.label ?? t.name ?? t.trait ?? (t.key ? humanize(t.key) : fallbackLabel),
      value: asText(t.value ?? t.values ?? t.description ?? t.summary ?? ""),
      evidence: parseEvidence(t.evidence),
    };
  }
  return { label: fallbackLabel, value: asText(item), evidence: [] };
};

/** A list of trait objects, or a map of trait name → value or trait object. */
export const parseTraits = (raw: ApiJson<unknown>): IcpTrait[] => {
  const traits = fromJson(raw);
  if (Array.isArray(traits)) {
    return traits.map((t, i) => traitFrom(`Trait ${i + 1}`, t));
  }
  if (traits && typeof traits === "object") {
    return Object.entries(traits as Record<string, unknown>).map(([k, v]) =>
      traitFrom(humanize(k), v),
    );
  }
  return [];
};

/** A map of stat name → number/value, or a list of {label, value}. */
export const parseStats = (raw: ApiJson<unknown>): IcpStat[] => {
  const stats = fromJson(raw);
  if (Array.isArray(stats)) {
    return stats.map((s, i) => ({
      label: String(s?.label ?? s?.name ?? `Stat ${i + 1}`),
      value: asText(s?.value),
    }));
  }
  if (stats && typeof stats === "object") {
    return Object.entries(stats as Record<string, unknown>).map(([k, v]) => ({
      label: humanize(k),
      value: asText(v),
    }));
  }
  return [];
};

export const parseIcp = (raw: ApiIcpProfile): IcpProfile => ({
  id: raw.id,
  created_at: raw.created_at,
  traits: parseTraits(raw.traits),
  stats: parseStats(raw.stats),
  evidence: parseEvidence(raw.evidence),
});

const PROSPECT_STATUSES: ProspectStatus[] = ["new", "drafted", "dismissed"];

export const parseProspect = (raw: ApiProspect): ProspectSummary => {
  const matched = fromJson(raw.matched_traits);
  return {
    id: raw.id,
    name: raw.name,
    org_type: raw.org_type,
    city: raw.city,
    fit_score: raw.fit_score ?? 0,
    matched_traits: Array.isArray(matched) ? matched.map(asText) : [],
    priority: raw.priority,
    status: PROSPECT_STATUSES.includes(raw.status as ProspectStatus)
      ? (raw.status as ProspectStatus)
      : "new",
    facts: parseFactsUsed(raw.facts),
  };
};

export const parseProspectDetail = (raw: ApiProspect): ProspectDetail => ({
  ...parseProspect(raw),
  created_at: raw.created_at,
  draft: raw.outreach_drafts?.length ? parseDraft(raw.outreach_drafts[0]) : null,
});
