/**
 * Ask Donor Desk (issue #36): types, the parser for POST /ask, and the
 * snapshot-mode answer.
 *
 * The model only turns a question into an AskFilter; plain code runs it
 * (service/ask_agent.py apply_filter). In snapshot mode the example questions
 * come precomputed from snapshot.json `ask_examples`, and an edited filter is
 * re-run here by `applyAskFilter`, a line-for-line port of apply_filter.
 */
import type { ApiDonorRow, ApiSnapshot } from "./apiTypes";
import { parseDonorRow } from "./parse";
import type { DonorStatus, DonorSummary, Tier } from "./types";

// Keep in step with EXAMPLE_QUESTIONS in service/ask_agent.py
export const EXAMPLE_QUESTIONS = [
  "Who helped us reach our Q4 goal? Draft a thank-you now that the November push is over.",
  "Who needs outreach because they've gone quiet?",
  "Monthly donors whose last gift is late",
  "Big donors we haven't called this quarter",
] as const;

export type AskCadence = "monthly" | "quarterly" | "yearly" | "one_time";
export type AskSort =
  | "score"
  | "period_total"
  | "last_gift_recent"
  | "last_gift_oldest"
  | "lifetime"
  | "name";

export interface AskDateRange {
  start: string | null;
  end: string | null;
}

/** service/ask_agent.py AskFilter. null (or an empty list) = no constraint. */
export interface AskFilter {
  status: DonorStatus[] | null;
  tier: Tier[] | null;
  star: boolean | null;
  donor_type: "individual" | "organization" | null;
  gave_between: AskDateRange | null;
  last_gift_before: string | null;
  last_gift_after: string | null;
  min_gift: number | null;
  max_gift: number | null;
  min_total: number | null;
  max_total: number | null;
  channel: string[] | null;
  cadence: AskCadence | null;
  overdue: boolean | null;
  has_draft: boolean | null;
  not_contacted_since: string | null;
  sort: AskSort | null;
  limit: number | null;
}

export type AskIntentKind = "thank_you" | "re_engage" | "check_in";

/** What the campaign flow (issue #38) receives with the donor ids. */
export interface AskIntent {
  kind: AskIntentKind;
  channel_hint: "email" | "text" | null;
}

export type AskServedFrom = "model" | "cache" | "rules" | "edited";

/** Why a row matched: computed in code, never by the model. */
export interface AskMatch {
  period_total: number;
  period_gifts: number;
  last_gift_date: string | null;
}

export interface AskDonor extends DonorSummary {
  ask: AskMatch | null;
}

export interface AskAnswer {
  question: string;
  interpretation: string;
  /** false: nothing could read the question (free text without the model). */
  understood: boolean;
  filter: AskFilter;
  intent: AskIntent | null;
  donor_ids: number[];
  donors: AskDonor[];
  served_from: AskServedFrom;
  /** Agents SDK trace id when the model answered (live only). */
  trace_id: string | null;
  /** Why the rules answered instead of the model, for a tooltip. */
  detail: string | null;
  as_of: string | null;
}

export const EMPTY_FILTER: AskFilter = {
  status: null,
  tier: null,
  star: null,
  donor_type: null,
  gave_between: null,
  last_gift_before: null,
  last_gift_after: null,
  min_gift: null,
  max_gift: null,
  min_total: null,
  max_total: null,
  channel: null,
  cadence: null,
  overdue: null,
  has_draft: null,
  not_contacted_since: null,
  sort: null,
  limit: null,
};

/* ---------- API shapes ---------- */

export interface ApiAskResponse {
  question: string;
  interpretation: string;
  understood: boolean;
  filter: Partial<AskFilter> | null;
  intent: AskIntent | null;
  donor_ids: number[];
  donors: (ApiDonorRow & { ask?: AskMatch })[];
  served_from: AskServedFrom;
  trace_id: string | null;
  detail: string | null;
  as_of: string | null;
}

/** One entry of snapshot.json `ask_examples` (service/export_snapshot.py). */
export interface ApiAskExample {
  question: string;
  interpretation: string;
  filter: Partial<AskFilter>;
  intent: AskIntent;
  donor_ids: number[];
  served_from: "rules";
}

export type ApiSnapshotWithAsk = ApiSnapshot & {
  ask_examples?: ApiAskExample[];
};

export const parseAskResponse = (raw: ApiAskResponse): AskAnswer => ({
  question: raw.question,
  interpretation: raw.interpretation,
  understood: raw.understood,
  filter: { ...EMPTY_FILTER, ...(raw.filter ?? {}) },
  intent: raw.intent,
  donor_ids: raw.donor_ids,
  donors: raw.donors.map((row) => ({
    ...parseDonorRow(row),
    ask: row.ask ?? null,
  })),
  served_from: raw.served_from,
  trace_id: raw.trace_id ?? null,
  detail: raw.detail ?? null,
  as_of: raw.as_of ?? null,
});

