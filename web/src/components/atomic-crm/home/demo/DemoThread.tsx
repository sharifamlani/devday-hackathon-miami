import { ApprovalCard, CallSheetCard, EmailPrepCard, StepCard } from "../AgentCards";
import { AgentReply, UserMessage } from "../Conversation";
import { DemoCall } from "./DemoCall";
import { decideDemo, followUpDemo, openDonor, visibleSteps, type DemoRun } from "./demoRun";
import { LookupCard } from "./LookupCard";
import type { DemoCard } from "./scenarios";

/** On every sample reply, so no one mistakes it for the live agent. */
export const SAMPLE_NOTE = "Sample run · nothing was searched, sent or dialed";

const Card = ({ run, card }: { run: DemoRun; card: DemoCard }) => {
  if (card.kind === "lookup")
    return (
      <LookupCard
        lookup={card.lookup}
        saved={run.extra.length > 0}
        onSave={() => followUpDemo(run.id)}
        onOpenProfile={() => openDonor(card.lookup.person_id)}
      />
    );
  if (card.kind === "email_prep") return <EmailPrepCard prep={card.prep} />;
  const call = card.call;
  return (
    <CallSheetCard
      sheet={card.sheet}
      title={card.title}
      callPanel={
        call ? () => <DemoCall name={card.sheet.name} script={call} onLogged={() => followUpDemo(run.id)} /> : undefined
      }
    />
  );
};

/** One "Try the agent" sample run: the user's line, then the agent's steps and cards (the live agent's own cards). */
export const DemoRunExchange = ({ run }: { run: DemoRun }) => {
  const script = run.script;
  return (
    <div data-testid="demo-run" data-done={run.done || undefined} className="home-exchange">
      <UserMessage text={run.question} />
      <AgentReply>
        <p
          data-testid="sample-note"
          className="mb-1.5 inline-flex rounded-full bg-surface px-2.5 py-0.5 text-[11px] font-medium text-muted-foreground"
        >
          {SAMPLE_NOTE}
        </p>
        {!script && !run.error && <p className="text-sm text-muted-foreground">Thinking…</p>}
        {run.error && (
          <p role="alert" className="text-sm text-alert-foreground">
            The sample couldn’t run: {run.error}
          </p>
        )}
        {script && (
          <ul aria-label="Steps" className="flex flex-col gap-1.5">
            {visibleSteps(run).map((s, i) => (
              <StepCard key={`${run.id}-${i}-${s.status}`} step={s} />
            ))}
            {run.done && script.cards.map((card, i) => <Card key={`${run.id}-card-${i}`} run={run} card={card} />)}
          </ul>
        )}
        {run.done && script?.approval && (
          <div className="mt-1.5">
            <ApprovalCard
              approval={script.approval.approval}
              decided={run.decision !== undefined}
              decision={run.decision}
              disabled={false}
              onDecide={(approve) => decideDemo(run.id, approve)}
            />
          </div>
        )}
        {run.extra.length > 0 && (
          <ul aria-label="Follow-up steps" className="mt-1.5 flex flex-col gap-1.5">
            {run.extra.map((s, i) => (
              <StepCard key={`${run.id}-extra-${i}`} step={s} />
            ))}
          </ul>
        )}
      </AgentReply>
    </div>
  );
};
