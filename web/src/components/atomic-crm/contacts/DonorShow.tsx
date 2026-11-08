import { useEffect, useState } from "react";
import { ArrowLeft, ListPlus, Megaphone } from "lucide-react";
import { InfiniteListBase, ShowBase, useShowContext } from "ra-core";
import { Link, useSearchParams } from "react-router";

import { Button, buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { NoteCreate, NotesIterator } from "../notes";
import { reasonLabel } from "../providers/local/crmDonors";
import type { DonorContactDetail } from "../providers/local/crmResources";
import { useDonor } from "../providers/local/hooks";
import type { DonorDetail } from "../providers/local/types";
import { TaskCreateSheet } from "../tasks/TaskCreateSheet";
import { PhoneCallButton } from "../voice/PhoneCallButton";
import { CallNotesPanel } from "./CallNotesPanel";
import { ContactTasksList } from "./ContactTasksList";
import {
  DonorTagList,
  InitialsAvatar,
  ProfileSection,
  tileClass,
} from "./donorCrmUi";
import { scoreClass, statusLabel, tierLabel } from "./donorFormat";
import { DuplicateBanner } from "./DuplicateMerge";
import { GivingPanel } from "./GivingPanel";
import { InterestAreasEditor } from "./InterestChips";
import { MergeHistory } from "./MergeHistory";
import { OutreachPanel, SampleHistoryBadge } from "./OutreachPanel";
import { ResearchPanel } from "./ResearchPanel";
import { ScoreWhyPanel } from "./ScoreWhyPanel";
import { TagsListEdit } from "./TagsListEdit";
import { AutoMergeFlag } from "./AutoMergeFlag";
import { isNonGiver, TAB_ONE } from "./personTab";

const TABS = ["overview", "notes", "tasks"] as const;
type ProfileTab = (typeof TABS)[number];

/** The donor profile: /contacts/:id/show (Atomic CRM's contact show page). */
export const DonorShow = () => (
  <ShowBase>
    <DonorShowContent />
  </ShowBase>
);

const DonorShowContent = () => {
  const { record, isPending, error, refetch } =
    useShowContext<DonorContactDetail>();
  const donor = useDonor(record?.id ?? null);
  const [searchParams, setSearchParams] = useSearchParams();
  const requested = searchParams.get("tab") as ProfileTab | null;
  const tab: ProfileTab =
    requested && TABS.includes(requested) ? requested : "overview";
  const [taskOpen, setTaskOpen] = useState(false);

  // Enrich, merge, undo and approve refetch the donor-desk queries; follow
  // them so the record's tags and totals stay in step.
  const updatedAt = donor.dataUpdatedAt;
  useEffect(() => {
    if (updatedAt) refetch();
  }, [updatedAt, refetch]);

  if (isPending) {
    return (
      <div className="space-y-3 p-1" aria-busy="true">
        <Skeleton className="h-28 w-full rounded-2xl" />
        <Skeleton className="h-64 w-full rounded-2xl" />
      </div>
    );
  }
  if (!record) {
    return (
      <div className={cn(tileClass, "space-y-3 p-5")} role="alert">
        <p className="font-medium">This donor record isn't available.</p>
        <p className="text-sm text-muted-foreground">
          {error?.message ?? "It may have been merged into another record."}
        </p>
        <Link to="/contacts" className="text-sm font-medium underline">
          Back to all donors
        </Link>
      </div>
    );
  }

  return (
    <div className="@container mx-auto w-full max-w-6xl space-y-3 px-4 pt-4 pb-24 md:px-0 md:pt-0">
      <Link
        to="/contacts"
        className="inline-flex items-center gap-1.5 rounded-sm text-sm text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        <ArrowLeft className="size-4" aria-hidden />
        All donors
      </Link>

      <ProfileHeader record={record} onAddTask={() => setTaskOpen(true)} />
      <TaskCreateSheet
        open={taskOpen}
        onOpenChange={setTaskOpen}
        contact_id={record.id}
      />
      <DuplicateBanner donorId={record.id} />

      <Tabs
        value={tab}
        onValueChange={(value) =>
          setSearchParams({ tab: String(value) }, { replace: true })
        }
        className="w-full"
      >
        <TabsList className="h-10 w-full sm:w-fit">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="notes">Notes</TabsTrigger>
          <TabsTrigger value="tasks">
            Tasks{record.nb_tasks ? ` (${record.nb_tasks})` : ""}
          </TabsTrigger>
        </TabsList>
        <div className="grid items-start gap-3 @min-[900px]:grid-cols-[minmax(0,1fr)_320px]">
          <div className="min-w-0">
            <TabsContent value="overview" className="mt-0 space-y-3">
              <Overview
                record={record}
                donor={donor.data}
                error={donor.error}
              />
            </TabsContent>
            <TabsContent value="notes" className="mt-1">
              <ProfileSection title="Notes" caption="Your team's private notes">
                <InfiniteListBase
                  resource="contact_notes"
                  filter={{ contact_id: record.id }}
                  sort={{ field: "date", order: "DESC" }}
                  perPage={25}
                  disableSyncWithLocation
                  storeKey={false}
                  empty={<NoteCreate reference="contacts" />}
                >
                  <NotesIterator reference="contacts" />
                </InfiniteListBase>
              </ProfileSection>
            </TabsContent>
            <TabsContent value="tasks" className="mt-1">
              <ProfileSection
                title="Tasks"
                caption="Calls, thank-yous and follow-ups for this donor"
                actions={
                  <Button
                    size="sm"
                    variant="outline"
                    className="rounded-full"
                    onClick={() => setTaskOpen(true)}
                  >
                    <ListPlus aria-hidden />
                    Add task
                  </Button>
                }
              >
                <ContactTasksList />
              </ProfileSection>
            </TabsContent>
          </div>
          <ProfileAside record={record} />
        </div>
      </Tabs>
    </div>
  );
};

const ProfileHeader = ({
  record,
  onAddTask,
}: {
  record: DonorContactDetail;
  onAddTask: () => void;
}) => (
  <header className={cn(tileClass, "p-4 sm:p-5")}>
    <div className="flex flex-wrap items-start gap-4">
      <InitialsAvatar name={record.full_name ?? [record.first_name, record.last_name].filter(Boolean).join(" ")} size="lg" />
      <div className="min-w-0 flex-1">
        <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">
          {record.is_star && (
            <span className="mr-1 text-brand-soft-foreground">
              <span aria-hidden>★</span>
              <span className="sr-only">Star donor: </span>
            </span>
          )}
          {record.full_name}
          <span className="ml-2 inline-flex align-middle">
            <AutoMergeFlag
              personId={record.id}
              name={record.full_name}
              autoMerged={record.auto_merged}
              mergedFrom={record.merged_from}
            />
          </span>
        </h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          {[
            record.donor_type === "organization"
              ? "Organization"
              : "Individual",
            ...(isNonGiver(record.contact_type)
              ? [TAB_ONE[record.contact_type]]
              : [
                  `${tierLabel[record.tier]} donor`,
                  statusLabel[record.donor_status],
                ]),
            record.city,
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <DonorTagList tags={record.status_tags ?? []} />
          {record.is_sample && <SampleHistoryBadge />}
        </div>
      </div>
      <div className="text-right">
        <div className="text-xs font-medium text-muted-foreground">
          Priority score
        </div>
        <div
          className={cn(
            "text-3xl font-bold leading-none tabular-nums sm:text-4xl",
            scoreClass(record.score),
          )}
        >
          {record.score}
        </div>
      </div>
    </div>
    <div className="mt-4 flex flex-wrap gap-2">
      <PhoneCallButton donorId={record.id} />
      <Button size="sm" className="rounded-full" onClick={onAddTask}>
        <ListPlus aria-hidden />
        Add task
      </Button>
      <Link
        to={`/campaigns/new?donors=${record.id}`}
        className={cn(
          buttonVariants({ size: "sm", variant: "outline" }),
          "rounded-full",
        )}
      >
        <Megaphone aria-hidden />
        Add to a campaign
      </Link>
    </div>
  </header>
);

const Overview = ({
  record,
  donor,
  error,
}: {
  record: DonorContactDetail;
  donor: DonorDetail | undefined;
  error: Error | null;
}) => {
  if (error) {
    return (
      <p role="alert" className="text-sm text-destructive">
        Could not load this donor's history: {error.message}
      </p>
    );
  }
  if (!donor) return <Skeleton className="h-64 w-full rounded-2xl" />;
  return (
    <>
      <ScoreWhyPanel
        donor={donor}
        title="Why they're ranked here"
        hideGifts
        className={cn(tileClass, "space-y-3 p-4 sm:p-5")}
      >
        {(record.reasons ?? []).length > 0 && (
          <ul className="flex flex-wrap gap-1.5" aria-label="Score reasons">
            {(record.reasons ?? []).map((reason) => (
              <li
                key={reason}
                className="rounded-full bg-muted px-2.5 py-1 text-xs font-medium"
              >
                {reasonLabel(reason)}
              </li>
            ))}
          </ul>
        )}
      </ScoreWhyPanel>
      <GivingPanel donor={donor} recurring={record.recurring} />
      <div className={cn(tileClass, "overflow-hidden")}>
        <OutreachPanel donor={donor} />
      </div>
      <ResearchPanel
        donor={donor}
        className={cn(tileClass, "space-y-3 p-4 sm:p-5")}
      />
      <CallNotesPanel
        donorId={record.id}
        serverNotes={record.server_call_notes}
      />
      {donor.merges.length > 0 && (
        <div className={cn(tileClass, "overflow-hidden")}>
          <MergeHistory merges={donor.merges} />
        </div>
      )}
    </>
  );
};

const ProfileAside = ({ record }: { record: DonorContactDetail }) => (
  <aside className="space-y-3" aria-label="Donor details">
    <ProfileSection title="Contact">
      <dl className="space-y-2 text-sm">
        <Row label="Email" value={record.email ?? "Not recorded"} />
        <Row label="Phone" value={record.phone ?? "Not recorded"} />
        <Row
          label="Location"
          value={
            [record.city, record.state].filter(Boolean).join(", ") ||
            "Not recorded"
          }
        />
        <Row label="Fund" value={record.fund_type ?? "Not recorded"} />
        <Row label="Source list" value={record.source} />
      </dl>
      <p className="text-xs text-muted-foreground">
        Contact details are masked on screen.
      </p>
    </ProfileSection>

    <ProfileSection
      title={
        record.donor_type === "organization"
          ? "Organization"
          : "Household or organization"
      }
    >
      {record.company_id != null ? (
        <Link
          to={`/companies/${record.company_id}/show`}
          className="text-sm font-medium underline underline-offset-2"
        >
          {record.company_name}
        </Link>
      ) : (
        <p className="text-sm text-muted-foreground">None linked.</p>
      )}
    </ProfileSection>

    <ProfileSection title="Tags" caption="Your team's labels">
      <TagsListEdit />
    </ProfileSection>

    <ProfileSection
      title="Interest areas"
      caption="What they support, with the source for each"
    >
      <InterestAreasEditor personId={record.id} />
      {(record.interests ?? []).length > 0 && (
        <p className="text-xs text-muted-foreground">
          From the uploaded list: {(record.interests ?? []).join(", ")}
        </p>
      )}
    </ProfileSection>

    {record.imported_notes && (
      <ProfileSection title="Imported notes" caption="From the uploaded list">
        <p className="whitespace-pre-line text-sm">{record.imported_notes}</p>
      </ProfileSection>
    )}
  </aside>
);

const Row = ({ label, value }: { label: string; value: string }) => (
  <div className="flex justify-between gap-3">
    <dt className="text-muted-foreground">{label}</dt>
    <dd className="min-w-0 truncate text-right font-medium" title={value}>
      {value}
    </dd>
  </div>
);
