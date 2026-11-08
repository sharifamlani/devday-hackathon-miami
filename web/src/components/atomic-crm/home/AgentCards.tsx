import { useState } from "react";
import { Check, CircleAlert, Clock, Loader2, Mail, Phone, Undo2, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { AgentApproval, AgentStep, MergedPair } from "./agentChat";
import { DATA_MODE } from "../providers/local/config";
import { PhoneCallInline } from "../voice/PhoneCallDialog";
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
  merge_duplicate: { yes: "Merge", no: "Keep separate" },
};
const DEFAULT_BUTTONS = { yes: "Approve", no: "Decline" };

/** A decided card's title: a merge reads Merged / Kept separate; anything else Approved / Declined. */
const decidedTitle = (tool: string, approved: boolean) =>
  tool === "merge_duplicate" ? (approved ? "Merged" : "Kept separate") : approved ? "Approved" : "Declined";

const chip = cn(
  "inline-flex min-h-8 items-center gap-1 rounded-full px-3 text-[13px] font-semibold transition-colors",
  focusRing,
);

type Gift = { date: string; amount: number };
export type CallSheet = {
  kind: "call_sheet";
  person_id: number;
  name: string;
  org_name?: string | null;
  location?: string | null;
  has_phone: boolean;
  /** The full number (Sharif, rule 15). */
  phone: string | null;
  relationship: {
    gift_count: number;
    total: number;
    first_gift: Gift | null;
    last_gift: Gift | null;
    usual_channel: string | null;
  };
  declined_charges: { date: string; amount: number; status: string }[];
  interests: string[];
  recent_calls: { date: string; title: string; summary: string[]; next_steps: string[] }[];
  open_tasks: { id: number; title: string; due: string | null }[];
  facts: { fact: string; source_url: string }[];
  talking_points: string[];
};

const usd = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: Number.isInteger(n) ? 0 : 2 });

const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <div className="mt-2">
    <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{title}</p>
    {children}
  </div>
);

