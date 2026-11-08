import { useState, type ReactNode } from "react";
import { ListPlus, Megaphone, Plus, Sparkles } from "lucide-react";
import { Link } from "react-router";

import { Button, buttonVariants } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import { DATA_MODE } from "../providers/local/config";
import type { DonorContact } from "../providers/local/crmDonors";
import { useDonor } from "../providers/local/hooks";
import { usePersonInterests } from "../providers/local/interests";
import { TaskCreateSheet } from "../tasks/TaskCreateSheet";
import { PhoneCallButton } from "../voice/PhoneCallButton";
import { AutoMergeFlag } from "./AutoMergeFlag";
import { EmailLink, PhoneLink } from "./ContactLinks";
import { DonorTagBadge, Stat } from "./donorCrmUi";
import { formatDay, formatUsd } from "./donorFormat";
import { ENRICH_COPY, EnrichProposal, useEnrichReview } from "./EnrichReview";
import {
  InterestAreasEditor,
  InterestChip,
  tagLabel,
  useTagLabels,
} from "./InterestChips";

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
  action,
}: {
  firstName: string;
  text: string;
  updatedAt: string | null;
  action?: ReactNode;
}) => (
  <section aria-label={`About ${firstName}`} className="space-y-0.5">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h3 className="text-sm font-semibold">About {firstName}</h3>
      {action}
    </div>
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
 * Locked decision D6: individuals are never researched on the web. Sharif may lift
 * it; this is the one switch (true makes Enhance research individuals too).
 */
export const ENHANCE_RESEARCHES_INDIVIDUALS = false;

/** What Enhance does for a donor: research the web, offer manual tagging, or (snapshot) nothing. */
export const enhanceMode = (
  donorType: string,
  live: boolean,
  researchIndividuals = ENHANCE_RESEARCHES_INDIVIDUALS,
): "research" | "manual" | "readonly" =>
  !live
    ? "readonly"
    : donorType === "organization" || researchIndividuals
      ? "research"
      : "manual";

const chipButton =
  "inline-flex min-h-9 items-center gap-1.5 rounded-full border border-border bg-card px-3 text-xs font-semibold hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

/**
 * The donor's issue areas (the 17 fixed tags) as chips, with "+ Tag issue area"
 * opening the profile's tag editor. Staff-set tags read "added by you". The
 * read-only snapshot shows a short note instead of writing.
 */
export const IssueAreas = ({
  personId,
  editing,
  onEditingChange,
}: {
  personId: number;
  editing: boolean;
  onEditingChange: (editing: boolean) => void;
}) => {
  const { data: interests } = usePersonInterests(personId);
  const labels = useTagLabels();
  const [note, setNote] = useState(false);
  const live = DATA_MODE === "local";
  return (
    <section aria-label="Issue areas" className="space-y-1.5">
      {editing && live ? (
        <InterestAreasEditor personId={personId} />
      ) : interests && interests.length > 0 ? (
        <ul className="flex flex-wrap gap-1.5" aria-label="Issue areas">
          {interests.map((interest) => (
            <InterestChip
              key={`${interest.tag}:${interest.sub_tag ?? ""}`}
              interest={interest}
              label={
                tagLabel(interest, labels) +
                (interest.set_by === "staff" ? " · added by you" : "")
              }
            />
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">No issue areas yet.</p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className={chipButton}
          aria-expanded={live ? editing : undefined}
          onClick={() =>
            live ? onEditingChange(!editing) : setNote((n) => !n)
          }
        >
          <Plus className="size-3.5" aria-hidden />
          {editing && live ? "Done tagging" : "Tag issue area"}
        </button>
        {note && !live && (
          <p role="status" className="text-xs text-muted-foreground">
            Read-only demo: tagging works in the live app.
          </p>
        )}
      </div>
    </section>
  );
};

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
  const [tagging, setTagging] = useState(false);
  const [enhanceNote, setEnhanceNote] = useState<string | null>(null);
  const review = useEnrichReview(donor);
  const mode = enhanceMode(donor.donor_type, DATA_MODE === "local");
  // Enhance: orgs run the existing dry-run review; individuals (D6) get manual tagging;
  // the snapshot is read-only. Save to profile refetches the donor record (About + facts).
  const enhance = () => {
    setEnhanceNote(null);
    if (mode === "research") review.run();
    else if (mode === "manual") {
      setTagging(true);
      setEnhanceNote(ENRICH_COPY.individual);
    } else setEnhanceNote("Read-only demo: Enhance runs in the live app.");
  };
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
        action={
          <Button
            size="sm"
            className="min-h-9 rounded-full"
            onClick={enhance}
            disabled={review.preview.isPending}
          >
            {review.preview.isPending ? <Spinner /> : <Sparkles aria-hidden />}
            {review.preview.isPending ? "Enhancing…" : "Enhance"}
          </Button>
        }
      />
      <IssueAreas
        personId={donor.id}
        editing={tagging}
        onEditingChange={setTagging}
      />
      {enhanceNote && (
        <p role="status" className="text-xs text-muted-foreground">
          {enhanceNote}
        </p>
      )}
      <EnrichProposal review={review} />
      {review.found && (
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            className="min-h-9 rounded-full"
            onClick={review.save}
            disabled={review.accept.isPending || review.picked === 0}
          >
            {review.accept.isPending && <Spinner />}
            {review.accept.isPending ? "Saving…" : "Save to profile"}
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="min-h-9 rounded-full"
            onClick={review.discard}
          >
            Discard
          </Button>
        </div>
      )}
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
