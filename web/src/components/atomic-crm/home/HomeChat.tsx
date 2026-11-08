import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from "react";
import {
  ArrowRight,
  AudioLines,
  CalendarPlus,
  Check,
  Mail,
  Sparkles,
  Paperclip,
  Plus,
  Upload,
} from "lucide-react";
import { Link, useNavigate } from "react-router";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { useAskSession } from "../ask/askSessionContext";
import { EXAMPLE_QUESTIONS, type AskAnswer } from "../providers/local/ask";
import { DATA_MODE } from "../providers/local/config";
import { Markdown } from "../misc/Markdown";
import { useAgentRefetch } from "../providers/local/refetch";
import { decide, sendToAgent, undoStep, useAgentChat } from "./agentChat";
import { ApprovalCard, StepCard, UndoneNote, undoneSummary } from "./AgentCards";
import { DictationButton, DictationHint } from "../voice/DictationButton";
import { useDictationInput } from "../voice/useDictationInput";
import { DICTATION_TOGGLE_EVENT } from "./useWorkspaceHotkeys";
import {
  answerSummary,
  appendAnswer,
  kindLabel,
  type HomeTask,
} from "./homeData";
import { focusRing } from "./tile";

const pill = cn(
  "inline-flex min-h-9 items-center justify-center gap-2 rounded-[10px] px-3 text-sm font-medium transition-colors",
  focusRing,
);

/* ---------- Focused task ---------- */

