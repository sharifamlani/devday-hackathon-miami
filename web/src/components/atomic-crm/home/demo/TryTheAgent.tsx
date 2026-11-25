import { useId } from "react";
import { ArrowRight } from "lucide-react";

import { cn } from "@/lib/utils";
import { useAskSession } from "../../ask/askSessionContext";
import { DATA_MODE } from "../../providers/local/config";
import { useAgentRefetch } from "../../providers/local/refetch";
import { sendToAgent, useAgentChat } from "../agentChat";
import { focusRing } from "../tile";
import { playDemo, useDemoRuns } from "./demoRun";
import { SCENARIOS } from "./scenarios";

const action = cn(
  "inline-flex min-h-8 shrink-0 items-center gap-1 rounded-full bg-surface px-3 text-xs font-semibold hover:bg-accent disabled:opacity-60",
  focusRing,
);

/**
 * Four things to ask the agent, under "Here's your day". On the laptop each sends its prompt to the live
 * agent; in the public build (no agent service) each plays a labeled sample run with the same cards.
 */
export const TryTheAgent = () => {
  const live = DATA_MODE === "local";
  const agent = useAgentChat();
  const session = useAskSession();
  const demo = useDemoRuns();
  const refetch = useAgentRefetch();
  const baseId = useId();
  const busy = live ? agent.pending : demo.playing || session.pending;

  return (
    <div className="home-agent-message w-full" aria-label="Try the agent">
      <p className="flex items-center gap-2 font-semibold">
        <span>Try the agent</span>
        {!live && (
          <span className="rounded-full bg-surface px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
            Sample run
          </span>
        )}
      </p>
      <ul className="mt-2 flex flex-col gap-1.5">
        {SCENARIOS.map((s, i) => (
          <li
            key={s.id}
            style={{ animationDelay: `calc(${i + 5} * 0.25 * var(--motion-base))` }}
            className="motion-enter flex flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-xl border border-border px-3 py-2"
          >
            <span id={`${baseId}-${s.id}`} className="min-w-[min(100%,13rem)] flex-1">
              {s.text}
            </span>
            <button
              type="button"
              data-testid={`try-${s.id}`}
              aria-describedby={`${baseId}-${s.id}`}
              disabled={busy}
              onClick={() => (live ? void sendToAgent(s.prompt, refetch) : void playDemo(s.id, s.text))}
              className={action}
            >
              {s.button}
              <ArrowRight className="size-3.5" aria-hidden="true" />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
};
