import { useEffect, useId, useState } from "react";
import { ArrowRight, ShieldCheck, Sparkles, X } from "lucide-react";
import { useSearchParams } from "react-router";

import { cn } from "@/lib/utils";
import { DonorDrawer } from "../contacts/DonorDrawer";
import { formatUsd, statusClass, statusLabel } from "../contacts/donorFormat";
import { EXAMPLE_QUESTIONS, type AskAnswer } from "../providers/local/ask";
import { DATA_MODE } from "../providers/local/config";
import { SERVED, filterChips, withoutChip } from "./askChips";
import { AskPrompt } from "./AskPrompt";
import { AskResults, NextAction } from "./AskResults";
import { useAskSession } from "./askSessionContext";
import "../dashboard/donor-inbox.css";

export type AskPanelVariant = "page" | "sidebar";

const SAFETY =
  DATA_MODE === "local"
    ? "Read-only: the AI never writes records, sends messages, or sees donor details."
    : "Examples are precomputed. Other questions go to a read-only AI that sees only your question, never donor records.";

/**
 * Ask Donor Desk (issue #36): one prompt, example chips, then the donors that
 * match. The model only reads the question into filters; the rows come from
 * the donor records. `page` is the /ask screen; `sidebar` is the compact
 * layout in the Ask sidebar. Both share one session (AskSession.tsx).
 */
