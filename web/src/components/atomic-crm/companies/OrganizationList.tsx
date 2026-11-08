import { useId, useState } from "react";
import { ListBase, useListContext } from "ra-core";
import { Building2, Search } from "lucide-react";
import { Link } from "react-router";

import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { DonorsTabs, tileClass } from "../contacts/donorCrmUi";
import { formatDay, formatUsd } from "../contacts/donorFormat";
import {
  ORG_KIND_LABELS,
  type DonorOrganization,
  type OrgKind,
} from "../providers/local/crmDonors";

/**
 * Organizations that give: foundations, businesses and households (Atomic
 * CRM's companies screen). Derived from the donor records, so read-only.
 */
export const OrganizationList = () => (
  <ListBase<DonorOrganization>
    resource="companies"
    perPage={100}
    sort={{ field: "total_given", order: "DESC" }}
  >
    <OrganizationListLayout />
  </ListBase>
);

const OrganizationListLayout = () => {
  const { data, isPending, error, filterValues, setFilters, total } =
    useListContext<DonorOrganization>();
  const [q, setQ] = useState<string>(String(filterValues.q ?? ""));
  const searchId = useId();
  const kind = filterValues.kind as OrgKind | undefined;

  const apply = (next: Record<string, unknown>) =>
    setFilters(
      Object.fromEntries(
        Object.entries({ ...filterValues, ...next }).filter(
          ([, v]) => v !== undefined && v !== "",
        ),
      ),
      {},
    );

  return (
    <div className="mx-auto w-full max-w-6xl space-y-3 px-4 pt-4 pb-12 md:px-0 md:pt-0">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Donors</h1>
        <DonorsTabs />
      </div>
      <p className="text-sm text-muted-foreground">
        Foundations, businesses and households that give. Built from the donor
        records; edit the donor record to change one.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1 basis-56">
          <label htmlFor={searchId} className="sr-only">
            Search organizations
          </label>
          <Search
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            id={searchId}
            type="search"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              apply({ q: e.target.value.trim() || undefined });
            }}
            placeholder="Find an organization"
            className="min-h-11 rounded-full bg-card pl-9"
          />
        </div>
        <div
          role="group"
          aria-label="Organization type"
          className="flex flex-wrap gap-1.5"
        >
          {(Object.keys(ORG_KIND_LABELS) as OrgKind[]).map((k) => (
            <button
              key={k}
              type="button"
              aria-pressed={kind === k}
              onClick={() => apply({ kind: kind === k ? undefined : k })}
              className={cn(
                "min-h-9 rounded-full border px-3 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                kind === k
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-card hover:bg-muted",
              )}
            >
              {ORG_KIND_LABELS[k]}
            </button>
          ))}
        </div>
      </div>

      <p className="text-sm text-muted-foreground" aria-live="polite">
        {isPending ? "Loading…" : error ? "" : `${total ?? 0} organizations`}
      </p>
      {isPending ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }, (_, i) => (
            <Skeleton key={i} className="h-36 rounded-2xl" />
          ))}
        </div>
      ) : error ? (
        <p role="alert" className="text-sm text-destructive">
          Could not load organizations: {error.message}
        </p>
      ) : data.length === 0 ? (
        <div className={cn(tileClass, "p-6 text-center text-sm")}>
          {Object.keys(filterValues).length
            ? "No organizations match."
            : "No organizations yet. Organization donors and the organizations people give through show up here."}
        </div>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {data.map((org) => (
            <li key={org.id}>
              <Link
                to={`/companies/${org.id}/show`}
                className={cn(
                  tileClass,
                  "flex h-full flex-col gap-3 p-4 transition-colors hover:bg-muted/40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                )}
              >
                <div className="flex items-start gap-3">
                  <span
                    aria-hidden
                    className="flex size-10 shrink-0 items-center justify-center rounded-full bg-olive"
                  >
                    <Building2 className="size-5" />
                  </span>
                  <div className="min-w-0">
                    <p className="truncate font-medium">{org.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {[ORG_KIND_LABELS[org.kind], org.city]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                  </div>
                </div>
                <dl className="mt-auto grid grid-cols-3 gap-2 text-xs">
                  <div>
                    <dt className="text-muted-foreground">Lifetime</dt>
                    <dd className="font-semibold tabular-nums">
                      {formatUsd(org.total_given)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Last gift</dt>
                    <dd className="font-semibold">
                      {formatDay(org.last_gift_date)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">People</dt>
                    <dd className="font-semibold tabular-nums">
                      {org.nb_contacts}
                    </dd>
                  </div>
                </dl>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};
