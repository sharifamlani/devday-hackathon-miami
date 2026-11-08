import { useId } from "react";
import { ArrowRight } from "lucide-react";
import { Link } from "react-router";

import { cn } from "@/lib/utils";
import { useAskSession } from "../ask/askSessionContext";
import { DATA_MODE } from "../providers/local/config";
import { useAgentRefetch } from "../providers/local/refetch";
import { sendToAgent, useAgentChat } from "./agentChat";
import type { Briefing, BriefingAction } from "./briefing";
import { focusRing } from "./tile";
import { openWorkspace } from "./workspaceView";
import { focusCalendarOn } from "../calendar/calendarFocus";

const action = cn(
  "inline-flex min-h-8 shrink-0 items-center gap-1 rounded-full bg-surface px-3 text-xs font-semibold hover:bg-accent disabled:opacity-60",
  focusRing,
);

/** The empty home chat's first agent message: today's briefing with one tap per line. */
export const DailyBriefing = ({
  briefing,
  onStartTask,
}: {
  briefing: Briefing;
  /** A task line's Start: hands the task to the agent (live) or opens its details. */
  onStartTask: (taskKey: string) => void;
}) => {
  const session = useAskSession();
  const agent = useAgentChat();
  const refetch = useAgentRefetch();
  const live = DATA_MODE === "local";
  const busy = live ? agent.pending : session.pending;
  const baseId = useId();

  const run = (a: BriefingAction, el: HTMLElement) => {
    if (a.kind === "task") onStartTask(a.taskKey);
    else if (a.kind === "ask") {
      if (live) void sendToAgent(a.question, refetch);
      else session.submit(a.question);
    } else if (a.kind === "panel") {
      if (a.date) focusCalendarOn(a.date);
      openWorkspace(a.view, el);
    }
  };

  return (
    <div className="home-agent-message w-full" aria-label="Today’s briefing">
      <span className="mb-0.5 block text-[11px] font-bold text-muted-foreground">
        Agent
      </span>
      <p className="font-semibold">{briefing.headline}</p>
      {briefing.lines.length === 0 ? (
        <p className="mt-0.5 text-muted-foreground">
          Ask below about donors, outreach or the calendar.
        </p>
      ) : (
        <ul className="mt-2 flex flex-col gap-1.5">
          {briefing.lines.map((line) => (
            <li
              key={line.key}
              className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-xl border border-border px-3 py-2"
            >
              <span
                id={`${baseId}-${line.key}`}
                className="min-w-[min(100%,13rem)] flex-1"
              >
                {line.text}
              </span>
              {line.action?.kind === "link" ? (
                <Link
                  to={line.action.to}
                  aria-describedby={`${baseId}-${line.key}`}
                  className={action}
                >
                  {line.action.label}
                  <ArrowRight className="size-3.5" aria-hidden="true" />
                </Link>
              ) : line.action ? (
                <button
                  type="button"
                  aria-describedby={`${baseId}-${line.key}`}
                  disabled={busy && line.action.kind !== "panel"}
                  onClick={(e) => run(line.action!, e.currentTarget)}
                  className={action}
                >
                  {line.action.label}
                  <ArrowRight className="size-3.5" aria-hidden="true" />
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};