/** The agent's call sheet: who they are, their giving, and what to say, with the Call button (or why there is none). */
export const CallSheetCard = ({ sheet }: { sheet: CallSheet }) => {
  const r = sheet.relationship;
  // The call runs inside this card, not in a dialog over the page (Sharif). Local mode only: the laptop places it.
  const [calling, setCalling] = useState(false);
  const canCall = sheet.has_phone && DATA_MODE === "local";
  return (
    <li data-testid="call-sheet" className="rounded-xl border border-border bg-card px-3 py-2 text-[13px]">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="font-semibold">Call sheet: {sheet.name}</p>
          <p className="text-muted-foreground">
            {[sheet.org_name, sheet.location].filter(Boolean).join(" · ")}
          </p>
          <p data-testid="call-sheet-phone" className="mt-0.5">
            {sheet.has_phone ? `Phone ${sheet.phone}` : "No phone number on file"}
          </p>
        </div>
        {canCall && !calling && (
          <Button size="sm" className="rounded-full" onClick={() => setCalling(true)}>
            <Phone aria-hidden />
            Call
          </Button>
        )}
      </div>
      {calling && <PhoneCallInline donorId={sheet.person_id} onClose={() => setCalling(false)} />}
      <Section title="Giving">
        {r.gift_count === 0 ? (
          <p>No gifts on record.</p>
        ) : (
          <p>
            {usd(r.total)} across {r.gift_count} gift{r.gift_count === 1 ? "" : "s"}
            {r.usual_channel ? `, usually ${r.usual_channel}` : ""}. First {r.first_gift && `${usd(r.first_gift.amount)} on ${r.first_gift.date}`}
            ; last {r.last_gift && `${usd(r.last_gift.amount)} on ${r.last_gift.date}`}.
          </p>
        )}
        {sheet.declined_charges.map((d) => (
          <p key={d.date} className="text-alert-foreground">
            Not a gift: {usd(d.amount)} charge on {d.date} was {d.status}.
          </p>
        ))}
      </Section>
      {sheet.interests.length > 0 && (
        <Section title="Interests">
          <p>{sheet.interests.join(", ")}</p>
        </Section>
      )}
      {sheet.recent_calls.length > 0 && (
        <Section title="Recent calls">
          {sheet.recent_calls.map((c) => (
            <p key={c.date + c.title}>
              {c.date}: {c.summary[0] ?? c.title}
            </p>
          ))}
        </Section>
      )}
      {sheet.open_tasks.length > 0 && (
        <Section title="Open tasks">
          {sheet.open_tasks.map((t) => (
            <p key={t.id}>
              {t.title}
              {t.due ? ` (due ${t.due})` : ""}
            </p>
          ))}
        </Section>
      )}
      {sheet.facts.length > 0 && (
        <Section title="Research">
          {sheet.facts.map((f) => (
            <p key={f.source_url + f.fact}>
              {f.fact}{" "}
              <a href={f.source_url} target="_blank" rel="noreferrer" className="underline">
                source
              </a>
            </p>
          ))}
        </Section>
      )}
      <Section title="Talking points">
        <ul className="list-disc pl-4">
          {sheet.talking_points.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>
      </Section>
    </li>
  );
};

/** The pairs the agent merged by itself (80%+): each with its score, evidence and its own Undo. */
const MergedPairs = ({ pairs, onUndoPair }: { pairs: MergedPair[]; onUndoPair?: (k: number) => void }) => (
  <ul aria-label="Merged pairs" className="mt-1.5 flex flex-col gap-1">
    {pairs.map((p, k) => (
      <li key={p.suggestion_id} className={cn("flex flex-wrap items-start gap-x-2 gap-y-1", p.undone && "opacity-60")}>
        <div className="min-w-0 flex-1 basis-40">
          <p className="font-medium">
            {`${p.merged_in} → ${p.kept} `}
            <span className="font-normal text-muted-foreground">{`· ${Math.round(p.confidence * 100)}% match`}</span>
          </p>
          <p className="text-muted-foreground">{p.undone ? "Undone · back in the review list" : p.evidence}</p>
        </div>
        {p.undo_token && !p.undone && onUndoPair && (
          <button
            type="button"
            onClick={() => onUndoPair(k)}
            aria-label={`Undo merge of ${p.merged_in} and ${p.kept}`}
            className={cn(chip, "ml-auto bg-current/10 hover:bg-current/20")}
          >
            <Undo2 className="size-3.5" aria-hidden="true" />
            Undo
          </button>
        )}
      </li>
    ))}
  </ul>
);

export type EmailPrep = {
  kind: "email_prep";
  topic: string;
  person_ids: number[];
  audience: { count: number; names: string[] };
  last_time: { name: string; intent: string; channel: string; date: string; sent: number; messages: number } | null;
  since: { fact: string; url: string; date: string | null }[];
  coming_up: { title: string; date: string }[];
  angle: string;
  /** "What we did since" only when the facts are newer than the last email (else "Nothing new since …"). */
  facts_label?: string;
};

/** Email prep (Sharif): what we sent before, what we did since (X, Y, Z, sourced), what's next, then Draft. */
export const EmailPrepCard = ({ prep, onAsk }: { prep: EmailPrep; onAsk?: (text: string) => void }) => {
  const n = prep.audience.count;
  const who = prep.audience.names.join(", ") + (n > prep.audience.names.length ? ` +${n - prep.audience.names.length} more` : "");
  return (
    <li data-testid="email-prep" className="rounded-xl border border-border bg-card px-3 py-2 text-[13px]">
      <p className="font-semibold">
        Email prep: {prep.topic} · {n} {n === 1 ? "person" : "people"}
      </p>
      {who && <p className="text-muted-foreground">{who}</p>}
      <Section title="Last time">
        <p>
          {prep.last_time
            ? `${prep.last_time.date} · ${prep.last_time.name} · ${prep.last_time.sent} sent`
            : `No email to ${n === 1 ? "this person" : "these people"} on record yet.`}
        </p>
      </Section>
      <Section title={prep.facts_label ?? (prep.last_time ? "What we did since" : "What we've been doing")}>
        {prep.since.length === 0 ? (
          <p>No sourced updates on file.</p>
        ) : (
          <ul className="space-y-0.5">
            {prep.since.map((f, i) => (
              <li key={f.url + i}>
                <span className="font-semibold">{String.fromCharCode(88 + i)}</span> {f.fact}{" "}
                <a href={f.url} target="_blank" rel="noreferrer" className="underline">
                  {f.date ?? "source"}
                </a>
              </li>
            ))}
          </ul>
        )}
      </Section>
      {prep.coming_up.length > 0 && (
        <Section title="Coming up">
          <p>{prep.coming_up.map((e) => `${e.title} (${e.date})`).join(" · ")}</p>
        </Section>
      )}
      <Section title="The angle">
        <p>{prep.angle}</p>
      </Section>
      {onAsk && n > 0 && (
        <div className="mt-2 flex justify-end">
          <Button
            size="sm"
            className="rounded-full"
            onClick={() =>
              onAsk(
                `Draft the ${prep.topic} email for ${n === 1 ? "this person" : `these ${n} people`} ` +
                  `(ids ${prep.person_ids.join(", ")}) using only the email prep's facts ` +
                  (prep.since.length ? `(fact_urls: ${prep.since.map((f) => f.url).join(", ")})` : "(none: a thank-you)") +
                  `, then show me the Send card. Don't send until I approve it.`,
              )
            }
          >
            <Mail aria-hidden />
            Draft {n} email{n === 1 ? "" : "s"}
          </Button>
        </div>
      )}
    </li>
  );
};

export const StepCard = ({
  step,
  onUndo,
  onUndoPair,
  onAsk,
}: {
  step: AgentStep;
  onUndo?: () => void;
  onUndoPair?: (pairIndex: number) => void;
  /** Send a follow-up to the agent (e.g. the email prep's Draft button). */
  onAsk?: (text: string) => void;
}) => {
  if (step.card?.kind === "call_sheet") return <CallSheetCard sheet={step.card as unknown as CallSheet} />;
  if (step.card?.kind === "email_prep") return <EmailPrepCard prep={step.card as unknown as EmailPrep} onAsk={onAsk} />;
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
        "flex flex-wrap items-start gap-x-2 gap-y-1 rounded-xl border border-border bg-card px-3 py-2 text-[13px]",
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
      <div className="min-w-0 flex-1 basis-40">
        <p className="font-semibold">{toolLabel(step.tool)}</p>
        {step.summary && <p className="text-muted-foreground">{step.undone ? `Undone · ${step.summary}` : step.summary}</p>}
        {step.card?.kind === "merged_pairs" && (
          <MergedPairs pairs={(step.card as { pairs: MergedPair[] }).pairs} onUndoPair={onUndoPair} />
        )}
      </div>
      {step.undo_token && !step.undone && onUndo && (
        <button type="button" onClick={onUndo} className={cn(chip, "ml-auto bg-current/10 hover:bg-current/20")}>
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
      {handled ?? (!decided ? "Needs your approval" : decidedTitle(approval.tool, Boolean(decision)))}
      {/* the summary already says what ("Send thank-you email to …"); the bare tool name only without one */}
      {!approval.summary && `: ${toolLabel(approval.tool)}`}
    </p>
    {(approval.summary || argLine(approval.args)) && (
      <p className="mt-0.5 text-muted-foreground">{approval.summary || argLine(approval.args)}</p>
    )}
    {approval.preview?.map((m, i) => (
      <div key={i} data-testid="send-preview" className="mt-2 rounded-lg border border-border bg-background p-2.5">
        <p className="text-xs text-muted-foreground">To {m.to}</p>
        {m.subject && <p className="mt-0.5 font-semibold">{m.subject}</p>}
        <p className="mt-1 max-h-56 overflow-y-auto whitespace-pre-wrap">{m.body}</p>
      </div>
    ))}
    {!decided && (
      <div className="mt-2 flex flex-wrap gap-2">
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
