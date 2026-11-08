import type {
  AskFilter,
  AskIntent,
  AskIntentKind,
  AskServedFrom,
  AskSort,
} from "../providers/local/ask";

/** A removable piece of the interpreted filter. */
export interface FilterChip {
  key: keyof AskFilter;
  label: string;
}

const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

/** "2026-10-01" → "Oct 1, 2026", read as UTC so no timezone shifts the day. */
export const formatAskDate = (iso: string) =>
  new Date(`${iso.slice(0, 10)}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });

const list = (values: string[]) => values.join(", ").replace(/_/g, " ");

const CADENCE: Record<string, string> = {
  monthly: "Monthly donors",
  quarterly: "Quarterly donors",
  yearly: "Yearly donors",
  one_time: "One-time donors",
};

const TIER: Record<string, string> = { big: "Big", mid: "Mid", small: "Small" };

const SORT: Record<AskSort, string> = {
  score: "highest priority first",
  period_total: "biggest total in the period first",
  last_gift_recent: "most recent gift first",
  last_gift_oldest: "longest since their last gift first",
  lifetime: "biggest lifetime giving first",
  name: "by name",
};

export const sortLabel = (sort: AskSort | null) => SORT[sort ?? "score"];

/** One chip per active constraint, in a stable reading order. */
export const filterChips = (filter: AskFilter): FilterChip[] => {
  const chips: FilterChip[] = [];
  const add = (key: keyof AskFilter, label: string) =>
    chips.push({ key, label });

  if (filter.tier?.length)
    add(
      "tier",
      filter.tier.length === 1
        ? `${TIER[filter.tier[0]] ?? filter.tier[0]} donors`
        : `Tier: ${filter.tier.map((t) => TIER[t] ?? t).join(", ")}`,
    );
  if (filter.star != null)
    add("star", filter.star ? "Star donors only" : "No star donors");
  if (filter.donor_type)
    add(
      "donor_type",
      filter.donor_type === "organization" ? "Organizations" : "Individuals",
    );
  if (filter.cadence) add("cadence", CADENCE[filter.cadence] ?? filter.cadence);
  if (filter.status?.length) add("status", `Status: ${list(filter.status)}`);
  if (filter.overdue != null)
    add(
      "overdue",
      filter.overdue ? "Past their usual rhythm" : "On their usual rhythm",
    );
  const range = filter.gave_between;
  if (range && (range.start || range.end))
    add(
      "gave_between",
      range.start && range.end
        ? `Gave ${formatAskDate(range.start)} – ${formatAskDate(range.end)}`
        : range.start
          ? `Gave since ${formatAskDate(range.start)}`
          : `Gave by ${formatAskDate(range.end!)}`,
    );
  if (filter.last_gift_before)
    add(
      "last_gift_before",
      `Last gift on or before ${formatAskDate(filter.last_gift_before)}`,
    );
  if (filter.last_gift_after)
    add(
      "last_gift_after",
      `Last gift on or after ${formatAskDate(filter.last_gift_after)}`,
    );
  if (filter.min_gift != null)
    add("min_gift", `A gift of ${usd.format(filter.min_gift)}+`);
  if (filter.max_gift != null)
    add("max_gift", `No gift over ${usd.format(filter.max_gift)}`);
  if (filter.min_total != null)
    add("min_total", `Gave ${usd.format(filter.min_total)}+ in total`);
  if (filter.max_total != null)
    add("max_total", `Gave at most ${usd.format(filter.max_total)}`);
  if (filter.channel?.length)
    add("channel", `Via ${filter.channel.join(", ")}`);
  if (filter.has_draft != null)
    add("has_draft", filter.has_draft ? "Has a draft" : "No draft yet");
  if (filter.not_contacted_since)
    add(
      "not_contacted_since",
      `No approved outreach since ${formatAskDate(filter.not_contacted_since)}`,
    );
  if (filter.limit != null) add("limit", `Top ${filter.limit}`);
  return chips;
};

export const withoutChip = (
  filter: AskFilter,
  key: keyof AskFilter,
): AskFilter => ({ ...filter, [key]: null });

export const INTENTS: { kind: AskIntentKind; label: string; noun: string }[] = [
  { kind: "thank_you", label: "Thank-you", noun: "thank-you notes" },
  { kind: "re_engage", label: "Re-engage", noun: "re-engagement notes" },
  { kind: "check_in", label: "Check in", noun: "check-in messages" },
];

/**
 * The hand-off to the campaign flow (issue #38, /campaigns/new owns the rest):
 * the donor ids and the suggested intent, never message text.
 */
export const campaignHref = (donorIds: number[], intent: AskIntent) => {
  const params = new URLSearchParams({
    donors: donorIds.join(","),
    intent: intent.kind,
  });
  if (intent.channel_hint) params.set("channel", intent.channel_hint);
  // URLSearchParams encodes the commas; keep the ids readable.
  return `/campaigns/new?${params.toString().replace(/%2C/g, ",")}`;
};

/** Who answered: the pill on an answer. */
export const SERVED: Record<AskServedFrom, string> = {
  model: "Read by the AI model (OpenAI Agents SDK)",
  cache: "Cached answer",
  rules: "Read by keyword rules (no AI model)",
  edited: "Your edited filters",
};
