import {
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
} from "react";
import {
  CalendarPlus,
  Check,
  Mic,
  Pause,
  Play,
  Send,
  Sparkles,
  ArrowRight,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { AskSessionContext } from "../ask/askSessionContext";
import { saveCallNoteEverywhere } from "../providers/local/calls";
import { useCampaigns, useDonors } from "../providers/local/hooks";
import {
  saveCallNote,
  type CallNote,
  type NoteDestination,
  type NoteDestinationKind,
  type TranscriptLine,
} from "./callNotes";
import { DestinationChips, type DestinationOption } from "./DestinationChips";
import { DONOR_GROUPS, findCardFailedDonor } from "./donorGroups";
import {
  MIC_ERROR_MESSAGES,
  micAvailable,
  micErrorFor,
  openMicLevel,
  type MicLevel,
} from "./micLevel";
import { setRecording } from "./recordingState";
import {
  buildSummary,
  defaultNoteTitle,
  formatElapsed,
  nextStepKind,
  nextStepPrompt,
  savedConfirmation,
  type CallSummary,
} from "./summarize";
import { micTranscriptSource, usesGeminiCaptions } from "./geminiTranscriptSource";
import { labelSpeakers, takeRecording } from "./speakerLabels";
import { AfterCallCard, afterCallAvailable, withMatchedDonor } from "./AfterCallCard";
import {
  DEMO_FALLBACK_DONOR,
  demoCallScript,
  demoTranscriptSource,
  firstName,
  getSpeechRecognition,
  type TranscriptSource,
} from "./transcriptSource";
import { prefersReducedMotion } from "@/lib/motion";

export interface LiveTranscriptPaneProps {
  /** Close the right pane (the shell's header has the close button too). */
  onClose: () => void;
  /** The pane fills the workspace: center the content. */
  expanded: boolean;
}

type Tab = "notes" | "transcript" | "summary";
type SourceKind = "mic" | "demo";
/** starting = waiting for the mic permission prompt. */
type Status = "starting" | "live" | "paused" | "ended";

interface Notice {
  text: string;
  /** Show a "Try the demo call" button. */
  offerDemo?: boolean;
  /** Clears once speech comes through (e.g. "no speech heard"). */
  transient?: boolean;
}

const TABS: { id: Tab; label: string }[] = [
  { id: "notes", label: "My notes" },
  { id: "transcript", label: "Transcript" },
  { id: "summary", label: "Summary" },
];

/** Everything about the call in progress. */
interface CallDraft {
  noteId: string;
  startedAt: number;
  titleOverride: string | null;
  notes: string;
  destinations: NoteDestination[];
  lines: TranscriptLine[];
  elapsed: number;
  sourceKind: SourceKind;
  /** The demo's donor, fixed when the demo starts. */
  demoDonor: string;
  summary: CallSummary | null;
  tab: Tab;
}

/**
 * The call survives the pane switching to Ask and back (for example after
 * "Ask about this call"): the pane parks it here on unmount and picks it up,
 * paused, when it mounts again. A summarized call is already saved, so the
 * next open starts a new one.
 */
let parked: CallDraft | null = null;

const newId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? `call-${crypto.randomUUID()}`
    : `call-${Date.now().toString(36)}`;

const freshDraft = (sourceKind: SourceKind, demoDonor: string): CallDraft => ({
  noteId: newId(),
  startedAt: Date.now(),
  titleOverride: null,
  notes: "",
  destinations: [],
  lines: [],
  elapsed: 0,
  sourceKind,
  demoDonor,
  summary: null,
  tab: "transcript",
});

const clockTime = (startedAt: number, at: number) =>
  new Date(startedAt + at * 1000).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });

const WAVE_BARS = Array.from({ length: 36 }, (_, i) => ({
  delay: `${((i * 0.06) % 1).toFixed(2)}s`,
  rest: (0.25 + 0.6 * Math.abs(Math.sin(i * 1.7))).toFixed(2),
}));

