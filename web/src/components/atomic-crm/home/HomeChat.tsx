import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import {
  ArrowRight,
  AudioLines,
  CalendarPlus,
  Check,
  Mail,
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

export const AgentThread = () => {
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
      {history.length === 0 && !pending && (
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
  const navigate = useNavigate();
  const [text, setText] = useState("");
  const inputId = useId();
  const [bloomId, setBloomId] = useState(0);

  const send = (question: string) => {
    const q = question.trim();
    if (!q || session.pending) return;
    session.submit(q);
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
              disabled={session.pending}
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
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Ask the agent…"
          autoComplete="off"
          className="min-w-0 flex-1 bg-transparent px-1.5 py-2 text-sm outline-none placeholder:text-muted-foreground"
        />
        <button
          type="button"
          onClick={() => session.openPane("voice")}
          aria-label="Start live transcript"
          title="Live transcript"
          className={cn(
            "grid size-9 shrink-0 place-items-center rounded-full text-[#242728] hover:bg-[#edf0f2]",
            focusRing,
          )}
        >
          <AudioLines className="size-5" aria-hidden="true" />
        </button>
        <button
          type="submit"
          onClick={(event) => {
            if (
              text.trim() &&
              !session.pending &&
              (event.detail > 0 ||
                document.activeElement === event.currentTarget)
            )
              setBloomId((id) => id + 1);
          }}
          aria-label="Send"
          title="Send"
          disabled={session.pending || !text.trim()}
          className={cn(
            "grid size-9 shrink-0 place-items-center rounded-full border border-[#2427280e] bg-white text-[#242728] hover:bg-[#f5f6f7] disabled:opacity-50",
            focusRing,
          )}
        >
          <ArrowRight className="size-5" aria-hidden="true" />
        </button>
      </form>
    </div>
  );
};
