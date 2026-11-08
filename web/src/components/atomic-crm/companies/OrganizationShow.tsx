import { ArrowLeft, Building2 } from "lucide-react";
import { ShowBase, useGetList, useShowContext } from "ra-core";
import { Link } from "react-router";

import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import {
  DonorTagList,
  InitialsAvatar,
  ProfileSection,
  Stat,
  tileClass,
} from "../contacts/donorCrmUi";
import { formatDay, formatUsd, tierLabel } from "../contacts/donorFormat";
import {
  ORG_KIND_LABELS,
  type DonorContact,
  type DonorOrganization,
} from "../providers/local/crmDonors";

/** One giving organization: its own record, its people, their giving. */
export const OrganizationShow = () => (
  <ShowBase>
    <OrganizationShowContent />
  </ShowBase>
);

const OrganizationShowContent = () => {
  const { record, isPending, error } = useShowContext<DonorOrganization>();
  const { data: people = [], isPending: peoplePending } =
    useGetList<DonorContact>(
      "contacts",
      {
        filter: { company_id: record?.id },
        sort: { field: "score", order: "DESC" },
        pagination: { page: 1, perPage: 200 },
      },
      { enabled: record != null },
    );

  if (isPending) return <Skeleton className="h-40 w-full rounded-2xl" />;
  if (!record) {
    return (
      <div role="alert" className={cn(tileClass, "space-y-2 p-5")}>
        <p className="font-medium">This organization isn't available.</p>
        <p className="text-sm text-muted-foreground">{error?.message}</p>
        <Link to="/companies" className="text-sm underline">
          Back to organizations
        </Link>
      </div>
    );
  }

  const own = people.find((p) => p.id === record.donor_id);
  const members = people.filter((p) => p.id !== record.donor_id);

  return (
    <div className="mx-auto w-full max-w-4xl space-y-3 px-4 pt-4 pb-12 md:px-0 md:pt-0">
      <Link
        to="/companies"
        className="inline-flex items-center gap-1.5 rounded-sm text-sm text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        <ArrowLeft className="size-4" aria-hidden />
        All organizations
      </Link>
      <header
        className={cn(tileClass, "flex flex-wrap items-start gap-4 p-4 sm:p-5")}
      >
        <span
          aria-hidden
          className="flex size-14 shrink-0 items-center justify-center rounded-full bg-olive"
        >
          <Building2 className="size-6" />
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-semibold tracking-tight">
            {record.name}
          </h1>
          <p className="text-sm text-muted-foreground">
            {[
              ORG_KIND_LABELS[record.kind],
              record.tier ? `${tierLabel[record.tier]} donor` : null,
              record.city,
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>
      </header>

      <ProfileSection
        title="Giving"
        caption={
          record.donor_id != null
            ? "From the organization's own donor record"
            : "What the people linked to it gave"
        }
      >
        <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          <Stat label="Lifetime" value={formatUsd(record.total_given)} />
          <Stat label="Gifts" value={record.gift_count} />
          <Stat label="Last gift" value={formatDay(record.last_gift_date)} />
        </dl>
        {own && (
          <p className="text-sm">
            <Link
              to={`/contacts/${own.id}/show`}
              className="font-medium underline underline-offset-2"
            >
              Open the donor record
            </Link>{" "}
            for gifts, notes, tasks and outreach.
          </p>
        )}
      </ProfileSection>

      <ProfileSection
        title="People"
        caption="Donors who give through or with this organization"
      >
        {peoplePending ? (
          <Skeleton className="h-12 w-full" />
        ) : members.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No individual donors linked yet.
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {members.map((person) => (
              <li key={person.id} className="flex items-center gap-3 py-2">
                <InitialsAvatar name={person.full_name} size="sm" />
                <div className="min-w-0 flex-1">
                  <Link
                    to={`/contacts/${person.id}/show`}
                    className="font-medium hover:underline"
                  >
                    {person.full_name}
                  </Link>
                  <p className="text-xs text-muted-foreground">
                    {formatUsd(person.total_given)} lifetime · last gift{" "}
                    {formatDay(person.last_gift_date)}
                  </p>
                </div>
                <DonorTagList tags={person.status_tags.slice(0, 2)} />
              </li>
            ))}
          </ul>
        )}
      </ProfileSection>
    </div>
  );
};