// Waveform motion lives here because the pane owns no stylesheet. Reduced
// motion keeps a still waveform.
const WAVE_CSS = `
@keyframes vt-wave { 0%, 100% { transform: scaleY(0.18); } 50% { transform: scaleY(1); } }
.vt-wave-bar { transform: scaleY(var(--vt-rest)); transform-origin: center; }
.vt-wave[data-live="false"] .vt-wave-bar { transform: scaleY(0.18); }
.vt-wave[data-live="true"] .vt-wave-bar { animation: vt-wave 1s ease-in-out infinite; }
:root[data-motion="reduce"] .vt-wave-bar { animation: none !important; }
@media (prefers-reduced-motion: reduce) {
  :root:not([data-motion="full"]) .vt-wave-bar { animation: none !important; }
}
`;

const pill =
  "inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-full px-4 text-sm font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-50";

/**
 * Wispr Flow-style note taking for a call: title, where to file it, your
 * notes, the live transcript (microphone or a scripted demo call) and a
 * summary that is saved with saveCallNote(). The shell renders the pane
 * header (title, expand, close); this is the body and footer.
 */
export const LiveTranscriptPane = ({ expanded }: LiveTranscriptPaneProps) => {
  const askSession = useContext(AskSessionContext);
  const donors = useDonors();
  const campaigns = useCampaigns();
  // The mic needs getUserMedia; captions also need SpeechRecognition.
  const [micOk] = useState(micAvailable);
  const [captionsOk] = useState(() => usesGeminiCaptions() || getSpeechRecognition() != null);

  const cardDonor = findCardFailedDonor(donors.data);
  const demoDonorNow = cardDonor?.full_name ?? DEMO_FALLBACK_DONOR;

  // Restore a parked call (paused) or start a new one.
  const [initial] = useState(() => {
    const restore = parked && !parked.summary ? parked : null;
    parked = null;
    return {
      draft:
        restore ??
        freshDraft(micOk && captionsOk ? "mic" : "demo", demoDonorNow),
      restored: !!restore,
    };
  });
  const [draft, setDraft] = useState<CallDraft>(initial.draft);
  const [status, setStatus] = useState<Status>("paused");
  const [interim, setInterim] = useState("");
  const [notice, setNotice] = useState<Notice | null>(
    initial.restored
      ? { text: "Call paused. Press Resume to keep going." }
      : initial.draft.sourceKind === "demo"
        ? { text: "This browser can't caption live, so this is a demo call." }
        : null,
  );
  const [summarizing, setSummarizing] = useState(false);
  const [question, setQuestion] = useState("");
  const [micOn, setMicOn] = useState(false);

  const sourceRef = useRef<TranscriptSource | null>(null);
  const micRef = useRef<MicLevel | null>(null);
  // Bumped by every start/stop, so a slow permission prompt that resolves
  // after the person paused or switched sources is ignored.
  const runRef = useRef(0);
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const mounted = useRef(true);

  const update = useCallback(
    (patch: Partial<CallDraft>) => setDraft((d) => ({ ...d, ...patch })),
    [],
  );

  /* ---------- Transcript source and microphone ---------- */

  /** Stop captions and release the mic (the browser's indicator goes off). */
  const stopAll = useCallback(() => {
    runRef.current += 1;
    sourceRef.current?.stop();
    sourceRef.current = null;
    micRef.current?.close();
    micRef.current = null;
    setMicOn(false);
    setInterim("");
  }, []);

  const runSource = useCallback((source: TranscriptSource) => {
    sourceRef.current = source;
    source.start({
      onLine: (line) => {
        if (sourceRef.current !== source) return;
        // Stamp lines with the pane's own call clock, so timestamps match
        // the timer across pauses and restarted sources.
        setDraft((d) => ({
          ...d,
          lines: [...d.lines, { ...line, at: d.elapsed }],
        }));
        setNotice((n) => (n?.transient ? null : n));
      },
      onInterim: (text) => {
        if (sourceRef.current === source) setInterim(text);
      },
      onError: (error) => {
        if (sourceRef.current !== source) return;
        if (!error.fatal) {
          setNotice({ text: error.message, transient: true });
          return;
        }
        stopAllRef.current();
        setStatus("paused");
        setNotice({
          text:
            error.code === "not-allowed"
              ? MIC_ERROR_MESSAGES.denied
              : error.message,
          offerDemo: true,
        });
      },
    });
  }, []);

  /**
   * Start streaming. Demo: the script from `startIndex` (lines already
   * shown). Mic: ask for the microphone (the browser's prompt), drive the
   * waveform from it, and caption with the browser's speech recognizer.
   */
  const startSource = useCallback(
    async (kind: SourceKind, startIndex: number, demoDonor: string) => {
      stopAll();
      const run = runRef.current;
      if (kind === "demo") {
        setStatus("live");
        runSource(
          demoTranscriptSource({
            script: demoCallScript(demoDonor),
            themName: firstName(demoDonor),
            startIndex,
          }),
        );
        return;
      }
      setStatus("starting");
      let mic: MicLevel;
      try {
        mic = await openMicLevel();
      } catch (error) {
        if (run !== runRef.current || !mounted.current) return;
        setStatus("paused");
        setNotice({ text: micErrorFor(error).message, offerDemo: true });
        return;
      }
      if (run !== runRef.current || !mounted.current) {
        mic.close();
        return;
      }
      micRef.current = mic;
      setMicOn(true);
      setStatus("live");
      if (!usesGeminiCaptions() && !getSpeechRecognition()) {
        setNotice({
          text: "Live captions need Chrome or Edge; the demo call shows how it works.",
          offerDemo: true,
        });
        return;
      }
      runSource(micTranscriptSource());
    },
    [stopAll, runSource],
  );
  const startSourceRef = useRef(startSource);
  startSourceRef.current = startSource;
  const stopAllRef = useRef(stopAll);
  stopAllRef.current = stopAll;

  // Start on open (the click that opened the pane), unless this is a parked
  // call, which waits for Resume. Stop, release the mic and park on unmount.
  useEffect(() => {
    mounted.current = true;
    // A tick later, so a StrictMode remount doesn't start two sources.
    const timer = initial.restored
      ? undefined
      : setTimeout(() => {
          const d = initial.draft;
          void startSourceRef.current(d.sourceKind, 0, d.demoDonor);
        }, 0);
    return () => {
      clearTimeout(timer);
      mounted.current = false;
      stopAllRef.current();
      setRecording(false);
      parked = draftRef.current;
    };
  }, [initial]);

  // The header's red dot.
  useEffect(() => {
    setRecording(status === "live");
  }, [status]);

  // Call clock: ticks while live.
  useEffect(() => {
    if (status !== "live") return;
    const timer = setInterval(
      () => setDraft((d) => ({ ...d, elapsed: d.elapsed + 1 })),
      1000,
    );
    return () => clearInterval(timer);
  }, [status]);

  // Waveform from the real mic level. Reduced motion: a calmer refresh.
  const barRefs = useRef<(HTMLElement | null)[]>([]);
  useEffect(() => {
    const mic = micRef.current;
    if (!micOn || status !== "live" || !mic) return;
    const reduced = typeof window !== "undefined" && prefersReducedMotion();
    const levels = new Array<number>(WAVE_BARS.length).fill(0);
    let frame = 0;
    let last = 0;
    const draw = (time: number) => {
      frame = requestAnimationFrame(draw);
      if (reduced && time - last < 250) return;
      last = time;
      mic.bands(WAVE_BARS.length, levels);
      barRefs.current.forEach((bar, i) => {
        if (bar)
          bar.style.transform = `scaleY(${(0.15 + 0.85 * levels[i]).toFixed(3)})`;
      });
    };
    frame = requestAnimationFrame(draw);
    const bars = barRefs.current;
    return () => {
      cancelAnimationFrame(frame);
      bars.forEach((bar) => {
        if (bar) bar.style.transform = "";
      });
    };
  }, [micOn, status]);

  const pause = () => {
    if (draft.sourceKind === "mic") {
      // Release the mic entirely; Resume asks for it again (no new prompt
      // once allowed).
      stopAll();
    } else {
      sourceRef.current?.pause();
    }
    setInterim("");
    setStatus("paused");
  };

  const resume = () => {
    setNotice(null);
    if (draft.summary) update({ summary: null, tab: "transcript" });
    else if (draft.tab === "summary") update({ tab: "transcript" });
    if (draft.sourceKind === "demo" && sourceRef.current) {
      sourceRef.current.resume();
      setStatus("live");
    } else {
      void startSource(draft.sourceKind, draft.lines.length, draft.demoDonor);
    }
  };

  const switchSource = (kind: SourceKind) => {
    if (kind === draft.sourceKind && status !== "paused") return;
    // A new source is a new transcript; mixing mic and script lines makes no sense.
    const demoDonor = kind === "demo" ? demoDonorNow : draft.demoDonor;
    const restart = kind !== draft.sourceKind;
    if (restart) {
      setDraft((d) => ({
        ...d,
        sourceKind: kind,
        lines: [],
        elapsed: 0,
        summary: null,
        tab: "transcript",
        demoDonor,
      }));
    }
    setNotice(null);
    void startSource(
      kind,
      restart ? 0 : draft.lines.length,
      restart ? demoDonor : draft.demoDonor,
    );
  };

  /* ---------- Title and destinations ---------- */

  const donorDestination = draft.destinations.find((d) => d.kind === "donor");
  const donorName =
    donorDestination?.label ??
    (draft.sourceKind === "demo" ? draft.demoDonor : null);
  const title =
    draft.titleOverride ??
    defaultNoteTitle(donorName, new Date(draft.startedAt));

  const options = useMemo<Record<NoteDestinationKind, DestinationOption[]>>(
    () => ({
      donor: (donors.data ?? []).map((d) => ({
        id: String(d.id),
        label: d.full_name,
        detail: d.city ?? undefined,
      })),
      group: DONOR_GROUPS.map((g) => ({
        id: g.id,
        label: g.label,
        detail: donors.data
          ? String(donors.data.filter(g.matches).length)
          : undefined,
      })),
      project: (campaigns.data ?? []).map((c) => ({
        id: String(c.id),
        label: c.name,
      })),
    }),
    [donors.data, campaigns.data],
  );

  /* ---------- Summary and saving ---------- */

  const generateSummary = async () => {
    const recording = takeRecording(sourceRef.current); // before stopAll ends it
    stopAll();
    setStatus("ended");
    setSummarizing(true);
    update({ tab: "summary" });
    const current = draftRef.current;
    try {
      const { lines } = await labelSpeakers(recording, current.lines, { donorName });
      if (lines !== current.lines) update({ lines });
      const result = await buildSummary({
        transcript: lines,
        donorName,
        notes: current.notes,
        today: new Date(current.startedAt),
        title: title.trim() || defaultNoteTitle(donorName, new Date()),
        donorId:
          current.destinations.find((d) => d.kind === "donor")?.id ?? null,
      });
      if (!mounted.current) return;
      update({
        summary: { summary: result.summary, nextSteps: result.nextSteps },
      });
    } finally {
      if (mounted.current) setSummarizing(false);
    }
  };

  // The note waiting on the debounce below. If the pane closes first, post it
  // now so the service still gets it (the browser copy is already saved).
  const pendingSave = useRef<CallNote | null>(null);
  useEffect(
    () => () => {
      const note = pendingSave.current;
      pendingSave.current = null;
      if (note) void saveCallNoteEverywhere(note);
    },
    [],
  );

  // Once summarized, keep the saved note in step with edits: this browser
  // and, with the live service, POST /calls (an upsert by id), debounced so
  // typing in My notes doesn't post on every key.
  useEffect(() => {
    if (!draft.summary) return;
    const note = {
      id: draft.noteId,
      title: title.trim() || defaultNoteTitle(donorName, new Date()),
      createdAt: new Date(draft.startedAt).toISOString(),
      durationSec: draft.elapsed,
      destinations: draft.destinations,
      transcript: draft.lines,
      notes: draft.notes,
      summary: draft.summary.summary,
      nextSteps: draft.summary.nextSteps,
    };
    saveCallNote(note);
    pendingSave.current = note;
    const timer = window.setTimeout(() => {
      pendingSave.current = null;
      void saveCallNoteEverywhere(note);
    }, 800);
    return () => window.clearTimeout(timer);
    // elapsed and lines are frozen while ended; title covers the override.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft.summary, draft.destinations, draft.notes, title]);

  /* ---------- Ask ---------- */

  const openAsk = (text: string, submit: boolean) => {
    if (!askSession) return;
    askSession.setDraft(text);
    askSession.openPane("ask");
    if (submit) askSession.submit(text);
  };

  /* ---------- Tabs ---------- */

  const baseId = useId();
  const tabId = (t: Tab) => `${baseId}-tab-${t}`;
  const panelId = (t: Tab) => `${baseId}-panel-${t}`;
  const tabRefs = useRef<Record<Tab, HTMLButtonElement | null>>({
    notes: null,
    transcript: null,
    summary: null,
  });
  const onTabKey = (event: KeyboardEvent<HTMLButtonElement>) => {
    const index = TABS.findIndex((t) => t.id === draft.tab);
    const next =
      event.key === "ArrowRight"
        ? (index + 1) % TABS.length
        : event.key === "ArrowLeft"
          ? (index - 1 + TABS.length) % TABS.length
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? TABS.length - 1
              : null;
    if (next == null) return;
    event.preventDefault();
    update({ tab: TABS[next].id });
    tabRefs.current[TABS[next].id]?.focus();
  };

  /* ---------- Auto-scroll ---------- */

  const scrollRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || draft.tab !== "transcript" || !stickToBottom.current) return;
    el.scrollTop = el.scrollHeight;
  }, [draft.lines.length, interim, draft.tab]);

  // Turns: consecutive lines from the same speaker.
  const turns = useMemo(() => {
    const out: { key: number; lines: TranscriptLine[] }[] = [];
    draft.lines.forEach((line, i) => {
      const last = out[out.length - 1];
      if (last && last.lines[0].speaker === line.speaker) last.lines.push(line);
      else out.push({ key: i, lines: [line] });
    });
    return out;
  }, [draft.lines]);

  const live = status === "live";
  const isDemo = draft.sourceKind === "demo";
  const inner = cn("w-full", expanded && "mx-auto max-w-[740px]");
  const stateLabel =
    status === "starting"
      ? "Waiting for microphone"
      : live
        ? "Listening"
        : status === "ended"
          ? "Ended"
          : "Paused";

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <style>{WAVE_CSS}</style>

      {/* Title, destinations, tabs */}
      <div className="shrink-0 px-[18px] pt-4">
        <div className={cn(inner, "flex flex-col gap-3")}>
          <label htmlFor={`${baseId}-title`} className="sr-only">
            Note title
          </label>
          <input
            id={`${baseId}-title`}
            value={title}
            onChange={(event) => update({ titleOverride: event.target.value })}
            onBlur={() => {
              if (!title.trim()) update({ titleOverride: null });
            }}
            className="w-full min-w-0 rounded-md border-0 border-b border-transparent bg-transparent p-0 text-2xl! leading-tight tracking-tight focus:border-border focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"
          />
          <DestinationChips
            destinations={draft.destinations}
            onChange={(destinations) => update({ destinations })}
            options={options}
            loading={{
              donor: donors.isPending,
              group: false,
              project: campaigns.isPending,
            }}
          />
          <div
            role="tablist"
            aria-label="Call note"
            className={cn(
              "-mx-[18px] flex gap-6 border-b border-border px-[18px]",
              expanded && "mx-0 px-0",
            )}
          >
            {TABS.map((t) => {
              const selected = draft.tab === t.id;
              return (
                <button
                  key={t.id}
                  ref={(el) => {
                    tabRefs.current[t.id] = el;
                  }}
                  id={tabId(t.id)}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  aria-controls={panelId(t.id)}
                  tabIndex={selected ? 0 : -1}
                  onClick={() => update({ tab: t.id })}
                  onKeyDown={onTabKey}
                  className={cn(
                    "-mb-px flex min-h-11 items-center gap-1.5 border-b-2 text-sm font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                    selected
                      ? "border-foreground text-foreground"
                      : "border-transparent text-muted-foreground hover:text-foreground",
                  )}
                >
                  {t.id === "summary" && (
                    <Sparkles className="size-3.5" aria-hidden="true" />
                  )}
                  {t.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Panels */}
      <div
        ref={scrollRef}
        onScroll={(event) => {
          const el = event.currentTarget;
          stickToBottom.current =
            el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        }}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-[18px] pt-4 pb-6"
      >
        <div className={inner}>
          {/* My notes */}
          <div
            id={panelId("notes")}
            role="tabpanel"
            aria-labelledby={tabId("notes")}
            hidden={draft.tab !== "notes"}
          >
            <label htmlFor={`${baseId}-notes`} className="sr-only">
              My notes
            </label>
            <textarea
              id={`${baseId}-notes`}
              value={draft.notes}
              onChange={(event) => update({ notes: event.target.value })}
              placeholder="Type notes during the call…"
              className="min-h-48 w-full resize-y rounded-xl border border-border bg-card p-3 text-sm leading-relaxed placeholder:text-muted-foreground focus-visible:outline-2 focus-visible:outline-ring"
            />
          </div>

          {/* Transcript */}
          <div
            id={panelId("transcript")}
            role="tabpanel"
            aria-labelledby={tabId("transcript")}
            hidden={draft.tab !== "transcript"}
            className="flex flex-col gap-2.5"
          >
            <div
              role="group"
              aria-label="Transcript source"
              className="inline-flex self-start rounded-full border border-border bg-muted p-0.5"
            >
              {(
                [
                  { kind: "mic", label: "Microphone", icon: Mic },
                  { kind: "demo", label: "Demo call", icon: Play },
                ] as const
              ).map(({ kind, label, icon: Icon }) => {
                const pressed = draft.sourceKind === kind;
                const unavailable = kind === "mic" && !micOk;
                return (
                  <button
                    key={kind}
                    type="button"
                    aria-pressed={pressed}
                    disabled={unavailable}
                    title={
                      unavailable
                        ? "This page can't use the microphone"
                        : undefined
                    }
                    onClick={() => switchSource(kind)}
                    className={cn(
                      "inline-flex min-h-9 items-center gap-1.5 rounded-full px-3 text-[13px] font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-50",
                      pressed
                        ? "bg-card text-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    <Icon className="size-3.5" aria-hidden="true" />
                    {label}
                  </button>
                );
              })}
            </div>

            <div
              role="status"
              className={cn("text-[13px]", !notice && "sr-only")}
            >
              {notice && (
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-[10px] bg-warn px-3 py-2 text-warn-foreground">
                  <span className="min-w-0 flex-1 basis-56">{notice.text}</span>
                  {notice.offerDemo && draft.sourceKind !== "demo" && (
                    <button
                      type="button"
                      onClick={() => switchSource("demo")}
                      className="min-h-9 shrink-0 rounded-full border border-current px-3 font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                    >
                      Try the demo call
                    </button>
                  )}
                </div>
              )}
            </div>

            <div className="flex items-center gap-2.5 rounded-[14px] border border-border bg-card px-3 py-2 tabular-nums">
              <span
                aria-hidden="true"
                className={cn(
                  "size-2.5 shrink-0 rounded-full",
                  live
                    ? "bg-[#e5534b] motion-safe:animate-pulse"
                    : "bg-muted-foreground",
                )}
              />
              <span className="text-sm font-semibold">
                <span className="sr-only">Call time </span>
                {formatElapsed(draft.elapsed)}
              </span>
              <span
                aria-hidden="true"
                data-live={live && draft.sourceKind === "demo"}
                className="vt-wave flex h-[18px] min-w-0 flex-1 items-center gap-[2px] overflow-hidden"
              >
                {WAVE_BARS.map((bar, i) => (
                  <i
                    key={i}
                    ref={(el) => {
                      barRefs.current[i] = el;
                    }}
                    className="vt-wave-bar block h-4 w-[2.5px] shrink-0 rounded-sm bg-[#c79a1c] dark:bg-brand"
                    style={
                      {
                        animationDelay: bar.delay,
                        "--vt-rest": bar.rest,
                      } as CSSProperties
                    }
                  />
                ))}
              </span>
              <span className="text-[13px] text-muted-foreground">
                {isDemo && (
                  <span className="mr-2 rounded-full bg-muted px-2 py-0.5 text-xs">
                    Demo transcript
                  </span>
                )}
                {stateLabel}
              </span>
            </div>

            <p className="rounded-[10px] bg-muted px-3 py-2 text-xs text-muted-foreground">
              After the call, Donor Desk cleans up the transcript and labels
              speakers.
            </p>

            <div
              role="log"
              aria-live="polite"
              aria-relevant="additions"
              aria-label="Transcript"
              className="flex flex-col gap-1.5"
            >
              {turns.length === 0 && !interim && (
                <p className="text-sm text-muted-foreground">
                  {live
                    ? isDemo
                      ? "The demo call is starting…"
                      : "Listening. Start talking and the words appear here."
                    : "Nothing transcribed yet."}
                </p>
              )}
              {turns.map((turn) => {
                const first = turn.lines[0];
                const you = first.speaker === "you";
                return (
                  <div key={turn.key} className="flex flex-col gap-1.5">
                    <p
                      className={cn(
                        "mt-1.5 flex items-baseline gap-2 text-xs font-bold",
                        you
                          ? "text-brand-soft-foreground"
                          : "text-good-foreground",
                      )}
                    >
                      {first.name}
                      <time
                        dateTime={new Date(
                          draft.startedAt + first.at * 1000,
                        ).toISOString()}
                        className="font-medium text-muted-foreground"
                      >
                        {clockTime(draft.startedAt, first.at)}
                      </time>
                    </p>
                    {turn.lines.map((line, i) => (
                      <p
                        key={i}
                        className="w-fit max-w-full rounded-xl bg-muted px-3 py-2 text-sm"
                      >
                        {i > 0 && (
                          <span className="sr-only">{line.name}: </span>
                        )}
                        {line.text}
                      </p>
                    ))}
                  </div>
                );
              })}
              {interim && (
                <p
                  aria-hidden="true"
                  className="w-fit max-w-full rounded-xl bg-muted px-3 py-2 text-sm italic opacity-65"
                >
                  {interim}
                </p>
              )}
            </div>
          </div>

          {/* Summary */}
          <div
            id={panelId("summary")}
            role="tabpanel"
            aria-labelledby={tabId("summary")}
            hidden={draft.tab !== "summary"}
            className="flex flex-col gap-3"
          >
            {summarizing ? (
              <p role="status" className="text-sm text-muted-foreground">
                Summarizing the call…
              </p>
            ) : !draft.summary ? (
              <p className="text-sm text-muted-foreground">
                No summary yet. Press Generate summary when the call ends.
              </p>
            ) : (
              <>
                <h3 className="text-sm font-bold">Summary</h3>
                <ul className="flex list-disc flex-col gap-1 pl-5 text-sm">
                  {draft.summary.summary.map((point, i) => (
                    <li key={i}>{point}</li>
                  ))}
                </ul>
                {draft.summary.nextSteps.length > 0 && (
                  <>
                    <h3 className="text-sm font-bold">Suggested next steps</h3>
                    <div className="flex flex-col items-start gap-2">
                      {draft.summary.nextSteps.map((step) => {
                        const kind = nextStepKind(step);
                        const Icon =
                          kind === "calendar"
                            ? CalendarPlus
                            : kind === "send"
                              ? Send
                              : ArrowRight;
                        return (
                          <button
                            key={step}
                            type="button"
                            onClick={() =>
                              openAsk(nextStepPrompt(step, donorName), false)
                            }
                            className={cn(
                              pill,
                              "border border-border bg-card hover:bg-accent",
                            )}
                          >
                            <Icon className="size-4" aria-hidden="true" />
                            {step}
                          </button>
                        );
                      })}
                    </div>
                  </>
                )}
                <p
                  role="status"
                  className="flex items-start gap-2 rounded-xl bg-good px-3 py-2.5 text-[13px] text-good-foreground"
                >
                  <Check
                    className="mt-0.5 size-4 shrink-0"
                    aria-hidden="true"
                  />
                  {savedConfirmation(draft.destinations)}
                </p>
                {afterCallAvailable() && (
                  <AfterCallCard
                    key={draft.noteId}
                    noteId={draft.noteId}
                    contactName={donorName}
                    onMatchedPerson={(person) => setDraft((d) => ({ ...d, destinations: withMatchedDonor(d.destinations, person) }))}
                  />
                )}
              </>
            )}
          </div>
        </div>
      </div>

      {/* Footer */}
      <div
        className={cn("shrink-0 border-t border-border px-[18px] pt-3 pb-4")}
      >
        <div className={cn(inner, "flex flex-col gap-2.5")}>
          <div className="flex justify-center">
            <button
              type="button"
              onClick={() => void generateSummary()}
              disabled={
                summarizing || (draft.lines.length === 0 && !draft.notes.trim())
              }
              className={cn(
                pill,
                "bg-primary px-5 text-primary-foreground hover:bg-primary/90",
              )}
            >
              <Sparkles className="size-4" aria-hidden="true" />
              Generate summary
            </button>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={live ? pause : resume}
              disabled={status === "starting"}
              className={cn(
                pill,
                "border border-border bg-card hover:bg-accent",
              )}
            >
              {live ? (
                <>
                  <Pause className="size-4" aria-hidden="true" />
                  Pause
                </>
              ) : (
                <>
                  <span
                    aria-hidden="true"
                    className="grid size-3.5 place-items-center rounded-full border-2 border-[#3a9b55]"
                  >
                    <span className="size-1.5 rounded-full bg-[#3a9b55]" />
                  </span>
                  Resume
                </>
              )}
            </button>
            <form
              className="min-w-0 flex-1"
              onSubmit={(event) => {
                event.preventDefault();
                const text = question.trim();
                if (!text) return;
                setQuestion("");
                openAsk(text, true);
              }}
            >
              <label htmlFor={`${baseId}-ask`} className="sr-only">
                Ask about this call
              </label>
              <input
                id={`${baseId}-ask`}
                value={question}
                onChange={(event) => setQuestion(event.target.value)}
                placeholder="Ask about this call…"
                enterKeyHint="send"
                className="min-h-11 w-full min-w-0 rounded-full border border-border bg-card px-4 text-sm placeholder:text-muted-foreground focus-visible:outline-2 focus-visible:outline-ring"
              />
            </form>
          </div>
        </div>
      </div>
    </div>
  );
};

export default LiveTranscriptPane;