export const AskPanel = ({ variant }: { variant: AskPanelVariant }) => {
  const session = useAskSession();
  const { answer, pending, error } = session;
  const titleId = useId();
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const sidebar = variant === "sidebar";

  // "Open full page" carries the question in ?q= (prefilled, never auto-asked).
  const [params] = useSearchParams();
  const carried = sidebar ? null : params.get("q");
  const { draft, setDraft } = session;
  useEffect(() => {
    if (carried && !draft) setDraft(carried);
    // Only when the carried question changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [carried]);

  const examples = (
    <ul
      aria-label="Example questions"
      className={cn(
        "flex flex-wrap gap-2",
        sidebar ? "mt-3 justify-start" : "mt-5 justify-center",
      )}
    >
      {EXAMPLE_QUESTIONS.map((question) => (
        <li key={question} className="max-w-full">
          <button
            type="button"
            onClick={() => session.submit(question)}
            disabled={pending}
            className={cn(
              "inline-flex min-h-11 max-w-full items-center gap-2 rounded-full border border-border bg-card px-4 py-2 text-left text-sm text-foreground transition-colors hover:bg-accent disabled:opacity-60",
              sidebar && "px-3 text-[13px]",
              answer?.question === question &&
                "border-ring bg-brand-soft text-brand-soft-foreground",
            )}
          >
            <Sparkles
              className="size-4 shrink-0 text-muted-foreground"
              aria-hidden
            />
            <span>{question}</span>
          </button>
        </li>
      ))}
    </ul>
  );

  const status = (
    <>
      <div aria-live="polite" className="sr-only">
        {pending
          ? "Reading your question…"
          : answer
            ? `${answer.donors.length} donors match.`
            : ""}
      </div>
      {error && (
        <p
          role="alert"
          className={cn(
            "rounded-2xl bg-alert px-4 py-3 text-sm text-alert-foreground",
            sidebar ? "mt-3" : "mx-auto mb-6 max-w-3xl",
          )}
        >
          We couldn’t answer that: {error.message}
        </p>
      )}
    </>
  );

  const prompt = (
    <AskPrompt
      value={session.draft}
      onChange={session.setDraft}
      onSubmit={session.submit}
      pending={pending}
      compact={sidebar}
      hint={
        <>
          <ShieldCheck className="size-3.5 shrink-0" aria-hidden />
          {SAFETY}
        </>
      }
    />
  );

  if (sidebar) {
    return (
      <div className="flex flex-col">
        {prompt}
        {!answer && examples}
        {status}
        {answer && (
          <>
            <CompactResults
              answer={answer}
              onOpenDonor={setSelectedId}
              selectedId={selectedId}
            />
            <details className="mt-4 rounded-2xl border border-border bg-surface px-3 py-1">
              <summary className="flex min-h-11 cursor-pointer items-center text-sm text-foreground">
                Example questions
              </summary>
              {examples}
              <div className="h-3" />
            </details>
          </>
        )}
        <DonorDrawer donorId={selectedId} onClose={() => setSelectedId(null)} />
      </div>
    );
  }

  return (
    <div className="donor-inbox">
      <section
        aria-labelledby={titleId}
        className="mx-auto flex max-w-3xl flex-col items-center px-1 pt-6 pb-8 text-center md:pt-12"
      >
        <p className="inbox-eyebrow">ASK GATHERLY</p>
        <h2
          id={titleId}
          className="mt-2 text-[28px] leading-tight font-semibold tracking-[-0.02em] md:text-[40px]"
        >
          What would you like to know about your donors?
        </h2>
        <p className="mt-3 max-w-xl text-[15px] text-muted-foreground">
          Ask in plain English. The AI turns your question into filters you can
          see and edit; your own records answer it.
        </p>
        <div className="mt-7 w-full">{prompt}</div>
        {examples}
      </section>

      {status}

      {answer && (
        <AskResults
          answer={answer}
          original={session.original}
          intent={session.intent}
          pending={pending}
          onIntent={session.setIntent}
          onFilter={session.refilter}
          onReset={session.reset}
          onOpenDonor={setSelectedId}
          selectedId={selectedId}
        />
      )}

      <DonorDrawer donorId={selectedId} onClose={() => setSelectedId(null)} />
    </div>
  );
};

/** The sidebar's answer: how it read the question, removable filters, the hand-off, compact rows. */
const CompactResults = ({
  answer,
  selectedId,
  onOpenDonor,
}: {
  answer: AskAnswer;
  selectedId: number | null;
  onOpenDonor: (id: number) => void;
}) => {
  const session = useAskSession();
  const chips = filterChips(answer.filter);
  const count = answer.donors.length;
  const interpretation =
    answer.served_from === "edited" && session.original
      ? session.original.interpretation
      : answer.interpretation;

  return (
    <section
      aria-label="Answer"
      aria-busy={session.pending}
      className={cn(
        "mt-4 flex flex-col gap-3 transition-opacity",
        session.pending && "opacity-60",
      )}
    >
      <div className="rounded-2xl bg-surface p-3">
        <p className="text-[11px] font-semibold tracking-wide text-muted-foreground">
          HOW I READ YOUR QUESTION ·{" "}
          <span title={answer.detail ?? undefined}>
            {SERVED[answer.served_from]}
          </span>
        </p>
        <p className="mt-1 text-sm leading-snug text-foreground">
          {interpretation}
        </p>
        {answer.understood && chips.length > 0 && (
          <ul
            className="mt-2 flex flex-wrap gap-1.5"
            aria-label="Interpreted filters"
          >
            {chips.map((chip) => (
              <li key={chip.key}>
                <button
                  type="button"
                  disabled={session.pending}
                  onClick={() =>
                    session.refilter(withoutChip(answer.filter, chip.key))
                  }
                  aria-label={`Remove filter: ${chip.label}`}
                  className="inline-flex min-h-11 items-center gap-1.5 rounded-full bg-brand-soft px-3 text-[13px] text-brand-soft-foreground transition-colors hover:bg-olive disabled:opacity-60"
                >
                  {chip.label}
                  <X className="size-3.5" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        )}
        {answer.served_from === "edited" && session.original && (
          <button
            type="button"
            onClick={session.reset}
            disabled={session.pending}
            className="mt-1 inline-flex min-h-11 items-center rounded-full px-2 text-[13px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
          >
            Reset filters
          </button>
        )}
      </div>

      {answer.understood && (
        <>
          <NextAction
            count={count}
            donorIds={answer.donors.map((d) => d.id)}
            intent={session.intent}
            onIntent={session.setIntent}
            stacked
          />
          <p className="text-[13px] font-semibold text-foreground">
            {count} matching {count === 1 ? "donor" : "donors"}
          </p>
          {count > 0 && (
            <ul className="flex flex-col gap-1" aria-label="Matching donors">
              {answer.donors.map((donor) => (
                <li key={donor.id}>
                  <button
                    type="button"
                    onClick={() => onOpenDonor(donor.id)}
                    aria-label={`Open ${donor.full_name}`}
                    aria-describedby={`ask-side-reason-${donor.id}`}
                    className={cn(
                      "flex min-h-11 w-full items-center gap-3 rounded-xl px-3 py-2 text-left transition-colors hover:bg-accent",
                      selectedId === donor.id && "bg-brand-soft",
                    )}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-foreground">
                        {donor.full_name}
                      </span>
                      <span
                        id={`ask-side-reason-${donor.id}`}
                        className="block truncate text-xs text-muted-foreground"
                      >
                        {answer.filter.gave_between && donor.ask?.period_gifts
                          ? `Gave ${formatUsd(donor.ask.period_total)} in this period · `
                          : ""}
                        {donor.why_short}
                      </span>
                    </span>
                    <span
                      className={cn(
                        "shrink-0 rounded-md px-2 py-0.5 text-[11px] font-medium",
                        statusClass[donor.status],
                      )}
                    >
                      {statusLabel[donor.status]}
                    </span>
                    <ArrowRight
                      className="size-4 shrink-0 text-muted-foreground"
                      aria-hidden
                    />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
};