export const normalizeQuestion = (question: string) =>
  question.trim().toLowerCase().replace(/’/g, "'").replace(/\s+/g, " ");

/* ---------- apply_filter, ported (keep in step with service/ask_agent.py) ---------- */

const MONTHLY_MAX_DAYS = 45;
const QUARTERLY_MAX_DAYS = 135;
const OVERDUE_REASONS = new Set([
  "overdue_vs_cadence",
  "missed_seasonal_window",
]);
const CONTACT_STATUSES = new Set(["approved", "sent"]);
const MAX_LIMIT = 100;

type Why = ApiDonorRow["why"];

export const cadenceOf = (why: Why): AskCadence | null => {
  if (!why || !why.gift_count) return null;
  if (why.gift_count === 1) return "one_time";
  const days = why.usual_cadence_days ?? 0;
  if (days <= MONTHLY_MAX_DAYS) return "monthly";
  if (days <= QUARTERLY_MAX_DAYS) return "quarterly";
  return "yearly";
};

export const isOverdue = (why: Why) =>
  !!why && (why.reasons ?? []).some((reason) => OVERDUE_REASONS.has(reason));

const inRange = (day: string, range: AskDateRange | null) =>
  !range ||
  ((range.start == null || day >= range.start) &&
    (range.end == null || day <= range.end));

const has = <T>(list: T[] | null | undefined): list is T[] =>
  !!list && list.length > 0;

export interface Matched {
  row: ApiDonorRow;
  ask: AskMatch;
}

/** GET /donors order: score desc (nulls last), then id. */
const donorsInApiOrder = (snapshot: ApiSnapshot) =>
  [...snapshot.donors].sort(
    (a, b) =>
      Number(a.score == null) - Number(b.score == null) ||
      (b.score ?? 0) - (a.score ?? 0) ||
      a.id - b.id,
  );

const ordinal = (day: string | null) =>
  day ? Date.parse(`${day}T00:00:00Z`) : 0;

/**
 * The matching snapshot donors, in the requested order. Pure; mirrors
 * apply_filter so an edited chip gives the same rows offline as live.
 */
export const applyAskFilter = (
  snapshot: ApiSnapshot,
  spec: AskFilter,
  asOf: string | null = snapshot.meta.as_of,
): Matched[] => {
  const channels = new Set(
    (spec.channel ?? []).map((c) => c.trim().toLowerCase()).filter(Boolean),
  );
  const out: Matched[] = [];
  for (const row of donorsInApiOrder(snapshot)) {
    const detail = snapshot.donor_details[String(row.id)];
    const why = row.why;
    const gifts = (detail?.gifts ?? [])
      .map((g) => ({
        day: g.gift_date.slice(0, 10),
        amount: Number(g.amount),
        channel: g.channel,
      }))
      .filter((g) => asOf == null || g.day <= asOf);
    const drafts = detail?.outreach_drafts ?? [];
    const contacted = drafts
      .filter((d) => CONTACT_STATUSES.has(d.status))
      .map((d) => (d.approved_at || d.created_at || "").slice(0, 10));
    const window = gifts.filter((g) => inRange(g.day, spec.gave_between));
    const last = gifts.reduce<string | null>(
      (max, g) => (max == null || g.day > max ? g.day : max),
      null,
    );
    const amounts = window.map((g) => g.amount);
    const largest = amounts.length ? Math.max(...amounts) : null;
    const total = amounts.reduce((sum, a) => sum + a, 0);

    const checks = [
      !has(spec.status) || spec.status.includes(row.status as DonorStatus),
      !has(spec.tier) || spec.tier.includes(row.tier as Tier),
      spec.star == null || !!row.is_star === spec.star,
      spec.donor_type == null || row.donor_type === spec.donor_type,
      spec.gave_between == null || window.length > 0,
      spec.last_gift_before == null ||
        (last != null && last <= spec.last_gift_before),
      spec.last_gift_after == null ||
        (last != null && last >= spec.last_gift_after),
      spec.min_gift == null || (largest != null && largest >= spec.min_gift),
      spec.max_gift == null || (largest != null && largest <= spec.max_gift),
      spec.min_total == null || total >= spec.min_total,
      spec.max_total == null || total <= spec.max_total,
      channels.size === 0 ||
        window.some((g) => channels.has((g.channel ?? "").toLowerCase())),
      spec.cadence == null || cadenceOf(why) === spec.cadence,
      spec.overdue == null || isOverdue(why) === spec.overdue,
      spec.has_draft == null || drafts.length > 0 === spec.has_draft,
      spec.not_contacted_since == null ||
        !contacted.some((day) => day >= spec.not_contacted_since!),
    ];
    if (checks.every(Boolean)) {
      out.push({
        row,
        ask: {
          period_total: Math.round(total * 100) / 100,
          period_gifts: window.length,
          last_gift_date: last,
        },
      });
    }
  }

  const score = (m: Matched) => m.row.score ?? 0;
  const byId = (a: Matched, b: Matched) => a.row.id - b.row.id;
  const compare: Record<AskSort, (a: Matched, b: Matched) => number> = {
    score: (a, b) => score(b) - score(a) || byId(a, b),
    period_total: (a, b) =>
      b.ask.period_total - a.ask.period_total ||
      score(b) - score(a) ||
      byId(a, b),
    last_gift_recent: (a, b) =>
      ordinal(b.ask.last_gift_date) - ordinal(a.ask.last_gift_date) ||
      byId(a, b),
    last_gift_oldest: (a, b) =>
      ordinal(a.ask.last_gift_date) - ordinal(b.ask.last_gift_date) ||
      byId(a, b),
    lifetime: (a, b) =>
      (b.row.why?.lifetime_total ?? 0) - (a.row.why?.lifetime_total ?? 0) ||
      byId(a, b),
    // Code-point order, like Python's str comparison, so both modes agree.
    name: (a, b) => {
      const [x, y] = [
        a.row.full_name.toLowerCase(),
        b.row.full_name.toLowerCase(),
      ];
      return (x < y ? -1 : x > y ? 1 : 0) || byId(a, b);
    },
  };
  out.sort(compare[spec.sort ?? "score"]);
  return spec.limit == null
    ? out
    : out.slice(0, Math.max(1, Math.min(spec.limit, MAX_LIMIT)));
};

