import {
  ArrowRight,
  Bot,
  ExternalLink,
  Inbox,
  ListFilter,
  RotateCcw,
  Send,
  Sparkles,
  X,
} from "lucide-react";
import { Link } from "react-router";

import { cn } from "@/lib/utils";
import {
  formatMonthYear,
  formatUsd,
  scoreClass,
  statusClass,
  statusLabel,
  tierLabel,
} from "../contacts/donorFormat";
import type {
  AskAnswer,
  AskDonor,
  AskFilter,
  AskIntent,
} from "../providers/local/ask";
import {
  INTENTS,
  SERVED,
  campaignHref,
  filterChips,
  sortLabel,
  withoutChip,
} from "./askChips";

const traceUrl = (traceId: string) =>
  `https://platform.openai.com/traces/trace?trace_id=${encodeURIComponent(traceId)}`;

export const AskResults = ({
  answer,
  original,
  intent,
  pending,
  selectedId,
  onIntent,
  onFilter,
  onReset,
  onOpenDonor,
}: {
  answer: AskAnswer;
  original: AskAnswer | null;
  intent: AskIntent | null;
  pending: boolean;
  selectedId: number | null;
  onIntent: (intent: AskIntent) => void;
  onFilter: (filter: AskFilter) => void;
  onReset: () => void;
  onOpenDonor: (id: number) => void;
}) => {
  const chips = filterChips(answer.filter);
  const count = answer.donors.length;
  const interpretation =
    answer.served_from === "edited" && original
      ? original.interpretation
      : answer.interpretation;

  return (
    <section
      aria-label="Answer"
      aria-busy={pending}
      className={cn(
        "inbox-main-panel mx-auto max-w-4xl transition-opacity",
        pending && "opacity-60",
      )}
    >
      <header className="flex flex-col gap-3 border-b border-border pb-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="inbox-eyebrow">HOW I READ YOUR QUESTION</h3>
          <div className="flex flex-wrap items-center gap-1">
            <span
              className="inline-flex items-center gap-1.5 rounded-full bg-olive px-3 py-1 text-xs text-foreground"
              title={answer.detail ?? undefined}
            >
              <Bot className="size-3.5" aria-hidden />
              {SERVED[answer.served_from]}
            </span>
            {answer.trace_id && (
              <a
                href={traceUrl(answer.trace_id)}
                target="_blank"
                rel="noreferrer"
                className="inline-flex min-h-11 items-center gap-1 rounded-full px-3 text-xs text-foreground underline underline-offset-2 hover:bg-accent"
              >
                View trace
                <ExternalLink className="size-3" aria-hidden />
                <span className="sr-only">(opens in a new tab)</span>
              </a>
            )}
          </div>
        </div>
        <p className="text-[17px] leading-snug text-foreground">
          {interpretation}
        </p>
        {answer.detail && answer.served_from === "rules" && (
          <p className="text-xs text-muted-foreground">{answer.detail}</p>
        )}

        {answer.understood && (
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
                <ListFilter className="size-3.5" aria-hidden />
                Filters
              </span>
              {chips.length === 0 && (
                <span className="text-sm text-muted-foreground">
                  None: every donor
                </span>
              )}
              <ul
                className="flex flex-wrap gap-2"
                aria-label="Interpreted filters"
              >
                {chips.map((chip) => (
                  <li key={chip.key}>
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() =>
                        onFilter(withoutChip(answer.filter, chip.key))
                      }
                      aria-label={`Remove filter: ${chip.label}`}
                      className="inline-flex min-h-11 items-center gap-2 rounded-full bg-brand-soft px-4 text-sm text-brand-soft-foreground transition-colors hover:bg-olive disabled:opacity-60"
                    >
                      {chip.label}
                      <X className="size-4" aria-hidden />
                    </button>
                  </li>
                ))}
              </ul>
              {answer.served_from === "edited" && original && (
                <button
                  type="button"
                  onClick={onReset}
                  disabled={pending}
                  className="inline-flex min-h-11 items-center gap-1.5 rounded-full px-3 text-sm text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                >
                  <RotateCcw className="size-4" aria-hidden />
                  Reset filters
                </button>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              Order: {sortLabel(answer.filter.sort)}. Remove a filter to widen
              the search.
            </p>
          </div>
        )}
      </header>

      {!answer.understood ? (
        <div className="inbox-empty">
          <Sparkles size={30} aria-hidden="true" />
          <h4>Try one of the example questions</h4>
          <p>{answer.interpretation}</p>
        </div>
      ) : (
        <>
          <NextAction
            count={count}
            donorIds={answer.donors.map((d) => d.id)}
            intent={intent}
            onIntent={onIntent}
          />
          <div className="inbox-list-heading">
            <strong>Matching donors</strong>
            <p>
              {count} {count === 1 ? "person" : "people"}
            </p>
          </div>
          {count === 0 ? (
            <div className="inbox-empty">
              <Inbox size={30} aria-hidden="true" />
              <h4>No donors match all of these filters</h4>
              <p>Remove a filter above to widen the search.</p>
            </div>
          ) : (
            <ul className="inbox-donor-list" aria-label="Matching donors">
              {answer.donors.map((donor) => (
                <AskRow
                  key={donor.id}
                  donor={donor}
                  showPeriod={!!answer.filter.gave_between}
                  selected={selectedId === donor.id}
                  onOpen={() => onOpenDonor(donor.id)}
                />
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
};

export const NextAction = ({
  count,
  donorIds,
  intent,
  onIntent,
  stacked = false,
}: {
  count: number;
  donorIds: number[];
  intent: AskIntent | null;
  onIntent: (intent: AskIntent) => void;
  /** Always one column (the narrow Ask sidebar). */
  stacked?: boolean;
}) => {
  const current = intent ?? { kind: "check_in" as const, channel_hint: null };
  const noun = INTENTS.find((i) => i.kind === current.kind)?.noun;
  return (
    <div
      className={cn(
        "flex flex-col gap-3 rounded-[22px] bg-surface p-3",
        !stacked && "my-4 sm:flex-row sm:items-center sm:justify-between",
      )}
    >
      <fieldset className="flex flex-wrap items-center gap-1.5">
        <legend className="sr-only">Kind of message</legend>
        <span
          className="mr-1 text-xs font-semibold text-muted-foreground"
          aria-hidden
        >
          Next step
        </span>
        {INTENTS.map(({ kind, label }) => (
          <button
            key={kind}
            type="button"
            aria-pressed={current.kind === kind}
            onClick={() => onIntent({ ...current, kind })}
            className={cn(
              "min-h-11 rounded-full px-3.5 text-sm transition-colors",
              current.kind === kind
                ? "bg-primary text-primary-foreground"
                : "bg-card text-foreground hover:bg-accent",
            )}
          >
            {label}
          </button>
        ))}
      </fieldset>
      {count > 0 ? (
        <Link
          to={campaignHref(donorIds, current)}
          className="inline-flex min-h-11 items-center justify-center gap-2 rounded-full bg-brand px-5 text-sm font-semibold text-brand-foreground transition-opacity hover:opacity-90"
        >
          <Send className="size-4" aria-hidden />
          Draft messages for these {count}
          <span className="sr-only"> donors: {noun}</span>
          <ArrowRight className="size-4" aria-hidden />
        </Link>
      ) : (
        <span className="text-sm text-muted-foreground">
          No one to draft for yet
        </span>
      )}
    </div>
  );
};

const AskRow = ({
  donor,
  showPeriod,
  selected,
  onOpen,
}: {
  donor: AskDonor;
  showPeriod: boolean;
  selected: boolean;
  onOpen: () => void;
}) => (
  <li>
    <button
      type="button"
      className={cn("inbox-donor-row", selected && "is-selected")}
      data-donor-id={donor.id}
      aria-label={`Open ${donor.full_name}`}
      aria-describedby={`ask-reason-${donor.id}`}
      onClick={onOpen}
    >
      <span
        className={cn(
          "inbox-donor-avatar",
          donor.donor_type === "organization" && "is-organization",
        )}
        aria-hidden="true"
      >
        {donor.full_name
          .trim()
          .split(/\s+/)
          .slice(0, 2)
          .map((name) => name[0])
          .join("")}
      </span>
      <span className="inbox-donor-copy">
        <span className="inbox-donor-name">
          {donor.full_name}
          {donor.is_star && (
            <Sparkles
              size={14}
              className="inbox-star"
              aria-label="Star donor"
            />
          )}
        </span>
        <span id={`ask-reason-${donor.id}`} className="inbox-donor-reason">
          {showPeriod && donor.ask?.period_gifts
            ? `Gave ${formatUsd(donor.ask.period_total)} in this period (${donor.ask.period_gifts} ${donor.ask.period_gifts === 1 ? "gift" : "gifts"}) · `
            : ""}
          {donor.why_short}
        </span>
        <span className="inbox-donor-meta">
          <span className={cn("inbox-status", statusClass[donor.status])}>
            {statusLabel[donor.status]}
          </span>
          <span>{tierLabel[donor.tier]} donor</span>
          <span className="inbox-gift-summary">
            Last gift {formatMonthYear(donor.last_gift_date)} ·{" "}
            {formatUsd(donor.last_gift_amount)}
          </span>
          {donor.is_sample && (
            <span className="inbox-sample-history">Sample history</span>
          )}
        </span>
      </span>
      <span
        className="inbox-row-score"
        aria-label={`Priority score ${donor.score} out of 100`}
      >
        <strong className={scoreClass(donor.score)}>{donor.score}</strong>
        <small>priority</small>
      </span>
      <ArrowRight size={17} className="inbox-row-arrow" aria-hidden="true" />
    </button>
  </li>
);
