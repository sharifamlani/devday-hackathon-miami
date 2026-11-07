import { Link } from "react-router";

import { Skeleton } from "@/components/ui/skeleton";
import { useOutbox } from "../providers/local/hooks";
import { formatStamp } from "./campaignFormat";
import { ChannelLabel, LinkPill, PageShell, SimulatedNote } from "./campaignUi";

/** /outbox: the simulated outbox, which is also the contact log (who, when, which channel). */
export const OutboxList = () => {
  const { data: entries, isPending, error } = useOutbox();

  return (
    <PageShell
      eyebrow="SIMULATED OUTBOX · CONTACT LOG"
      title="Outbox"
      caption="Every approved campaign message, with who it was for, when, and by which channel. Nothing here was delivered."
      actions={<LinkPill to="/campaigns">Campaigns</LinkPill>}
    >
      <SimulatedNote className="rounded-[18px] bg-card p-4" />
      {isPending ? (
        <Skeleton className="h-32 w-full rounded-[22px]" />
      ) : error ? (
        <p role="alert" className="text-sm text-destructive">
          {error.message}
        </p>
      ) : !entries?.length ? (
        <p className="rounded-[22px] bg-card p-5 text-sm text-muted-foreground">
          The outbox is empty. Approve messages in a campaign, then choose “Send
          to outbox (simulated)”.
        </p>
      ) : (
        <ul className="space-y-3" aria-label="Outbox messages">
          {entries.map((entry) => (
            <li key={entry.id} className="space-y-2 rounded-[22px] bg-card p-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-semibold [overflow-wrap:anywhere]">
                  {entry.donor_name ?? "Removed donor"}
                </p>
                <span className="rounded-full bg-quiet px-2.5 py-0.5 text-[11px] font-semibold text-quiet-foreground">
                  Simulated · not delivered
                </span>
              </div>
              <dl className="grid gap-x-4 gap-y-1 text-xs text-muted-foreground sm:grid-cols-4">
                <div>
                  <dt className="sr-only">Channel</dt>
                  <dd>
                    <ChannelLabel channel={entry.channel} />
                  </dd>
                </div>
                <div>
                  <dt className="inline">To: </dt>
                  <dd className="inline">{entry.to ?? "—"}</dd>
                </div>
                <div>
                  <dt className="inline">When: </dt>
                  <dd className="inline">
                    <time dateTime={entry.sent_at}>
                      {formatStamp(entry.sent_at)}
                    </time>
                  </dd>
                </div>
                <div>
                  <dt className="inline">Campaign: </dt>
                  <dd className="inline">
                    {entry.campaign_id ? (
                      <Link
                        to={`/campaigns/${entry.campaign_id}`}
                        className="rounded-sm font-medium text-foreground underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-ring"
                      >
                        {entry.campaign_name ?? `#${entry.campaign_id}`}
                      </Link>
                    ) : (
                      "—"
                    )}
                  </dd>
                </div>
              </dl>
              <details className="rounded-[14px] bg-surface px-4 py-2.5 text-sm">
                <summary className="min-h-8 cursor-pointer rounded-sm font-medium [overflow-wrap:anywhere] focus-visible:outline-2 focus-visible:outline-ring">
                  {entry.subject ??
                    entry.body.slice(0, 80) +
                      (entry.body.length > 80 ? "…" : "")}
                </summary>
                <p className="mt-2 whitespace-pre-line leading-relaxed [overflow-wrap:anywhere]">
                  {entry.body}
                </p>
              </details>
            </li>
          ))}
        </ul>
      )}
    </PageShell>
  );
};
