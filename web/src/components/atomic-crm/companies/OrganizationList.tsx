import { useEffect, useState } from "react";
import { downloadCSV, ListBase, useListContext } from "ra-core";
import { Building2, Filter, Upload, Download } from "lucide-react";
import { Link } from "react-router";

import jsonExport from "jsonexport/dist";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@/components/ui/popover";
import { ImportDonorsDialog } from "../import/ImportDonorsDialog";
import { DuplicateBanner } from "../contacts/DuplicateMerge";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { DirectorySearch, DonorsTabs, tileClass } from "../contacts/donorCrmUi";
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
export const OrganizationList = ({
  embedded = false,
}: {
  embedded?: boolean;
}) => (
  <ListBase<DonorOrganization>
    resource="companies"
    disableSyncWithLocation={embedded}
    storeKey={embedded ? "home-organizations" : undefined}
    perPage={100}
    sort={{ field: "total_given", order: "DESC" }}
  >
    <OrganizationListLayout />
  </ListBase>
);

const OrganizationListLayout = () => {
  const {
    data,
    isPending,
    error,
    filterValues,
    setFilters,
    total,
    sort,
    setSort,
  } = useListContext<DonorOrganization>();
  const [q, setQ] = useState<string>(String(filterValues.q ?? ""));
  const [importOpen, setImportOpen] = useState(false);
  useEffect(() => {
    setQ(String(filterValues.q ?? ""));
  }, [filterValues.q]);
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
    <div className="@container mx-auto w-full max-w-6xl space-y-3 px-4 pt-4 pb-12 md:px-0 md:pt-0">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">Donors</h1>
          <DonorsTabs />
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            className="rounded-full"
            onClick={() => setImportOpen(true)}
          >
            <Upload aria-hidden /> Import donors
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="rounded-full"
            disabled={!data?.length}
            onClick={() =>
              jsonExport(
                (data ?? []).map(
                  ({
                    name,
                    city,
                    kind,
                    total_given,
                    last_gift_date,
                    nb_contacts,
                  }) => ({
                    name,
                    city,
                    kind,
                    total_given,
                    last_gift_date,
                    nb_contacts,
                  }),
                ),
                {},
                (_err: unknown, csv: string) =>
                  downloadCSV(csv, "organizations"),
              )
            }
          >
            <Download aria-hidden /> Export CSV
          </Button>
        </div>
      </div>
      <ImportDonorsDialog open={importOpen} onOpenChange={setImportOpen} />
      <DuplicateBanner />
      <div className="flex flex-wrap items-center gap-2">
        <DirectorySearch
          value={q}
          onChange={(value) => {
            setQ(value);
            apply({ q: value.trim() || undefined });
          }}
          label="Search organizations"
        />
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          Sort by
          <select
            aria-label="Sort organizations"
            className="min-h-11 rounded-full border border-input bg-card px-3 text-sm text-foreground"
            value={`${sort.field}:${sort.order}`}
            onChange={(event) => {
              const [field, order] = event.target.value.split(":");
              setSort({ field, order: order as "ASC" | "DESC" });
            }}
          >
            <option value="total_given:DESC">Lifetime giving</option>
            <option value="last_gift_date:DESC">Last gift, newest</option>
            <option value="name:ASC">Name, A to Z</option>
          </select>
        </label>
        <Popover>
          <PopoverTrigger
            render={
              <Button variant="outline" className="min-h-11 rounded-full" />
            }
          >
            <Filter aria-hidden /> Filter{kind ? " · 1" : ""}
          </PopoverTrigger>
          <PopoverContent align="end" className="rounded-2xl">
            <h2 className="font-semibold">Organization type</h2>
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
          </PopoverContent>
        </Popover>
      </div>

      <p className="text-sm text-muted-foreground" aria-live="polite">
        {isPending ? "Loading…" : error ? "" : `${total ?? 0} organizations`}
      </p>
      {isPending ? (
        <div className="grid gap-3 @min-[560px]:grid-cols-2 @min-[900px]:grid-cols-3">
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
        <ul className="grid gap-3 @min-[560px]:grid-cols-2 @min-[900px]:grid-cols-3">
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
