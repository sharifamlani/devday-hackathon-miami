import { useState } from "react";
import { ListPlus, Megaphone } from "lucide-react";
import { Link } from "react-router";

import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { DonorContact } from "../providers/local/crmDonors";
import { useDonor } from "../providers/local/hooks";
import { TaskCreateSheet } from "../tasks/TaskCreateSheet";
import { PhoneCallButton } from "../voice/PhoneCallButton";
import { AutoMergeFlag } from "./AutoMergeFlag";
import { EmailLink, PhoneLink } from "./ContactLinks";
import { DonorTagBadge, Stat } from "./donorCrmUi";
import { formatDay, formatUsd } from "./donorFormat";

/** Agent-written summary fields; the API may not send them yet (never in the snapshot). */
interface SummaryFields {
  summary?: string | null;
  summary_updated_at?: string | null;
  summary_sources?: string[] | null;
}

/** The one place the summary fields are read, so a rename touches only this. */
export const readSummary = (
  ...records: (object | null | undefined)[]
): { text: string; updatedAt: string | null } => {
  for (const r of records as (SummaryFields | null | undefined)[]) {
    const text = r?.summary?.trim();
    if (text) return { text, updatedAt: r?.summary_updated_at ?? null };
  }
  return { text: "", updatedAt: null };
};

export const AgentSummary = ({
  firstName,
  text,
  updatedAt,
}: {
  firstName: string;
  text: string;
  updatedAt: string | null;
}) => (
  <section aria-label={`About ${firstName}`} className="space-y-0.5">
    <h3 className="text-sm font-semibold">About {firstName}</h3>
    {text ? (
      <>
        <p className="text-xs text-muted-foreground">
          written by the agent
          {updatedAt ? ` · updated ${formatDay(updatedAt)}` : ""}
        </p>
        <p className="text-sm leading-relaxed">{text}</p>
      </>
    ) : (
      <p className="text-sm text-muted-foreground">No notes yet.</p>
    )}
  </section>
);

/**
 * The panel under an expanded donor row (#CRM list): contact, giving, why they
 * rank here, badges, next step and the same actions as the donor page. The
 * row supplies the contact (masked in the snapshot build); the donor record
 * supplies the gift totals and the full "why" sentence once it loads.
 */
export const DonorRowDetails = ({
  donor,
  id,
}: {
  donor: DonorContact;
  id: string;
}) => {
  const { data: detail } = useDonor(donor.id);
  const [taskOpen, setTaskOpen] = useState(false);
  const giftCount = detail?.gift_count ?? donor.gift_count;
  const lifetime = detail?.total_given ?? donor.total_given;
  const lastDate = detail?.last_gift_date ?? donor.last_gift_date;
  const lastAmount = detail?.last_gift_amount ?? donor.last_gift_amount;
  const why = detail?.why || donor.why_short;
  const summary = readSummary(detail, donor);
  const firstName =
    donor.first_name || donor.full_name.split(/\s+/)[0] || donor.full_name;

  return (
    <div
      id={id}
      role="region"
      aria-label={`Details for ${donor.full_name}`}
      className="space-y-3 border-t border-border bg-muted/30 px-4 py-4 sm:pl-[4.5rem]"
    >
      <AgentSummary
        firstName={firstName}
        text={summary.text}
        updatedAt={summary.updatedAt}
      />
      <div className="flex flex-wrap items-center gap-1.5">
        {(donor.status_tags ?? []).map((tag) => (
          <DonorTagBadge key={tag} tag={tag} />
        ))}
        {donor.auto_merged && (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-warn/30 py-0.5 pr-2.5 pl-1 text-xs font-medium">
            <AutoMergeFlag
              personId={donor.id}
              name={donor.full_name}
              autoMerged={donor.auto_merged}
              mergedFrom={donor.merged_from}
            />
            Merged automatically. Review merges
          </span>
        )}
      </div>

      <dl className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
        <Stat
          label="Email"
          value={
            <span className="break-all">
              <EmailLink email={donor.email} />
            </span>
          }
        />
        <Stat label="Phone" value={<PhoneLink phone={donor.phone} />} />
        <Stat label="Lifetime" value={formatUsd(lifetime)} />
        <Stat
          label="Last gift"
          value={
            lastDate
              ? `${formatUsd(lastAmount)} · ${formatDay(lastDate)}`
              : "No gifts yet"
          }
        />
        <Stat
          label="Gifts"
          value={giftCount > 0 ? giftCount : "No gifts yet"}
        />
      </dl>

      {why && (
        <p className="text-sm leading-relaxed">
          <span className="font-semibold">Why they are ranked here:</span> {why}
        </p>
      )}
      {donor.next_step && (
        <p className="text-sm" data-testid="donor-next-step-expanded">
          <span className="font-semibold">Next step:</span> {donor.next_step}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        <PhoneCallButton donorId={donor.id} />
        <Button
          size="sm"
          className="min-h-9 rounded-full"
          onClick={() => setTaskOpen(true)}
        >
          <ListPlus aria-hidden />
          Add task
        </Button>
        <Link
          to={`/campaigns/new?donors=${donor.id}`}
          className={cn(
            buttonVariants({ size: "sm", variant: "outline" }),
            "min-h-9 rounded-full",
          )}
        >
          <Megaphone aria-hidden />
          Add to a campaign
        </Link>
      </div>
      <TaskCreateSheet
        open={taskOpen}
        onOpenChange={setTaskOpen}
        contact_id={donor.id}
      />
    </div>
  );
};
