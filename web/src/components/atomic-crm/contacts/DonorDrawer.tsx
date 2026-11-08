import { useGetOne } from "ra-core";
import { ArrowRight } from "lucide-react";
import { Link } from "react-router";

import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type { DonorContactDetail } from "../providers/local/crmResources";
import { AutoMergeFlag } from "./AutoMergeFlag";
import { isNonGiver, TAB_ONE } from "./personTab";
import { useDonor } from "../providers/local/hooks";
import { AboutPanel } from "./AboutPanel";
import { CallNotesPanel } from "./CallNotesPanel";
import { EmailLink, PhoneLink } from "./ContactLinks";
import { useDonorProjects } from "../providers/local/campaignHooks";
import { DonorTagList, Stat } from "./donorCrmUi";
import { GivingPanel } from "./GivingPanel";
import { SavedInterestChips } from "./InterestChips";
import { scoreClass, statusClass, statusLabel, tierLabel } from "./donorFormat";
import { MergeHistory } from "./MergeHistory";
import { OutreachPanel, SampleHistoryBadge } from "./OutreachPanel";
import { ResearchPanel } from "./ResearchPanel";
import { ScoreWhyPanel } from "./ScoreWhyPanel";

const initialsOf = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");

/**
 * Right-hand drawer: the donor at a glance (status, contact, giving) and
 * where the AI's work is visible (why · enrichment · draft), with a link to
 * the full profile. Props are stable: the home page and Ask use it.
 */
export const DonorDrawer = ({
  donorId,
  onClose,
}: {
  donorId: number | null;
  onClose: () => void;
}) => {
  const { data: donor, isPending, error } = useDonor(donorId);
  const projects = useDonorProjects(donorId);
  // The CRM record adds status tags, contact details and call notes.
  const { data: record } = useGetOne<DonorContactDetail>(
    "contacts",
    { id: donorId ?? -1 },
    { enabled: donorId != null },
  );
  return (
    <Sheet open={donorId != null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent
        side="right"
        className="w-full overflow-y-auto bg-card data-[side=right]:w-full data-[side=right]:sm:max-w-xl"
      >
        {donor ? (
          <>
            <SheetHeader className="border-b border-border bg-surface px-6 pb-5 pt-6">
              <div className="flex items-start justify-between gap-3 pr-10 sm:gap-4">
                <div
                  aria-hidden
                  className="flex size-10 shrink-0 items-center justify-center rounded-full bg-brand text-base font-bold text-brand-foreground sm:size-12"
                >
                  {initialsOf(donor.full_name)}
                </div>
                <div className="min-w-0 flex-1">
                  <SheetTitle className="text-lg font-bold tracking-tight [overflow-wrap:break-word] sm:text-xl">
                    {donor.is_star && (
                      <span
                        className="mr-1 text-brand-soft-foreground"
                        aria-label="Star donor"
                      >
                        ★
                      </span>
                    )}
                    {donor.full_name}
                    <span className="ml-2 inline-flex align-middle">
                      <AutoMergeFlag
                        personId={donor.id}
                        name={donor.full_name}
                        autoMerged={donor.auto_merged}
                        mergedFrom={donor.merged_from}
                      />
                    </span>
                  </SheetTitle>
                  <SheetDescription className="mt-1 flex flex-wrap items-center gap-1.5">
                    {/* Phone: the score sits with the badges so the name gets the full row. */}
                    <span
                      className={cn(
                        "rounded-full bg-card px-2.5 py-0.5 text-xs font-bold tabular-nums sm:hidden",
                        scoreClass(donor.score),
                      )}
                    >
                      Score {donor.score}
                    </span>
                    <Badge
                      variant="outline"
                      className="rounded-full border-border bg-card px-2.5 text-muted-foreground"
                    >
                      {isNonGiver(donor.contact_type)
                        ? TAB_ONE[donor.contact_type]
                        : `${tierLabel[donor.tier]} donor`}
                    </Badge>
                    {donor.is_sample && <SampleHistoryBadge />}
                    {!isNonGiver(donor.contact_type) && (
                      <span
                        className={cn(
                          "rounded-full px-2.5 py-0.5 text-xs font-semibold",
                          statusClass[donor.status],
                        )}
                      >
                        {statusLabel[donor.status]}
                      </span>
                    )}
                    <span className="text-xs text-muted-foreground">
                      {[
                        donor.donor_type === "organization"
                          ? "Organization"
                          : "Individual",
                        donor.fund_type,
                        donor.city,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  </SheetDescription>
                </div>
                <div className="hidden shrink-0 text-right sm:block">
                  <div className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                    Score
                  </div>
                  <div
                    className={cn(
                      "text-3xl font-bold leading-none tabular-nums sm:text-4xl",
                      scoreClass(donor.score),
                    )}
                  >
                    {donor.score}
                  </div>
                </div>
              </div>
            </SheetHeader>
            <div className="space-y-4 px-5 pb-8 pt-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                {record ? <DonorTagList tags={record.status_tags} /> : <span />}
                <Link
                  to={`/contacts/${donor.id}/show`}
                  onClick={onClose}
                  className={cn(
                    buttonVariants({ size: "sm", variant: "outline" }),
                    "rounded-full",
                  )}
                >
                  Open full record
                  <ArrowRight aria-hidden />
                </Link>
              </div>
              <AboutPanel donor={donor} />
              {record && (
                // Four equal bubbles. Where the record came from (Source) lives on the full record.
                <dl className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
                  <Stat label="Email" value={<EmailLink email={record.email} />} />
                  <Stat label="Phone" value={<PhoneLink phone={record.phone} />} />
                  <Stat
                    label="Organization"
                    value={record.company_name ?? "None linked"}
                  />
                  <Stat
                    label="Project"
                    value={
                      projects.isPending
                        ? "…"
                        : projects.isError
                          ? "Couldn't load"
                          : projects.projects.length
                          ? projects.projects.map((p) => p.name).join(", ")
                          : "None yet"
                    }
                  />
                </dl>
              )}
              <SavedInterestChips personId={donor.id} />
              {record && record.interests.length > 0 && (
                <p className="text-xs text-muted-foreground">
                  From the uploaded list: {record.interests.join(", ")}
                </p>
              )}
              <GivingPanel
                donor={donor}
                recurring={record?.recurring}
                compact
              />
              <ScoreWhyPanel donor={donor} hideGifts />
              <ResearchPanel donor={donor} />
              <OutreachPanel donor={donor} />
              <CallNotesPanel
                donorId={donor.id}
                serverNotes={record?.server_call_notes}
                limit={2}
              />
              <MergeHistory merges={donor.merges} />
            </div>
          </>
        ) : (
          <div className="space-y-3 p-4">
            <SheetTitle className="sr-only">Donor</SheetTitle>
            {error ? (
              <p role="alert" className="text-sm text-destructive">
                Could not load this donor: {error.message}
              </p>
            ) : (
              isPending && (
                <>
                  <Skeleton className="h-8 w-2/3" />
                  <Skeleton className="h-24 w-full" />
                  <Skeleton className="h-24 w-full" />
                </>
              )
            )}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
};
