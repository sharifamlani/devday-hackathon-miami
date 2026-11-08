import { useEffect, useRef, useState } from "react";
import { Check, Loader2, Sparkles } from "lucide-react";

import { cn } from "@/lib/utils";
import type { NoteDestination } from "./callNotes";
import { listServerCallNotes } from "../providers/local/calls";
import { useEvents } from "../providers/local/crmHooks";
import type { CrmEvent } from "../providers/local/crmTypes";
import { useDonors } from "../providers/local/hooks";
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

type MatchedPerson = NonNullable<AfterCallProposal["person"]>;

/**
 * One proposal per note: React StrictMode mounts the card twice in development, and each
 * /actions is a model call. A failed request is dropped so Try again asks afresh.
 */
const proposals = new Map<string, Promise<AfterCallProposal>>();
export const proposeOnce = (noteId: string, fresh = false): Promise<AfterCallProposal> => {
  if (fresh || !proposals.has(noteId)) {
    proposals.set(
      noteId,
      proposeAfterCall(noteId).catch((e: unknown) => {
        proposals.delete(noteId);
        throw e;
      }),
    );
  }
  return proposals.get(noteId)!;
};
export const forgetProposals = () => proposals.clear();

/** Case, accents and spacing folded: "Rosa  Martínez" and "rosa martinez" are the same name. */
export const foldName = (name: string) =>
  name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

/**
 * The agent's matched person becomes the note's donor only on a full-name match (first and last,
 * folded) with who the call was with, and only when exactly one donor has that name. A first-name
 * match once attached a "Rosa Delgado" call to Rosa Elena Martinez; two "Rosa Martinez" records
 * before a merge would be a coin toss. Anything else leaves the chip empty for staff to choose.
 */
export const confidentMatch = (
  person: AfterCallProposal["person"],
  contactName: string | null | undefined,
  donors: { id: number; full_name: string | null }[] | undefined,
): person is MatchedPerson => {
  if (!person?.full_name || !contactName || !donors) return false;
  const name = foldName(person.full_name);
  if (name.split(" ").length < 2 || name !== foldName(contactName)) return false;
  const same = donors.filter((d) => d.full_name && foldName(d.full_name) === name);
  return same.length === 1 && same[0].id === person.id;
};

/**
 * Where an RSVP action will actually write, and whether that looks like what was said. The agent
 * can only pick an event id from the calendar; when the event named on the call is missing (setup
 * sometimes misses the 5K) it may pick a same-day neighbour (the 5K's Post-Race Festival) while its
 * label still names the 5K. So the card shows the real target, and flags it when the target's
 * title has distinctive words that weren't said.
 */
export type RsvpCheck = { event: CrmEvent | null; mismatch: boolean };
const NAME_WORDS = /[a-z]{5,}/g;
export const checkRsvp = (action: AfterCallAction, events: CrmEvent[] | undefined): RsvpCheck | null => {
  if (action.type !== "rsvp_event" || !events) return null;
  const id = Number(action.payload.event_id);
  const event = events.find((e) => e.id === id) ?? null;
  if (!event) return { event: null, mismatch: true };
  const said = new Set(foldName(action.evidence ?? action.label).match(NAME_WORDS) ?? []);
  const unsaid = (foldName(event.title).match(NAME_WORDS) ?? []).filter((w) => !said.has(w));
  return { event, mismatch: unsaid.length > 0 };
};

const eventDate = (startsAt: string) =>
  new Date(startsAt).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });

/** The note's destinations with the matched donor added, unless a donor is already set. */
export const withMatchedDonor = (destinations: NoteDestination[], person: MatchedPerson): NoteDestination[] =>
  destinations.some((d) => d.kind === "donor")
    ? destinations
    : [...destinations, { kind: "donor", id: String(person.id), label: person.full_name ?? "" }];

