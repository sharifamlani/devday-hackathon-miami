import { useEffect, useRef, useState } from "react";
import { Check, Loader2, Sparkles } from "lucide-react";

import { cn } from "@/lib/utils";
import { listServerCallNotes } from "../providers/local/calls";
import { DATA_MODE } from "../providers/local/config";
import {
  proposeAfterCall,
  useAfterCall,
  type AfterCallAction,
  type AfterCallProposal,
  type AfterCallResult,
} from "../providers/local/voice";

/**
 * The after-call card (plan §3.4 / §21.3.4): once a call note is saved, the
 * agent reads it (POST /call-notes/{id}/actions, writes nothing) and lists
 * the follow-ups it supports: tasks, RSVPs, pledges, context notes, interest
 * tags, each with a checkbox. "Apply selected" writes only the ticked ones
 * (POST /call-notes/{id}/apply) and refetches tasks and the calendar;
 * "Discard" writes nothing. Nothing is ever sent from here.
 */

const KIND: Record<string, string> = {
  create_task: "Task",
  rsvp_event: "Calendar",
  record_pledge: "Pledge",
  add_context_note: "Context",
  tag_interest: "Interest",
};

/**
 * The pane saves the note with a debounced POST /calls after the summary (measured: it started
 * 2+ s after the card appeared). The card waits for it on GET /calls, which always answers 200,
 * instead of polling /actions into 404s (console errors), for ~10 s at most.
 */
const NOT_SAVED_RETRIES = 14;
const RETRY_MS = 700;

type Phase = "reading" | "ready" | "applying" | "applied" | "discarded" | "error";