export const FocusTaskCard = ({
  task,
  index,
  total,
  draftHref,
  onDone,
  isPending,
  hasData,
  live = true,
  onAction,
  onWork,
}: {
  task: HomeTask | null;
  index: number;
  total: number;
  draftHref: string | null;
  onDone: (task: HomeTask) => void;
  isPending: boolean;
  /** False while the database is empty (nothing uploaded yet). */
  hasData: boolean;
  /** False in the read-only snapshot build: no "all caught up" there. */
  live?: boolean;
  onAction?: () => void;
  /** Hand this task to the home agent (live only). */
  onWork?: (task: HomeTask) => void;
}) => {
  const session = useAskSession();
  const headingId = useId();
  if (!task)
    return (
      <section
        data-tour="chat"
        aria-labelledby={headingId}
        className={"home-task-content"}
      >
        <h2 id={headingId} className="text-lg font-bold">
          {isPending
            ? "Loading today’s tasks…"
            : !live
              ? "Live tasks appear here"
              : hasData
                ? "You’re all caught up"
                : "Upload your files to see tasks"}
        </h2>
        {!isPending && (
          <p className="mt-1 text-sm opacity-85">
            {!live
              ? "Live data appears when the service is connected."
              : hasData
                ? "No tasks left for today. Ask the agent below what to do next."
                : "Add your donor files with the + below and Donor Desk lines up today’s tasks."}
          </p>
        )}
      </section>
    );

  const askToDraft = () => {
    onAction?.();
    session.setDraft(`Draft an email for: ${task.title}`);
    session.openPane("ask");
  };

  return (
    <section
      data-tour="chat"
      aria-labelledby={headingId}
      className={"home-task-content"}
    >
      <p className="text-[11px] tracking-[0.08em] uppercase opacity-75">
        Task {index + 1} of {total} · {kindLabel(task.kind)}
        {task.source === "agent" ? " · Added by agent" : ""}
      </p>
      <h2 id={headingId} className="mt-1 mb-1.5 text-lg leading-snug font-bold">
        {task.title}
      </h2>
      {task.why && <p className="mb-3 text-sm opacity-85">{task.why}</p>}
      {task.chips.length > 0 && (
        <ul className="mb-3.5 flex flex-wrap gap-1.5" aria-label="Facts">
          {task.chips.map((fact) => (
            <li
              key={fact}
              className="rounded-full border border-current/25 px-2.5 py-0.5 text-xs"
            >
              {fact}
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap gap-2">
        {onWork && (
          <button
            type="button"
            onClick={() => onWork(task)}
            className={cn(
              pill,
              "bg-brand text-brand-foreground hover:bg-brand/85",
            )}
          >
            <Sparkles className="size-4" aria-hidden="true" />
            Work on it with the agent
          </button>
        )}
        {task.kind !== "review" && task.kind !== "prep" && (
          <button
            type="button"
            onClick={() => {
              onAction?.();
              session.openPane("voice");
            }}
            className={cn(
              pill,
              "bg-brand text-brand-foreground hover:bg-brand/85",
            )}
          >
            <AudioLines className="size-4" aria-hidden="true" />
            Call and transcribe
          </button>
        )}
        {task.kind === "review" ? (
          <Link
            to="/inbox"
            onClick={onAction}
            className={cn(
              pill,
              "bg-brand text-brand-foreground hover:bg-brand/85",
            )}
          >
            <Mail className="size-4" aria-hidden="true" />
            <span>Review duplicates</span>
          </Link>
        ) : draftHref ? (
          <Link
            to={draftHref}
            onClick={onAction}
            className={cn(pill, "bg-surface hover:bg-accent")}
          >
            <Mail className="size-4" aria-hidden="true" />
            <span>Draft email</span>
          </Link>
        ) : (
          <button
            type="button"
            onClick={askToDraft}
            className={cn(pill, "bg-surface hover:bg-accent")}
          >
            <Mail className="size-4" aria-hidden="true" />
            Draft email
          </button>
        )}
        <button
          type="button"
          onClick={() => onDone(task)}
          className={cn(pill, "bg-surface hover:bg-accent")}
        >
          <Check className="size-4" aria-hidden="true" />
          Mark done
        </button>
      </div>
    </section>
  );
};

/* ---------- Agent thread ---------- */

const AgentMessage = ({ answer }: { answer: AskAnswer }) => {
  const session = useAskSession();
  const summary = answerSummary(answer);
  return (
    <div className="home-agent-message">
      <span className="mb-0.5 block text-[11px] font-bold text-muted-foreground">
        Agent
      </span>
      <p>{summary.headline}</p>
      {summary.detail && (
        <p className="mt-0.5 text-xs text-muted-foreground">{summary.detail}</p>
      )}
      {summary.rows.length > 0 && (
        <ul className="mt-1.5 list-disc pl-[18px]">
          {summary.rows.map((row) => (
            <li key={row.id}>
              {row.name} · {row.detail}
            </li>
          ))}
        </ul>
      )}
      <button
        type="button"
        onClick={() => session.openPane("ask")}
        className={cn(
          "mt-2 inline-flex min-h-8 items-center gap-1 rounded-sm text-[13px] font-semibold underline underline-offset-3 hover:decoration-2",
          focusRing,
        )}
      >
        {summary.more > 0
          ? `Open all ${summary.rows.length + summary.more} in Ask`
          : "Open in Ask"}
        <ArrowRight className="size-3.5" aria-hidden="true" />
      </button>
    </div>
  );
};

const UserMessage = ({ text }: { text: string }) => (
  <p className="home-user-message">
    <span className="sr-only">You: </span>
    {text}
  </p>
);

/** On the laptop API the Home chat is the main-UI agent (B10): steps as cards, Undo, approval cards. */
const LIVE_AGENT = DATA_MODE === "local";

const LiveAgentThread = ({ intro }: { intro?: ReactNode }) => {
  const { messages, pending, error } = useAgentChat();
  const refetch = useAgentRefetch();
  const endRef = useRef<HTMLDivElement>(null);
  const last = messages[messages.length - 1];
  // While a reply streams in, its own step cards and text show the progress; "Thinking…" covers the wait before
  const streamingShown =
    last?.role === "assistant" && Boolean(last.streaming) && (last.steps.length > 0 || last.text !== "");
  const progress = last?.role === "assistant" ? `${last.steps.length}:${last.text.length}` : "";

  useEffect(() => {
    // Nothing said yet: stay at the top so an opening briefing is read from its first line.
    if (messages.length === 0 && !pending) return;
    endRef.current?.scrollIntoView?.({ block: "nearest" });
  }, [messages.length, pending, progress]);

  return (
    <div
      role="log"
      aria-label="Conversation with the agent"
      className="flex min-h-[120px] flex-1 flex-col gap-3 overflow-y-auto px-[22px] py-4"
    >
      {intro}
      {!intro && messages.length === 0 && !pending && (
        <p className="m-auto max-w-sm text-center text-sm text-muted-foreground">
          Ask about donors, plan outreach, or add to the calendar.
        </p>
      )}
      {messages.map((m, i) =>
        m.role === "user" ? (
          <UserMessage key={i} text={m.text} />
        ) : (
          <div
            key={i}
            className="flex min-w-0 max-w-full flex-col gap-2 self-start rounded-2xl sm:max-w-[78%] rounded-bl-[4px] bg-surface px-3.5 py-2.5 text-sm"
          >
            <span className="block text-[11px] font-bold text-muted-foreground">Agent</span>
            {m.steps.length > 0 && (
              <ul aria-label="Steps" className="flex flex-col gap-1.5">
                {m.steps.map((step, j) => (
                  <StepCard key={`${i}-${j}`} step={step} onUndo={() => undoStep(i, j, refetch)} />
                ))}
              </ul>
            )}
            {m.approvals.map((a) => (
              <ApprovalCard
                key={a.call_id}
                approval={a}
                decided={Boolean(m.handled) || m.decisions?.[a.call_id] !== undefined}
                decision={m.decisions?.[a.call_id]}
                handled={m.handled}
                disabled={pending}
                onDecide={(approve) => decide(i, { [a.call_id]: approve }, refetch)}
              />
            ))}
            {m.text && (
              // every change in this reply undone: grey the prose so "Added …" can't read as still true
              <div className={cn(undoneSummary(m.steps).all && "opacity-55")} data-undone={undoneSummary(m.steps).all || undefined}>
                <Markdown className="[&_p]:my-2 [&_table]:my-2 [&_table]:block [&_table]:max-w-full [&_table]:overflow-x-auto [&_table]:text-xs [&_th]:border [&_th]:border-border [&_th]:!px-2 [&_th]:!py-1 [&_td]:!px-2 [&_td]:!py-1">{m.text}</Markdown>
              </div>
            )}
            <UndoneNote steps={m.steps} />
          </div>
        ),
      )}
      {pending && !streamingShown && (
        <p className="self-start rounded-2xl bg-surface px-3.5 py-2.5 text-sm text-muted-foreground">
          Thinking…
        </p>
      )}
      {error && !pending && (
        <p role="alert" className="self-start text-sm text-alert-foreground">
          The agent couldn’t answer: {error}
        </p>
      )}
      <div ref={endRef} />
    </div>
  );
};

/** `intro` (the daily briefing) opens the thread and replaces the empty placeholder. */
export const AgentThread = ({ intro }: { intro?: ReactNode }) =>
  LIVE_AGENT ? <LiveAgentThread intro={intro} /> : <AskThread intro={intro} />;

const AskThread = ({ intro }: { intro?: ReactNode }) => {
  const session = useAskSession();
  const { answer, pending, error } = session;
  const [history, setHistory] = useState<AskAnswer[]>(() =>
    appendAnswer([], answer),
  );
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setHistory((h) => appendAnswer(h, answer));
  }, [answer]);

  useEffect(() => {
    if (history.length === 0 && !pending) return; // keep an opening briefing at its top
    endRef.current?.scrollIntoView?.({ block: "nearest" });
  }, [history.length, pending]);

  const asking = pending ? session.draft : null;
  const showAsking = asking && history[history.length - 1]?.question !== asking;

  return (
    <div
      role="log"
      aria-label="Conversation with the agent"
      className="home-thread"
    >
      {intro}
      {!intro && history.length === 0 && !pending && (
        <p className="m-auto max-w-sm text-center text-sm text-muted-foreground">
          Ask about donors, plan outreach, or add to the calendar.
        </p>
      )}
      {history.map((entry, i) => (
        <div key={`${i}-${entry.question}`} className="flex flex-col gap-3">
          <UserMessage text={entry.question} />
          <AgentMessage answer={entry} />
        </div>
      ))}
      {showAsking && <UserMessage text={asking} />}
      {pending && (
        <p className="self-start rounded-2xl bg-surface px-3.5 py-2.5 text-sm text-muted-foreground">
          Thinking…
        </p>
      )}
      {error && !pending && (
        <p role="alert" className="self-start text-sm text-alert-foreground">
          The agent couldn’t answer: {error.message}
        </p>
      )}
      <div ref={endRef} />
    </div>
  );
};

/* ---------- Composer ---------- */

/** Generic example questions, used until GET /home/summary has chips for this data. */
export const SUGGESTIONS = EXAMPLE_QUESTIONS.slice(1, 4);

export const Composer = ({
  onUploadList,
  suggestions = SUGGESTIONS,
}: {
  onUploadList: () => void;
  /** GET /home/summary.suggestions. */
  suggestions?: string[];
}) => {
  const session = useAskSession();
  const agent = useAgentChat();
  const refetch = useAgentRefetch();
  const navigate = useNavigate();
  const [text, setText] = useState("");
  const inputId = useId();
  const [bloomId, setBloomId] = useState(0);
  const busy = LIVE_AGENT ? agent.pending : session.pending;
  const dictation = useDictationInput(text, setText);
  // Alt+V (useWorkspaceHotkeys) toggles the mic like a click on it.
  const dictationRef = useRef(dictation);
  dictationRef.current = dictation;
  useEffect(() => {
    const onToggle = () => {
      if (dictationRef.current.available) dictationRef.current.toggle();
    };
    window.addEventListener(DICTATION_TOGGLE_EVENT, onToggle);
    return () => window.removeEventListener(DICTATION_TOGGLE_EVENT, onToggle);
  }, []);

  const send = (question: string) => {
    const q = question.trim();
    if (!q || busy) return;
    dictation.halt();
    if (LIVE_AGENT) void sendToAgent(q, refetch);
    else session.submit(q);
    setText("");
  };
  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    send(text);
  };

  return (
    <div data-tour="composer" className="home-composer">
      <ul aria-label="Suggestions" className="mb-2.5 flex flex-wrap gap-2">
        {suggestions.map((question) => (
          <li key={question} className="max-w-full">
            <button
              type="button"
              onClick={() => send(question)}
              disabled={busy}
              className={cn(
                "inline-flex min-h-8 max-w-full items-center gap-1.5 rounded-full bg-surface px-3 py-1.5 text-left text-xs hover:bg-accent disabled:opacity-60",
                focusRing,
              )}
            >
              {question}
            </button>
          </li>
        ))}
      </ul>
      <form onSubmit={onSubmit} className="home-composer-input">
        <span
          key={bloomId}
          aria-hidden="true"
          className={bloomId ? "home-composer-bloom" : "hidden"}
        />
        <DropdownMenu>
          <DropdownMenuTrigger
            aria-label="Add"
            title="Add"
            className={cn(
              "grid size-9 shrink-0 place-items-center rounded-full hover:bg-surface",
              focusRing,
            )}
          >
            <Plus className="size-5" aria-hidden="true" />
          </DropdownMenuTrigger>
          <DropdownMenuContent side="top" align="start" className="min-w-52">
            <DropdownMenuItem disabled className="min-h-10">
              <Paperclip aria-hidden="true" />
              Attach a file
              <span className="ml-auto text-xs text-muted-foreground">
                Soon
              </span>
            </DropdownMenuItem>
            <DropdownMenuItem
              className="min-h-10"
              onClick={() => navigate("/calendar")}
            >
              <CalendarPlus aria-hidden="true" />
              Add an event
            </DropdownMenuItem>
            <DropdownMenuItem className="min-h-10" onClick={onUploadList}>
              <Upload aria-hidden="true" />
              Upload a donor list
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <label htmlFor={inputId} className="sr-only">
          Ask the agent
        </label>
        <input
          id={inputId}
          data-hotkeys="composer"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={dictation.interim || "Ask the agent…"}
          autoComplete="off"
          className="min-w-0 flex-1 bg-transparent px-1.5 py-2 text-sm outline-none placeholder:text-muted-foreground"
        />
        <DictationButton
          state={dictation.state}
          error={dictation.error}
          available={dictation.available}
          onToggle={dictation.toggle}
          className={focusRing}
        />
        <button
          type="submit"
          onClick={(event) => {
            if (
              text.trim() &&
              !busy &&
              (event.detail > 0 ||
                document.activeElement === event.currentTarget)
            )
              setBloomId((id) => id + 1);
          }}
          aria-label="Send"
          title="Send"
          disabled={busy || !text.trim()}
          className={cn(
            "grid size-9 shrink-0 place-items-center rounded-full border border-[#2427280e] bg-white text-[#242728] hover:bg-[#f5f6f7] disabled:opacity-50",
            focusRing,
          )}
        >
          <ArrowRight className="size-5" aria-hidden="true" />
        </button>
      </form>
      <DictationHint error={dictation.error} listening={dictation.state === "listening"} interim={dictation.interim} className="px-2" />
    </div>
  );
};