const LIVE_ONLY =
  "Live AI runs on the demo laptop. In this cached sample, pick one of the example questions, then edit its filters.";

/** An answer whose rows come from this snapshot (precomputed, edited, or a hosted model's filter). */
export const snapshotAnswer = (
  snapshot: ApiSnapshot,
  question: string,
  base: Pick<
    AskAnswer,
    "interpretation" | "filter" | "intent" | "served_from"
  > &
    Partial<Pick<AskAnswer, "trace_id" | "detail">>,
  matched: Matched[],
): AskAnswer => ({
  question,
  understood: true,
  interpretation: base.interpretation,
  filter: base.filter,
  intent: base.intent,
  served_from: base.served_from,
  donor_ids: matched.map((m) => m.row.id),
  donors: matched.map((m) => ({ ...parseDonorRow(m.row), ask: m.ask })),
  trace_id: base.trace_id ?? null,
  detail:
    base.detail ??
    "Cached sample: computed by the rules when the snapshot was exported.",
  as_of: snapshot.meta.as_of,
});

/** Snapshot mode: example → precomputed; edited filter → re-run here; free text → live-only note. */
export const askSnapshot = (
  snapshot: ApiSnapshotWithAsk,
  question: string,
  filter?: AskFilter | null,
  intent?: AskIntent | null,
): AskAnswer => {
  const asOf = snapshot.meta.as_of;
  const rowsById = new Map(snapshot.donors.map((d) => [d.id, d]));
  const answer = (
    base: Pick<
      AskAnswer,
      "interpretation" | "filter" | "intent" | "served_from"
    >,
    matched: Matched[],
  ): AskAnswer => snapshotAnswer(snapshot, question, base, matched);

  if (filter) {
    return answer(
      {
        interpretation: `Your edited filter for “${question.trim()}”.`,
        filter,
        intent: intent ?? { kind: "check_in", channel_hint: null },
        served_from: "edited",
      },
      applyAskFilter(snapshot, filter, asOf),
    );
  }

  const example = (snapshot.ask_examples ?? []).find(
    (e) => normalizeQuestion(e.question) === normalizeQuestion(question),
  );
  if (example) {
    const spec = { ...EMPTY_FILTER, ...example.filter };
    // The ids were computed at export; the match details come from the same rows.
    const details = new Map(
      applyAskFilter(snapshot, spec, asOf).map((m) => [m.row.id, m.ask]),
    );
    const matched = example.donor_ids
      .filter((id) => rowsById.has(id)) // a merge in this tab can remove one
      .map((id) => ({
        row: rowsById.get(id)!,
        ask: details.get(id) ?? {
          period_total: 0,
          period_gifts: 0,
          last_gift_date: null,
        },
      }));
    return answer(
      {
        interpretation: example.interpretation,
        filter: spec,
        intent: example.intent,
        served_from: "cache",
      },
      matched,
    );
  }

  return {
    question,
    interpretation: LIVE_ONLY,
    understood: false,
    filter: EMPTY_FILTER,
    intent: null,
    donor_ids: [],
    donors: [],
    served_from: "cache",
    trace_id: null,
    detail: null,
    as_of: asOf,
  };
};
