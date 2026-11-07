import { useId, useState, type FormEvent, type KeyboardEvent } from "react";
import { ArrowUp, Loader2, ShieldCheck, Sparkles } from "lucide-react";

import { cn } from "@/lib/utils";
import { DonorDrawer } from "../contacts/DonorDrawer";
import {
  EXAMPLE_QUESTIONS,
  type AskAnswer,
  type AskFilter,
  type AskIntent,
} from "../providers/local/ask";
import { DATA_MODE } from "../providers/local/config";
import { useAsk } from "../providers/local/hooks";
import { AskResults } from "./AskResults";
import "../dashboard/donor-inbox.css";

/**
 * Ask Donor Desk (issue #36): one prompt, example chips, then the donors that
 * match. The model only reads the question into filters; the rows come from
 * the donor records (service/ask_agent.py apply_filter).
 */
export const AskPage = () => {
  const ask = useAsk();
  const promptId = useId();
  const hintId = useId();
  const [draft, setDraft] = useState("");
  // The answer to the question as asked, kept so "Reset filters" can restore it.
  const [original, setOriginal] = useState<AskAnswer | null>(null);
  const [answer, setAnswer] = useState<AskAnswer | null>(null);
  const [intent, setIntent] = useState<AskIntent | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);

  const run = async (
    question: string,
    filter?: AskFilter | null,
    nextIntent?: AskIntent | null,
  ) => {
    try {
      const result = await ask.mutateAsync({
        question,
        filter,
        intent: nextIntent,
      });
      setAnswer(result);
      if (!filter) {
        setOriginal(result);
        setIntent(result.intent);
      }
    } catch {
      // ask.error is shown below
    }
  };

  const submit = (question: string) => {
    const text = question.trim();
    if (!text || ask.isPending) return;
    setDraft(text);
    void run(text);
  };

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    submit(draft);
  };

  // Enter asks; Shift+Enter adds a line.
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (
      event.key === "Enter" &&
      !event.shiftKey &&
      !event.nativeEvent.isComposing
    ) {
      event.preventDefault();
      submit(draft);
    }
  };

  return (
    <div className="donor-inbox">
      <section
        aria-labelledby={`${promptId}-title`}
        className="mx-auto flex max-w-3xl flex-col items-center px-1 pt-6 pb-8 text-center md:pt-12"
      >
        <p className="inbox-eyebrow">ASK DONOR DESK</p>
        <h2
          id={`${promptId}-title`}
          className="mt-2 text-[28px] leading-tight font-semibold tracking-[-0.02em] md:text-[40px]"
        >
          What would you like to know about your donors?
        </h2>
        <p className="mt-3 max-w-xl text-[15px] text-muted-foreground">
          Ask in plain English. The AI turns your question into filters you can
          see and edit; your own records answer it.
        </p>

        <form onSubmit={onSubmit} className="mt-7 w-full">
          <label htmlFor={promptId} className="sr-only">
            Ask a question about your donors
          </label>
          <div className="relative rounded-[28px] border border-border bg-card p-2 text-left shadow-[0_12px_40px_#34302612] focus-within:ring-2 focus-within:ring-ring">
            <textarea
              id={promptId}
              rows={3}
              value={draft}
              maxLength={500}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={onKeyDown}
              aria-describedby={hintId}
              placeholder="Who gave this quarter and hasn't been thanked yet?"
              className="block min-h-[96px] w-full resize-none rounded-[22px] bg-transparent px-4 pt-3 pr-16 pb-3 text-base text-foreground outline-none placeholder:text-muted-foreground focus-visible:outline-none"
            />
            <button
              type="submit"
              disabled={!draft.trim() || ask.isPending}
              aria-label={ask.isPending ? "Asking" : "Ask"}
              className="absolute right-3 bottom-3 grid size-11 place-items-center rounded-full bg-primary text-brand transition-opacity disabled:opacity-50 dark:text-primary-foreground"
            >
              {ask.isPending ? (
                <Loader2
                  className="size-5 animate-spin motion-reduce:animate-none"
                  aria-hidden
                />
              ) : (
                <ArrowUp className="size-5" aria-hidden />
              )}
            </button>
          </div>
          <p
            id={hintId}
            className="mt-2 flex items-center justify-center gap-1.5 text-xs text-muted-foreground"
          >
            <ShieldCheck className="size-3.5" aria-hidden />
            {DATA_MODE === "local"
              ? "Read-only: the AI never writes records, sends messages, or sees donor details."
              : "Cached sample: the example questions are precomputed. Live AI runs on the demo laptop."}
          </p>
        </form>

        <ul
          aria-label="Example questions"
          className="mt-5 flex flex-wrap justify-center gap-2"
        >
          {EXAMPLE_QUESTIONS.map((question) => (
            <li key={question}>
              <button
                type="button"
                onClick={() => submit(question)}
                disabled={ask.isPending}
                className={cn(
                  "inline-flex min-h-11 max-w-full items-center gap-2 rounded-full border border-border bg-card px-4 py-2 text-left text-sm text-foreground transition-colors hover:bg-accent disabled:opacity-60",
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
      </section>

      <div aria-live="polite" className="sr-only">
        {ask.isPending
          ? "Reading your question…"
          : answer
            ? `${answer.donors.length} donors match.`
            : ""}
      </div>

      {ask.isError && (
        <p
          role="alert"
          className="mx-auto mb-6 max-w-3xl rounded-2xl bg-alert px-4 py-3 text-sm text-alert-foreground"
        >
          We couldn’t answer that: {ask.error.message}
        </p>
      )}

      {answer && (
        <AskResults
          answer={answer}
          original={original}
          intent={intent}
          pending={ask.isPending}
          onIntent={setIntent}
          onFilter={(filter) => void run(answer.question, filter, intent)}
          onReset={() => original && setAnswer(original)}
          onOpenDonor={setSelectedId}
          selectedId={selectedId}
        />
      )}

      <DonorDrawer donorId={selectedId} onClose={() => setSelectedId(null)} />
    </div>
  );
};