export const AfterCallCard = ({
  noteId,
  contactName,
  retryMs = RETRY_MS,
}: {
  noteId: string;
  /** Shown until the agent names the person it matched. */
  contactName?: string | null;
  retryMs?: number;
}) => {
  const { apply } = useAfterCall();
  const [phase, setPhase] = useState<Phase>("reading");
  const [proposal, setProposal] = useState<AfterCallProposal | null>(null);
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [result, setResult] = useState<AfterCallResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const live = useRef(true);

  useEffect(() => {
    live.current = true;
    let tries = 0;
    let timer: number | undefined;
    const saved = async () => (await listServerCallNotes()).some((n) => n.id === noteId);
    const read = async () => {
      try {
        while (!(await saved())) {
          if (tries >= NOT_SAVED_RETRIES) throw new Error("This call isn’t saved yet. Try again in a moment.");
          tries += 1;
          await new Promise((resolve) => {
            timer = window.setTimeout(resolve, retryMs);
          });
          if (!live.current) return;
        }
        const p = await proposeAfterCall(noteId);
        if (!live.current) return;
        setProposal(p);
        setTicked(new Set(p.actions.map((a) => a.id)));
        setPhase("ready");
      } catch (e) {
        if (!live.current) return;
        setError(e instanceof Error ? e.message : "The agent couldn't read this call.");
        setPhase("error");
      }
    };
    setPhase("reading");
    setError(null);
    void read();
    return () => {
      live.current = false;
      window.clearTimeout(timer);
    };
  }, [noteId, attempt, retryMs]);

  const name = proposal?.person?.first_name || proposal?.person?.full_name || contactName || null;
  const title = name ? `Agent · from your call with ${name}` : "Agent · from your call";
  const actions = proposal?.actions ?? [];
  const appliedIds = new Set(result?.applied.map((a) => a.id));
  const skipped = new Map(result?.skipped.map((s) => [s.id, s.why]));
  const locked = phase !== "ready";

  const toggle = (id: string) =>
    setTicked((t) => {
      const next = new Set(t);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const onApply = () => {
    const ids = actions.filter((a) => ticked.has(a.id)).map((a) => a.id);
    if (!ids.length) return;
    setPhase("applying");
    apply.mutate(
      { callNoteId: noteId, actionIds: ids },
      {
        onSuccess: (r) => {
          setResult(r);
          setPhase("applied");
        },
        onError: (e) => {
          setError(e instanceof Error ? e.message : "Applying failed.");
          setPhase("ready");
        },
      },
    );
  };

  return (
    <section
      aria-label="After-call actions"
      data-after-call={phase}
      className="mt-4 rounded-2xl border border-border bg-card p-4 text-sm shadow-[0_6px_24px_#34302610]"
    >
      <h3 className="mb-2 flex items-center gap-2 font-semibold">
        <Sparkles className="size-4 text-primary" aria-hidden />
        {title}
      </h3>

      {phase === "reading" && (
        <p className="flex items-center gap-2 text-muted-foreground" role="status">
          <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden />
          Reading your call…
        </p>
      )}

      {phase === "error" && (
        <div role="alert" className="text-[#c62a2f]">
          <p>{error}</p>
          <button
            type="button"
            onClick={() => setAttempt((n) => n + 1)}
            className="mt-2 rounded-full border border-border px-3 py-1 text-foreground hover:bg-accent"
          >
            Try again
          </button>
        </div>
      )}

      {proposal && phase !== "reading" && phase !== "error" && (
        <>
          {proposal.steps.length > 0 && (
            <ul aria-label="What the agent did" className="mb-3 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
              {proposal.steps.map((s) => (
                <li key={s} className="flex items-center gap-1">
                  <Check className="size-3.5 text-[#2f8f5b]" aria-hidden />
                  {s}
                </li>
              ))}
            </ul>
          )}

          {actions.length === 0 ? (
            <p className="text-muted-foreground" role="status">
              Nothing to do from this call.
            </p>
          ) : (
            <ul aria-label="Proposed actions" className="space-y-2">
              {actions.map((a: AfterCallAction) => {
                const done = appliedIds.has(a.id);
                const why = skipped.get(a.id);
                return (
                  <li key={a.id}>
                    <label className={cn("flex items-start gap-2.5", locked ? "cursor-default" : "cursor-pointer")}>
                      {done ? (
                        <Check aria-label="Applied" className="mt-0.5 size-4 shrink-0 text-[#2f8f5b]" />
                      ) : (
                        <input
                          type="checkbox"
                          checked={ticked.has(a.id)}
                          disabled={locked}
                          onChange={() => toggle(a.id)}
                          className="mt-1 size-4 shrink-0 accent-[#242728]"
                        />
                      )}
                      <span className="min-w-0">
                        <span className="font-medium">{KIND[a.type] ?? a.type}:</span> {a.label}
                        {a.evidence && (
                          <span className="block text-xs text-muted-foreground">“{a.evidence}”</span>
                        )}
                        {why && <span className="block text-xs text-[#9a6b00]">Not applied: {why}</span>}
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          )}

          {error && phase === "ready" && (
            <p role="alert" className="mt-2 text-xs text-[#c62a2f]">
              {error}
            </p>
          )}

          {phase === "applied" && (
            <p className="mt-3 text-xs text-muted-foreground" role="status">
              Applied {result?.applied.length ?? 0} of {actions.length}. Tasks and the calendar are updated.
            </p>
          )}
          {phase === "discarded" && (
            <p className="mt-3 text-xs text-muted-foreground" role="status">
              Discarded. Nothing was saved.
            </p>
          )}

          {actions.length > 0 && (phase === "ready" || phase === "applying") && (
            <div className="mt-3 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setPhase("discarded")}
                disabled={phase === "applying"}
                className="rounded-full border border-border px-4 py-1.5 hover:bg-accent disabled:opacity-50"
              >
                Discard
              </button>
              <button
                type="button"
                onClick={onApply}
                disabled={phase === "applying" || ticked.size === 0}
                className="inline-flex items-center gap-1.5 rounded-full bg-primary px-4 py-1.5 text-brand disabled:opacity-50 dark:text-primary-foreground"
              >
                {phase === "applying" && <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden />}
                Apply selected
              </button>
            </div>
          )}
        </>
      )}
    </section>
  );
};

/** Only the live service can read a call; the snapshot build has no after-call agent. */
export const afterCallAvailable = () => DATA_MODE === "local";
