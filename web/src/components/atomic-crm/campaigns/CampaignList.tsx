import { Plus } from "lucide-react";
import { Link } from "react-router";

import { buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { useCampaigns } from "../providers/local/hooks";
import { formatStamp, intentLabel, pillButton } from "./campaignFormat";
import { ChannelLabel, LinkPill, PageShell, SimulatedNote } from "./campaignUi";

/** /campaigns: every campaign with its approval progress. */
export const CampaignList = () => {
  const { data: campaigns, isPending, error } = useCampaigns();

  return (
    <PageShell
      eyebrow="CAMPAIGNS"
      title="Bulk emails and texts, approved by a person"
      caption="One personal draft per donor. Star, big and organization donors are always approved one by one."
      actions={
        <>
          <LinkPill to="/outbox">Outbox</LinkPill>
          <Link
            to="/campaigns/new"
            className={cn(
              buttonVariants(),
              pillButton,
              "bg-brand text-brand-foreground hover:bg-brand/85",
            )}
          >
            <Plus aria-hidden />
            New campaign
          </Link>
        </>
      }
    >
      <SimulatedNote className="rounded-[18px] bg-card p-4" />
      {isPending ? (
        <Skeleton className="h-32 w-full rounded-[22px]" />
      ) : error ? (
        <p role="alert" className="text-sm text-destructive">
          {error.message}
        </p>
      ) : !campaigns?.length ? (
        <p className="rounded-[22px] bg-card p-5 text-sm text-muted-foreground">
          No campaigns yet. Start one here, or from the Ask and Targets screens.
        </p>
      ) : (
        <ul className="space-y-3" aria-label="Campaigns">
          {campaigns.map((c) => (
            <li key={c.id}>
              <Link
                to={`/campaigns/${c.id}`}
                className="block space-y-1.5 rounded-[22px] bg-card p-5 transition-colors hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              >
                <span className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-sm font-semibold [overflow-wrap:anywhere]">
                    {c.name}
                  </span>
                  <span
                    className={cn(
                      "rounded-full px-2.5 py-0.5 text-[11px] font-semibold",
                      c.status === "sent"
                        ? "bg-good text-good-foreground"
                        : "bg-brand-soft text-brand-soft-foreground",
                    )}
                  >
                    {c.status === "sent" ? "Sent (simulated)" : "In review"}
                  </span>
                </span>
                <span className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                  <span>{intentLabel(c.intent)}</span>
                  <ChannelLabel channel={c.channel} />
                  <span>{formatStamp(c.created_at)}</span>
                  <span>
                    {c.counts.total} messages · {c.counts.approved} approved ·{" "}
                    {c.counts.sent} sent
                    {c.counts.needs_individual_approval
                      ? ` · ${c.counts.needs_individual_approval} need individual approval`
                      : ""}
                    {c.counts.flagged ? ` · ${c.counts.flagged} flagged` : ""}
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </PageShell>
  );
};
