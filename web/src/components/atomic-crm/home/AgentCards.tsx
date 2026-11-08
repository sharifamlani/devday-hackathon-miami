import { Check, CircleAlert, Clock, Loader2, Undo2, X } from "lucide-react";

import { cn } from "@/lib/utils";
import type { AgentApproval, AgentStep } from "./agentChat";
import { focusRing } from "./tile";

/** "create_task" → "Create task". */
const toolLabel = (tool: string) => {
  const words = tool.replace(/_/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
};

/** The few arguments worth showing on an approval card. */
const argLine = (args: Record<string, unknown>) =>
  Object.entries(args)
    .filter(([, v]) => v !== null && v !== undefined && v !== "")
    .slice(0, 3)
    .map(([k, v]) => `${k.replace(/_/g, " ")}: ${Array.isArray(v) ? v.join(", ") : String(v)}`)
    .join(" · ");

/** What the card's two buttons say: a call or a send reads as that action, anything else as Approve. */
export const APPROVAL_BUTTONS: Record<string, { yes: string; no: string }> = {
  call_person: { yes: "Call", no: "Not now" },
  send: { yes: "Send", no: "Don't send" },
};
const DEFAULT_BUTTONS = { yes: "Approve", no: "Decline" };

const chip = cn(
  "inline-flex min-h-8 items-center gap-1 rounded-full px-3 text-[13px] font-semibold transition-colors",
  focusRing,
);

export const StepCard = ({ step, onUndo }: { step: AgentStep; onUndo?: () => void }) => {
  const Icon =
    step.status === "error"
      ? CircleAlert
      : step.status === "awaiting_approval"
        ? Clock
        : step.status === "running"
          ? Loader2
          : Check;
  return (
    <li
      data-testid="agent-step"
      className={cn(
        "flex items-start gap-2 rounded-xl border border-border bg-card px-3 py-2 text-[13px]",
        step.undone && "opacity-60",
      )}
    >
      <Icon
        className={cn(
          "mt-0.5 size-4 shrink-0",
          step.status === "error" ? "text-alert-foreground" : "text-muted-foreground",
          step.status === "running" && "animate-spin motion-reduce:animate-none",
        )}
        aria-hidden="true"
      />
      <div className="min-w-0 flex-1">
        <p className="font-semibold">{toolLabel(step.tool)}</p>
        {step.summary && <p className="text-muted-foreground">{step.undone ? `Undone · ${step.summary}` : step.summary}</p>}
      </div>
      {step.undo_token && !step.undone && onUndo && (
        <button type="button" onClick={onUndo} className={cn(chip, "bg-current/10 hover:bg-current/20")}>
          <Undo2 className="size-3.5" aria-hidden="true" />
          Undo
        </button>
      )}
    </li>
  );
};

export const ApprovalCard = ({
  approval,
  decided,
  decision,
  handled,
  disabled,
  onDecide,
}: {
  approval: AgentApproval;
  decided: boolean;
  /** The person's answer once decided (true = approved); undefined while it waits. */
  decision?: boolean;
  /** Set when deciding failed (run already consumed): the card is closed with this label. */
  handled?: string;
  disabled: boolean;
  onDecide: (approve: boolean) => void;
}) => {
  const buttons = APPROVAL_BUTTONS[approval.tool] ?? DEFAULT_BUTTONS;
  return (
  <div
    data-testid="agent-approval"
    role="group"
    aria-label={`Approve ${toolLabel(approval.tool)}`}
    data-decision={handled ? "handled" : decided ? (decision ? "approved" : "declined") : "pending"}
    className={cn(
      "rounded-xl border bg-card px-3 py-2.5 text-[13px]",
      decided ? "border-border opacity-75" : "border-brand/40",
    )}
  >
    <p className="font-semibold">
      {handled ?? (!decided ? "Needs your approval" : decision ? "Approved" : "Declined")}
      {/* the summary already says what ("Send thank-you email to …"); the bare tool name only without one */}
      {!approval.summary && `: ${toolLabel(approval.tool)}`}
    </p>
    {(approval.summary || argLine(approval.args)) && (
      <p className="mt-0.5 text-muted-foreground">{approval.summary || argLine(approval.args)}</p>
    )}
    {!decided && (
      <div className="mt-2 flex gap-2">
        <button
          type="button"
          disabled={disabled}
          onClick={() => onDecide(true)}
          className={cn(chip, "bg-brand text-brand-foreground hover:bg-brand/85 disabled:opacity-60")}
        >
          <Check className="size-3.5" aria-hidden="true" />
          {buttons.yes}
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={() => onDecide(false)}
          className={cn(chip, "bg-current/10 hover:bg-current/20 disabled:opacity-60")}
        >
          <X className="size-3.5" aria-hidden="true" />
          {buttons.no}
        </button>
      </div>
    )}
  </div>
  );
};

/** Which of a reply's changes were taken back with Undo, so the agent's prose can't read as still true. */
export const undoneSummary = (steps: AgentStep[]) => {
  const undoable = steps.filter((s) => s.undo_token);
  const undone = undoable.filter((s) => s.undone);
  return {
    any: undone.length > 0,
    all: undoable.length > 0 && undone.length === undoable.length,
    labels: undone.map((s) => (s.summary ? `${toolLabel(s.tool)} (${s.summary})` : toolLabel(s.tool))),
  };
};

/** Shown under the agent's reply once any of its changes is undone. */
export const UndoneNote = ({ steps }: { steps: AgentStep[] }) => {
  const u = undoneSummary(steps);
  if (!u.any) return null;
  return (
    <p data-testid="agent-undone-note" className="text-xs font-medium text-muted-foreground">
      {u.all ? "Undone: " : "Partly undone: "}
      {u.labels.join("; ")}
    </p>
  );
};
