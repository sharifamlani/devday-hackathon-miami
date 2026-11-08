import type {
  CallNote,
  NoteDestination,
  TranscriptLine,
} from "../../voice/callNotes";
import type {
  ApiDonorDetail,
  ApiDonorRow,
  ApiDuplicate,
  ApiEvidence,
  ApiIcpProfile,
  ApiJson,
  ApiMergeLogEntry,
  ApiMergeResult,
  ApiUndoMergeResult,
  ApiContext,
  ApiContextFact,
  ApiContextFactLite,
  ApiContextRun,
  ApiOrgProfile,
  ApiOutreachDraft,
  ApiProspect,
  ApiTarget,
  ApiTargets,
  ApiWhy,
} from "./apiTypes";
import type {
  DonorDetail,
  DonorStatus,
  DonorSummary,
  DuplicatePair,
  ContextFact,
  ContextRun,
  ContextRunSource,
  DatedFact,
  FactUsed,
  FitComponent,
  IcpEvidence,
  IngestResult,
  MergeLogEntry,
  MergeResult,
  UndoMergeResult,
  OrgContext,
  OrgProfile,
  SocialLink,
  SocialPlatform,
  SourceState,
  IcpProfile,
  IcpStat,
  IcpTrait,
  OutreachDraft,
  ProspectDetail,
  ProspectStatus,
  ProspectSummary,
  ScoreFactor,
  DonationTarget,
  TargetsByPeriod,
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

/** Marker reason on imported donors (snapshot mode), which have no real score. */
export const IMPORTED_UNSCORED = "imported_unscored";
export const IMPORTED_WHY_SHORT =
  "Imported · not scored yet (scoring runs on the live service)";

export const whyShort = (why: ApiWhy | null): string => {
  if (!why) return "not scored yet";
  if (why.reasons?.includes(IMPORTED_UNSCORED)) return IMPORTED_WHY_SHORT;
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
  if (why.reasons.includes(IMPORTED_UNSCORED)) {
    return "Imported from an uploaded list. Scoring runs on the live service.";
  }
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

/* ---------- Call notes from GET /donors/{id} ---------- */

const asList = <T>(raw: unknown): T[] => {
  const value = typeof raw === "string" ? fromJson<T[]>(raw) : raw;
  return Array.isArray(value) ? (value as T[]) : [];
};

/**
 * The optional call_notes on GET /donors/{id} (snake_case from the service,
 * camelCase accepted) as the browser's CallNote shape. Malformed items are
 * dropped rather than shown half-empty.
 */
export const parseApiCallNotes = (raw: unknown): CallNote[] =>
  asList<Record<string, unknown>>(raw)
    .filter((n) => n && typeof n === "object" && n.id != null)
    .map((n) => ({
      id: String(n.id),
      title: String(n.title ?? "Call"),
      createdAt: String(n.created_at ?? n.createdAt ?? n.saved_at ?? ""),
      durationSec: Number(n.duration_sec ?? n.durationSec ?? 0) || 0,
      destinations: asList<NoteDestination>(n.destinations),
      transcript: asList<TranscriptLine>(n.transcript),
      notes: String(n.notes ?? ""),
      summary: asList<string>(n.summary).map(String),
      nextSteps: asList<string>(n.next_steps ?? n.nextSteps).map(String),
    }));

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

const toNumber = (value: unknown, fallback = 0) => {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
};

const toText = (value: unknown): string | null =>
  typeof value === "string" && value ? value : null;

/** One merges[] item. Defensive: older or partial servers may omit fields. */
export const parseMergeLogEntry = (raw: ApiMergeLogEntry): MergeLogEntry => {
  const email = toText(raw.merged_email);
  const emails = Array.isArray(raw.merged_emails)
    ? raw.merged_emails.filter((e): e is string => typeof e === "string" && !!e)
    : [];
  return {
    id: toNumber(raw.id),
    kept_id: toNumber(raw.kept_id),
    merged_id: toNumber(raw.merged_id),
    merged_name: toText(raw.merged_name) ?? `Donor ${toNumber(raw.merged_id)}`,
    merged_email: email,
    merged_emails: emails.length ? emails : email ? [email] : [],
    gifts_moved: toNumber(raw.gifts_moved),
    merged_at: toText(raw.merged_at) ?? "",
    approved_by: toText(raw.approved_by),
    undone_at: toText(raw.undone_at),
    can_undo: raw.can_undo === true && !raw.undone_at,
  };
};

export const parseMerges = (raw: unknown): MergeLogEntry[] =>
  Array.isArray(raw)
    ? raw
        .filter((m): m is ApiMergeLogEntry => !!m && typeof m === "object")
        .map(parseMergeLogEntry)
        .sort((a, b) => b.id - a.id) // newest first
    : [];

export const parseMergeResult = (raw: ApiMergeResult): MergeResult => ({
  kept_id: raw.kept_donor_id,
  merged_id: raw.removed_donor_id,
  merge_id:
    typeof raw.merge_id === "number" && Number.isFinite(raw.merge_id)
      ? raw.merge_id
      : null,
});

export const parseUndoMergeResult = (raw: ApiUndoMergeResult): UndoMergeResult => ({
  kept_id: raw.kept_id,
  restored_id: raw.restored_id,
});

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
  merges: parseMerges(raw.merges),
  // outreach_drafts comes newest first.
  draft: raw.outreach_drafts?.length ? parseDraft(raw.outreach_drafts[0]) : null,
  // Absent on older servers; always [] in the snapshot (export_snapshot.py).
  call_notes: parseApiCallNotes(raw.call_notes),
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
      label:
        t.label ??
        t.name ??
        (t.trait ? humanize(t.trait) : t.key ? humanize(t.key) : fallbackLabel),
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

const parseDatedFacts = (raw: ApiJson<ApiContextFactLite[]>): DatedFact[] => {
  const list = fromJson(raw);
  if (!Array.isArray(list)) return [];
  return list
    .map((f) => ({
      source: f?.source ?? null,
      fact: String(f?.fact ?? ""),
      source_url: String(f?.source_url ?? f?.url ?? ""),
      posted_at: f?.posted_at ?? null,
    }))
    .filter((f) => f.fact && f.source_url)
    .sort((a, b) => (b.posted_at ?? "").localeCompare(a.posted_at ?? ""));
};

const parseFitBreakdown = (raw: ApiJson<Record<string, number>>): FitComponent[] => {
  const map = fromJson(raw);
  if (!map || typeof map !== "object" || Array.isArray(map)) return [];
  return Object.entries(map)
    .map(([key, points]) => ({ label: humanize(key), points: Number(points) || 0 }))
    .sort((a, b) => b.points - a.points);
};

export const parseIcp = (raw: ApiIcpProfile): IcpProfile => ({
  id: raw.id,
  created_at: raw.created_at,
  traits: parseTraits(raw.traits),
  stats: parseStats(raw.stats),
  evidence: parseEvidence(raw.evidence),
  recent_context: parseDatedFacts(raw.recent_context),
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
    matched_traits: Array.isArray(matched)
      ? matched.map((t) => humanize(asText(t)))
      : [],
    priority: raw.priority,
    status: PROSPECT_STATUSES.includes(raw.status as ProspectStatus)
      ? (raw.status as ProspectStatus)
      : "new",
    facts: parseFactsUsed(raw.facts),
    fit_breakdown: parseFitBreakdown(raw.fit_breakdown),
    matched_context: parseDatedFacts(raw.matched_context),
  };
};

export const parseProspectDetail = (raw: ApiProspect): ProspectDetail => ({
  ...parseProspect(raw),
  created_at: raw.created_at,
  draft: raw.outreach_drafts?.length ? parseDraft(raw.outreach_drafts[0]) : null,
});

/* ---------- Onboarding (plan.md §15) ---------- */

const SOCIALS: { platform: SocialPlatform; label: string; key: keyof ApiOrgProfile }[] = [
  { platform: "x", label: "X", key: "x_url" },
  { platform: "linkedin", label: "LinkedIn", key: "linkedin_url" },
  { platform: "instagram", label: "Instagram", key: "instagram_url" },
];

const asStringList = (raw: ApiJson<unknown>): string[] => {
  const value = fromJson(raw);
  if (Array.isArray(value)) return value.map(asText).filter(Boolean);
  if (value && typeof value === "object") {
    return Object.entries(value as Record<string, unknown>).map(
      ([k, v]) => `${humanize(k)}: ${asText(v)}`,
    );
  }
  return value ? [asText(value)] : [];
};

/** build_context writes voice as {phrases: [...], urls: [...]}; only the
 *  phrases are tone notes (the urls are their sources). */
const parseVoice = (raw: ApiJson<unknown>): string[] => {
  const value = fromJson(raw);
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const phrases = (value as { phrases?: unknown }).phrases;
    if (Array.isArray(phrases)) return phrases.map(asText).filter(Boolean);
  }
  return asStringList(value as ApiJson<unknown>);
};

export const parseOrgProfile = (raw: ApiOrgProfile): OrgProfile => ({
  name: raw.name ?? null,
  website: raw.website ?? null,
  socials: SOCIALS.flatMap(({ platform, label, key }): SocialLink[] => {
    const url = raw[key];
    if (typeof url !== "string" || !url.trim()) return [];
    // Scope (Sat Nov 7): social URLs are saved, only the website is researched.
    const connected =
      (raw as unknown as Record<string, unknown>)[`${platform}_connected`] === true;
    return [
      {
        platform,
        label,
        url,
        connected,
        status: connected ? "connected" : "saved, not connected",
      },
    ];
  }),
  priorities: asStringList(raw.priorities),
  voice: parseVoice(raw.voice),
  updated_at: raw.updated_at ?? null,
});

const parseContextFact = (raw: ApiContextFact): ContextFact => ({
  id: raw.id,
  source: raw.source,
  source_url: raw.url,
  posted_at: raw.posted_at,
  fact: raw.fact,
  quote: raw.quote ?? null,
  priority: raw.priority ?? null,
});

/** A list of facts, or {profile|org_profile, facts|org_context|items}. */
export const parseContext = (
  raw: ApiContext | null | undefined,
  { cached = false, profile = null as ApiOrgProfile | null } = {},
): OrgContext => {
  const facts = Array.isArray(raw)
    ? raw
    : (raw?.facts ?? raw?.org_context ?? raw?.items ?? []);
  const rawProfile = Array.isArray(raw)
    ? profile
    : (raw?.profile ?? raw?.org_profile ?? profile);
  return {
    profile: rawProfile ? parseOrgProfile(rawProfile) : null,
    facts: facts
      .filter((f) => f?.fact && f?.url) // every fact carries its URL
      .map(parseContextFact)
      .sort((a, b) => (b.posted_at ?? "").localeCompare(a.posted_at ?? "")),
    cached: cached || (!Array.isArray(raw) && !!raw?.cached),
  };
};

const SOURCE_ORDER = ["website", "news", "x", "linkedin", "instagram"];
const SOURCE_LABELS: Record<string, string> = {
  website: "Website",
  news: "News",
  x: "X",
  linkedin: "LinkedIn",
  instagram: "Instagram",
};

const sourceState = (status: string): SourceState => {
  const s = status.trim().toLowerCase();
  if (s.startsWith("saved")) return "saved_not_connected";
  if (s.startsWith("not provided")) return "not_provided";
  if (s.startsWith("blocked")) return "blocked";
  if (s.startsWith("done")) return "done";
  return "failed";
};

export const parseContextRun = (raw: ApiContextRun): ContextRun => {
  const sources: ContextRunSource[] = Object.entries(raw.sources ?? {})
    .map(([source, s]) => ({
      source,
      label: SOURCE_LABELS[source] ?? humanize(source),
      state: sourceState(s?.status ?? ""),
      status_text: s?.status ?? "",
      fact_count: s?.facts ?? 0,
      detail: s?.detail ?? null,
    }))
    .sort(
      (a, b) =>
        (SOURCE_ORDER.indexOf(a.source) + 1 || 99) -
        (SOURCE_ORDER.indexOf(b.source) + 1 || 99),
    );
  const context = parseContext(
    { profile: raw.profile ?? null, facts: raw.facts ?? [] },
    { cached: raw.cached },
  );
  // Older builds lack served_from: cached:true meant the fallback.
  const servedFrom = raw.served_from ?? (raw.cached ? "fallback" : "live");
  return {
    status: raw.state === "done" ? "done" : "failed",
    served_from: servedFrom,
    cached: servedFrom === "fallback",
    detail: raw.detail ?? null,
    sources,
    profile: context.profile,
    facts: context.facts,
    finished_at: raw.finished_at ?? null,
  };
};

const pickCount = (raw: Record<string, unknown>, keys: string[]) => {
  for (const key of keys) {
    const value = raw[key];
    if (typeof value === "number") return value;
    if (Array.isArray(value)) return value.length;
  }
  return null;
};

export const parseIngestResult = (raw: unknown): IngestResult => {
  const obj = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return {
    donors: pickCount(obj, ["donors", "donors_added", "donor_count", "inserted_donors"]),
    gifts: pickCount(obj, ["gifts", "gifts_added", "gift_count", "inserted_gifts"]),
    duplicates: pickCount(obj, ["duplicates", "pending_duplicates", "duplicate_suggestions"]),
    message: typeof obj.message === "string" ? obj.message : null,
    raw,
  };
};

/* ---------- Donation targets (issue #37) ---------- */

export const parseTarget = (raw: ApiTarget): DonationTarget => ({
  period: raw.period,
  label: raw.label,
  start: raw.start,
  end: raw.end,
  as_of: raw.as_of,
  goal: raw.goal ?? null,
  goal_is_sample: raw.goal_is_sample ?? true,
  raised: raw.raised ?? 0,
  percent: raw.percent ?? null,
  days_left: raw.days_left,
  donors_count: raw.donors_count ?? 0,
  gifts_count: raw.gifts_count ?? 0,
  by_channel: raw.by_channel ?? [],
  new_donors: raw.new_vs_returning?.new ?? 0,
  returning_donors: raw.new_vs_returning?.returning ?? 0,
  new_amount: raw.new_vs_returning?.new_amount ?? null,
  returning_amount: raw.new_vs_returning?.returning_amount ?? null,
  give_miami_day: raw.give_miami_day
    ? {
        date: raw.give_miami_day.date,
        days_until: raw.give_miami_day.days_until,
        in_period: raw.give_miami_day.in_period ?? true,
      }
    : null,
  top_donor_ids: raw.top_donor_ids ?? [],
  donor_ids: raw.donor_ids ?? raw.top_donor_ids ?? [],
});

/** GET /targets (both periods), GET /targets?period= (one), or the snapshot key. */
export const parseTargets = (
  raw: ApiTargets | ApiTarget | null | undefined,
): TargetsByPeriod => {
  if (!raw) return {};
  if ("period" in raw && typeof raw.period === "string") {
    const one = raw as ApiTarget;
    return { [one.period]: parseTarget(one) };
  }
  const both = raw as ApiTargets;
  const out: TargetsByPeriod = {};
  if (both.month) out.month = parseTarget(both.month);
  if (both.quarter) out.quarter = parseTarget(both.quarter);
  return out;
};