export const AfterCallCard = ({
  noteId,
  contactName,
  onMatchedPerson,
  retryMs = RETRY_MS,
}: {
  noteId: string;
  /** Shown until the agent names the person it matched. */
  contactName?: string | null;
  /** Called once with the agent's matched person when it agrees with contactName. */
  onMatchedPerson?: (person: MatchedPerson) => void;
  retryMs?: number;
}) => {
  const { apply } = useAfterCall();
  const [phase, setPhase] = useState<Phase>("reading");
  const [proposal, setProposal] = useState<AfterCallProposal | null>(null);
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [result, setResult] = useState<AfterCallResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  // Only the newest request may fill the card, and never once the person has changed a tick:
  // a late or duplicate response must not undo their choices (IT lane: 1 run in 3 re-ticked all).
  const latest = useRef(0);
  const edited = useRef(false);
  const onMatched = useRef(onMatchedPerson);
  onMatched.current = onMatchedPerson;
  const donors = useDonors();
  const matchChecked = useRef(false);
  const events = useEvents();
  const rsvpChecked = useRef(false);

  useEffect(() => {
    // Once the person has changed a tick, their card stands: no reset, no new request.
    if (edited.current) return;
    let cancelled = false; // per run: StrictMode's first run must not land after the second starts
    const seq = ++latest.current;
    const stale = () => cancelled || seq !== latest.current;
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
          if (stale()) return;
        }
        if (stale()) return; // a superseded run must not even ask (each /actions is a model call)
        const p = await proposeOnce(noteId, attempt > 0);
        if (stale() || edited.current) return;
        setProposal(p);
        setTicked(new Set(p.actions.map((a) => a.id)));
        setPhase("ready");
      } catch (e) {
        if (stale() || edited.current) return;
        setError(e instanceof Error ? e.message : "The agent couldn't read this call.");
        setPhase("error");
      }
    };
    setPhase("reading");
    setError(null);
    void read();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
    // contactName is read once per proposal; a later change must not ask the model again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [noteId, attempt, retryMs]);

  // An RSVP that may hit the wrong event starts unticked (once, before the person edits).
  useEffect(() => {
    if (rsvpChecked.current || !proposal || !events.data || edited.current) return;
    rsvpChecked.current = true;
    const doubtful = proposal.actions.filter((a) => checkRsvp(a, events.data)?.mismatch).map((a) => a.id);
    if (doubtful.length) setTicked((t) => new Set([...t].filter((id) => !doubtful.includes(id))));
  }, [proposal, events.data]);

  // Pre-fill the note's donor once, when both the proposal and the donor list are in.
  useEffect(() => {
    if (matchChecked.current || !proposal || !donors.data) return;
    matchChecked.current = true;
    if (confidentMatch(proposal.person, contactName, donors.data)) onMatched.current?.(proposal.person);
  }, [proposal, donors.data, contactName]);

  const name = proposal?.person?.first_name || proposal?.person?.full_name || contactName || null;
  const title = name ? `Agent · from your call with ${name}` : "Agent · from your call";
  const actions = proposal?.actions ?? [];
  const appliedIds = new Set(result?.applied.map((a) => a.id));
  const skipped = new Map(result?.skipped.map((s) => [s.id, s.why]));
  const locked = phase !== "ready";

  const toggle = (id: string) => {
    edited.current = true;
    setTicked((t) => {
      const next = new Set(t);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

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
          {actions.length === 0 ? (
            <p className="text-muted-foreground" role="status">
              Nothing to do from this call.
            </p>
          ) : phase === "discarded" ? null : (
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
                        {(() => {
                          const rsvp = checkRsvp(a, events.data);
                          if (!rsvp) return null;
                          if (!rsvp.event)
                            return (
                              <span className="block text-xs text-[#9a6b00]" data-rsvp="missing">
                                That event isn’t in the calendar. Check before applying.
                              </span>
                            );
                          return (
                            <span
                              className={cn("block text-xs", rsvp.mismatch ? "text-[#9a6b00]" : "text-muted-foreground")}
                              data-rsvp={rsvp.mismatch ? "mismatch" : "ok"}
                            >
                              RSVP goes to: {rsvp.event.title} · {eventDate(rsvp.event.starts_at)}
                              {rsvp.mismatch && ". That isn’t quite what was said; check it’s the right event."}
                            </span>
                          );
                        })()}
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
