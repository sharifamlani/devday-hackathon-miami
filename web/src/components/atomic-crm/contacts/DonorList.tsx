import jsonExport from "jsonexport/dist";
import { useEffect, useId, useMemo, useState, type ReactNode } from "react";
import {
  downloadCSV,
  ListBase,
  useGetList,
  useListContext,
  type Exporter,
} from "ra-core";
import { Download, Filter, Megaphone, Upload, X } from "lucide-react";
import { Link } from "react-router";

import { BulkExportButton } from "@/components/admin/bulk-export-button";
import { ListPagination } from "@/components/admin/list-pagination";
import { Button, buttonVariants } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { ImportDonorsDialog } from "../import/ImportDonorsDialog";
import {
  DONOR_TAG_LABELS,
  DONOR_TAGS,
  LAST_GIFT_RANGE_LABELS,
  type DonorContact,
  type LastGiftRange,
} from "../providers/local/crmDonors";
import { useDonors } from "../providers/local/hooks";
import type { Tier } from "../providers/local/types";
import { useTags } from "../tags/useTags";
import { BulkTagButton } from "./BulkTagButton";
import {
  DirectorySearch,
  DonorsTabs,
  DonorTagBadge,
  InitialsAvatar,
  tileClass,
} from "./donorCrmUi";
import { formatDay, formatUsd, tierLabel } from "./donorFormat";
import { AutoMergeFlag } from "./AutoMergeFlag";
import { DuplicateBanner } from "./DuplicateMerge";
import { AlsoFound, PeopleTabBar, PeopleTabPanel } from "./PeopleTabs";
import { usePeopleTab } from "./usePeopleTab";

const SORTS = [
  { value: "score:DESC", label: "Priority score" },
  { value: "last_gift_date:DESC", label: "Last gift, newest" },
  { value: "last_gift_date:ASC", label: "Last gift, oldest" },
  { value: "total_given:DESC", label: "Lifetime giving" },
  { value: "last_name:ASC", label: "Name, A to Z" },
];

/** The Donors tab: Atomic CRM's contact list, on the donor data. */
export const DonorList = ({ embedded = false }: { embedded?: boolean }) => (
  <ListBase<DonorContact>
    resource="contacts"
    disableSyncWithLocation={embedded}
    storeKey={embedded ? "home-donors" : undefined}
    perPage={25}
    sort={{ field: "score", order: "DESC" }}
    exporter={exporter}
  >
    <DonorListLayout />
  </ListBase>
);

const DonorListLayout = () => {
  const { data, isPending, error, filterValues, total, refetch } =
    useListContext<DonorContact>();
  const [importOpen, setImportOpen] = useState(false);
  const facets = useFacets();
  const [tab] = usePeopleTab();

  // Imports and merges refetch the donor-desk queries; follow them.
  const donorsUpdatedAt = useDonors().dataUpdatedAt;
  useEffect(() => {
    if (donorsUpdatedAt) refetch();
  }, [donorsUpdatedAt, refetch]);

  const activeFilters = Object.keys(filterValues).filter((k) => k !== "q");

  return (
    <div className="@container mx-auto w-full max-w-6xl space-y-3 px-4 pt-4 pb-24 md:px-0 md:pt-0">
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
            <Upload aria-hidden />
            Import donors
          </Button>
          <ExportAllButton />
        </div>
      </div>
      <ImportDonorsDialog open={importOpen} onOpenChange={setImportOpen} />
      <PeopleTabBar />
      {tab !== "giver" && <PeopleTabPanel tab={tab} />}
      {tab === "giver" && <DuplicateBanner />}

      <div
        className={cn(
          "flex flex-wrap items-center gap-2",
          tab !== "giver" && "hidden",
        )}
      >
        <SearchBox />
        <SortSelect />
        <Popover>
          <PopoverTrigger
            render={
              <Button
                variant="outline"
                className="relative min-h-11 rounded-full"
              />
            }
          >
            <Filter aria-hidden /> Filter
            {activeFilters.length > 0 && (
              <span className="ml-1 rounded-full bg-primary px-1.5 text-xs text-primary-foreground">
                {activeFilters.length}
              </span>
            )}
          </PopoverTrigger>
          <PopoverContent
            align="end"
            sideOffset={8}
            className="desk-directory-filters"
          >
            <h2 className="font-semibold">Filter donors</h2>
            <DonorFilters facets={facets} />
          </PopoverContent>
        </Popover>
      </div>

      <div className={cn("flex gap-4", tab !== "giver" && "hidden")}>
        <div className="min-w-0 flex-1 space-y-2">
          <p className="text-sm text-muted-foreground" aria-live="polite">
            {isPending
              ? "Loading donors…"
              : error
                ? ""
                : `${total ?? 0} donor${total === 1 ? "" : "s"}`}
          </p>
          <div className={cn(tileClass, "overflow-hidden")}>
            {isPending ? (
              <div className="space-y-2 p-3">
                {Array.from({ length: 5 }, (_, i) => (
                  <Skeleton key={i} className="h-14 w-full" />
                ))}
              </div>
            ) : error ? (
              <p role="alert" className="p-4 text-sm text-destructive">
                Could not load donors: {error.message}
              </p>
            ) : data.length === 0 ? (
              <EmptyState
                filtered={Object.keys(filterValues).length > 0}
                onImport={() => setImportOpen(true)}
              />
            ) : (
              <DonorRows />
            )}
          </div>
          {!isPending && !error && (total ?? 0) > 25 && (
            <ListPagination rowsPerPageOptions={[25, 50, 100]} />
          )}
        </div>
      </div>
      {tab === "giver" && (
        <AlsoFound query={String(filterValues.q ?? "")} current="giver" />
      )}
      {tab === "giver" && <BulkBar />}
    </div>
  );
};

/* ---------- Search and sort ---------- */

const SearchBox = () => {
  const { filterValues, setFilters, displayedFilters } = useListContext();
  const [value, setValue] = useState<string>(String(filterValues.q ?? ""));

  useEffect(() => {
    const handle = setTimeout(() => {
      const q = value.trim();
      if ((filterValues.q ?? "") === q) return;
      const { q: _old, ...rest } = filterValues;
      setFilters(q ? { ...rest, q } : rest, displayedFilters);
    }, 250);
    return () => clearTimeout(handle);
  }, [value, filterValues, setFilters, displayedFilters]);

  return <DirectorySearch value={value} onChange={setValue} />;
};

const SortSelect = () => {
  const { sort, setSort } = useListContext();
  const id = useId();
  const current = `${sort.field}:${sort.order}`;
  return (
    <div className="flex items-center gap-2">
      <label htmlFor={id} className="text-sm text-muted-foreground">
        Sort by
      </label>
      <select
        id={id}
        value={SORTS.some((s) => s.value === current) ? current : "score:DESC"}
        onChange={(e) => {
          const [field, order] = e.target.value.split(":");
          setSort({ field, order: order as "ASC" | "DESC" });
        }}
        className="min-h-11 rounded-full border border-input bg-card px-3 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        {SORTS.map((s) => (
          <option key={s.value} value={s.value}>
            {s.label}
          </option>
        ))}
      </select>
    </div>
  );
};

/* ---------- Filters ---------- */

interface Facets {
  status: Record<string, number>;
  tier: Record<string, number>;
  lastGift: Record<string, number>;
  sources: [string, number][];
  drafts: number;
  recurring: number;
  organizations: number;
}

/** Counts for the filter chips, from the whole donor list. */
const useFacets = (): Facets | null => {
  const { data } = useGetList<DonorContact>("contacts", {
    pagination: { page: 1, perPage: 5000 },
    sort: { field: "score", order: "DESC" },
  });
  return useMemo(() => {
    if (!data) return null;
    const count = (values: string[]) =>
      values.reduce<Record<string, number>>((acc, v) => {
        acc[v] = (acc[v] ?? 0) + 1;
        return acc;
      }, {});
    return {
      status: count(data.flatMap((d) => d.status_tags ?? [])),
      tier: count(data.map((d) => d.tier)),
      lastGift: count(data.map((d) => d.last_gift_range)),
      sources: Object.entries(count(data.map((d) => d.source))).sort(
        ([a], [b]) => a.localeCompare(b),
      ),
      drafts: data.filter((d) => d.drafts_awaiting > 0).length,
      recurring: data.filter((d) => d.recurring).length,
      organizations: data.filter((d) => d.donor_type === "organization").length,
    };
  }, [data]);
};

const DonorFilters = ({ facets }: { facets: Facets | null }) => {
  const { filterValues, setFilters } = useListContext();
  const { data: tags = [] } = useTags();
  const hasFilters = Object.keys(filterValues).some((k) => k !== "q");
  return (
    <div className="space-y-4">
      <FilterGroup label="Status">
        {DONOR_TAGS.map((tag) => (
          <FilterChip
            key={tag}
            filterKey="status_tag"
            value={tag}
            count={facets ? (facets.status[tag] ?? 0) : undefined}
          >
            {DONOR_TAG_LABELS[tag]}
          </FilterChip>
        ))}
      </FilterGroup>
      <FilterGroup label="Giving tier">
        {(["big", "mid", "small"] as Tier[]).map((tier) => (
          <FilterChip
            key={tier}
            filterKey="tier"
            value={tier}
            count={facets ? (facets.tier[tier] ?? 0) : undefined}
          >
            {tierLabel[tier]}
          </FilterChip>
        ))}
      </FilterGroup>
      <FilterGroup label="Last gift">
        {(Object.keys(LAST_GIFT_RANGE_LABELS) as LastGiftRange[]).map(
          (range) => (
            <FilterChip
              key={range}
              filterKey="last_gift_range"
              value={range}
              count={facets ? (facets.lastGift[range] ?? 0) : undefined}
            >
              {LAST_GIFT_RANGE_LABELS[range]}
            </FilterChip>
          ),
        )}
      </FilterGroup>
      {tags.length > 0 && (
        <FilterGroup label="Tags">
          {tags.map((tag) => (
            <FilterChip key={tag.id} filterKey="tags@cs" value={`{${tag.id}}`}>
              <span
                aria-hidden
                className="inline-block size-2.5 rounded-full border border-border"
                style={{ backgroundColor: tag.color }}
              />
              {tag.name}
            </FilterChip>
          ))}
        </FilterGroup>
      )}
      {facets && facets.sources.length > 0 && (
        <FilterGroup label="Source list">
          {facets.sources.map(([source, n]) => (
            <FilterChip
              key={source}
              filterKey="source"
              value={source}
              count={n}
            >
              {source}
            </FilterChip>
          ))}
        </FilterGroup>
      )}
      <FilterGroup label="More">
        <FilterChip filterKey="has_draft" value={true} count={facets?.drafts}>
          Draft awaiting approval
        </FilterChip>
        <FilterChip
          filterKey="recurring"
          value={true}
          count={facets?.recurring}
        >
          Recurring donors
        </FilterChip>
        <FilterChip
          filterKey="donor_type"
          value="organization"
          count={facets?.organizations}
        >
          Organizations
        </FilterChip>
      </FilterGroup>
      {hasFilters && (
        <Button
          variant="ghost"
          size="sm"
          className="rounded-full"
          onClick={() =>
            setFilters(filterValues.q ? { q: filterValues.q } : {}, {})
          }
        >
          <X aria-hidden />
          Clear filters
        </Button>
      )}
    </div>
  );
};

const FilterGroup = ({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) => {
  const id = useId();
  return (
    <div role="group" aria-labelledby={id} className="space-y-1.5">
      <h2 id={id} className="text-xs font-semibold text-muted-foreground">
        {label}
      </h2>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </div>
  );
};

/** One toggle; a second filter in the same group replaces the first. */
const FilterChip = ({
  filterKey,
  value,
  count,
  children,
}: {
  filterKey: string;
  value: string | boolean;
  count?: number;
  children: ReactNode;
}) => {
  const { filterValues, setFilters, displayedFilters } = useListContext();
  const active = filterValues[filterKey] === value;
  const toggle = () => {
    const { [filterKey]: _old, ...rest } = filterValues;
    setFilters(
      active ? rest : { ...rest, [filterKey]: value },
      displayedFilters,
    );
  };
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={toggle}
      className={cn(
        "inline-flex min-h-9 items-center gap-1.5 rounded-full border px-3 text-sm transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
        active
          ? "border-primary bg-primary text-primary-foreground"
          : "border-border bg-card hover:bg-muted",
      )}
    >
      {children}
      {count != null && (
        <span
          className={cn(
            "tabular-nums text-xs",
            active ? "text-primary-foreground/80" : "text-muted-foreground",
          )}
        >
          {count}
        </span>
      )}
    </button>
  );
};

/* ---------- Rows ---------- */

const DonorRows = () => {
  const {
    data = [],
    selectedIds,
    onToggleItem,
    onSelect,
    onUnselectItems,
  } = useListContext<DonorContact>();
  const allSelected =
    data.length > 0 && data.every((d) => selectedIds.includes(d.id));
  return (
    <>
      <div className="flex items-center gap-3 border-b border-border px-3 py-2 text-xs text-muted-foreground">
        <Checkbox
          aria-label={
            allSelected
              ? "Unselect all donors"
              : "Select all donors on this page"
          }
          checked={allSelected}
          onCheckedChange={() =>
            allSelected ? onUnselectItems() : onSelect(data.map((d) => d.id))
          }
        />
        <span className="flex-1">Donor</span>
        <span className="hidden w-32 @min-[900px]:block">Status</span>
        <span className="hidden w-28 @min-[640px]:block">Last gift</span>
        <span className="hidden w-24 text-right @min-[760px]:block">
          Lifetime
        </span>
        <span className="w-12 text-right">Score</span>
      </div>
      <ul className="divide-y divide-border">
        {data.map((donor) => (
          <li
            key={donor.id}
            className="flex items-center gap-3 px-3 py-2.5 hover:bg-muted/50"
          >
            <Checkbox
              aria-label={`Select ${donor.full_name}`}
              checked={selectedIds.includes(donor.id)}
              onCheckedChange={() => onToggleItem(donor.id)}
            />
            <InitialsAvatar name={donor.full_name ?? [donor.first_name, donor.last_name].filter(Boolean).join(" ")} size="sm" />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <Link
                  to={`/contacts/${donor.id}/show`}
                  className="truncate rounded-sm font-medium hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                >
                  {donor.is_star && (
                    <>
                      <span aria-hidden className="mr-0.5">
                        ★
                      </span>
                      <span className="sr-only">Star donor: </span>
                    </>
                  )}
                  {donor.full_name}
                </Link>
                <AutoMergeFlag
                  personId={donor.id}
                  name={donor.full_name}
                  autoMerged={donor.auto_merged}
                  mergedFrom={donor.merged_from}
                />
                <span className="flex flex-wrap gap-1 @min-[900px]:hidden">
                  {(donor.status_tags ?? []).slice(0, 2).map((tag) => (
                    <DonorTagBadge key={tag} tag={tag} />
                  ))}
                </span>
              </div>
              <p className="truncate text-xs text-muted-foreground">
                {[
                  donor.company_name && donor.company_name !== donor.full_name
                    ? donor.company_name
                    : null,
                  donor.city,
                  donor.usual_cadence ? `gives ${donor.usual_cadence}` : null,
                  donor.why_short,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
              {donor.next_step && (
                <p className="truncate text-xs" data-testid="donor-next-step">
                  <span className="font-medium">Next step:</span>{" "}
                  {donor.next_step}
                </p>
              )}
              <p className="text-xs text-muted-foreground @min-[640px]:hidden">
                Last gift {formatDay(donor.last_gift_date)} ·{" "}
                {formatUsd(donor.total_given)} lifetime
              </p>
            </div>
            <div
              className="hidden w-32 flex-wrap gap-1 @min-[900px]:flex"
              aria-label={`Status for ${donor.full_name}`}
            >
              {(donor.status_tags ?? []).slice(0, 2).map((tag) => (
                <DonorTagBadge key={tag} tag={tag} />
              ))}
            </div>
            <div className="hidden w-28 text-sm @min-[640px]:block">
              {donor.last_gift_date ? (
                <>
                  <div>{formatUsd(donor.last_gift_amount)}</div>
                  <div className="text-xs text-muted-foreground">
                    {formatDay(donor.last_gift_date)}
                  </div>
                </>
              ) : (
                <span className="text-muted-foreground">None yet</span>
              )}
            </div>
            <div className="hidden w-24 text-right text-sm tabular-nums md:block">
              {formatUsd(donor.total_given)}
            </div>
            <div className="w-12 text-right font-semibold tabular-nums">
              {donor.score}
            </div>
          </li>
        ))}
      </ul>
    </>
  );
};

const EmptyState = ({
  filtered,
  onImport,
}: {
  filtered: boolean;
  onImport: () => void;
}) => {
  const { setFilters } = useListContext();
  return (
    <div className="space-y-3 p-6 text-center">
      <p className="font-medium">
        {filtered ? "No donors match these filters." : "No donors yet."}
      </p>
      {filtered ? (
        <Button
          variant="outline"
          className="rounded-full"
          onClick={() => setFilters({}, {})}
        >
          Clear filters
        </Button>
      ) : (
        <Button className="rounded-full" onClick={onImport}>
          <Upload aria-hidden />
          Import donors
        </Button>
      )}
    </div>
  );
};

/* ---------- Bulk actions ---------- */

const BulkBar = () => {
  const { selectedIds, onUnselectItems } = useListContext<DonorContact>();
  if (!selectedIds.length) return null;
  const n = selectedIds.length;
  return (
    <div
      role="region"
      aria-label="Bulk actions"
      className="fixed inset-x-4 bottom-4 z-20 mx-auto flex max-w-2xl flex-wrap items-center gap-2 rounded-2xl border border-border bg-card p-2 pl-3 shadow-lg"
    >
      <span className="mr-auto text-sm font-medium" aria-live="polite">
        {n} selected
      </span>
      <Link
        to={`/campaigns/new?donors=${selectedIds.join(",")}`}
        className={cn(buttonVariants({ size: "sm" }), "rounded-full")}
      >
        <Megaphone aria-hidden />
        Add to a campaign
      </Link>
      <BulkTagButton />
      <BulkExportButton label="Export CSV" />
      <Button
        size="icon"
        variant="ghost"
        aria-label="Clear selection"
        onClick={() => onUnselectItems()}
      >
        <X />
      </Button>
    </div>
  );
};

/** Exports every donor matching the current search and filters. */
const ExportAllButton = () => {
  const { filterValues, sort } = useListContext();
  const { data } = useGetList<DonorContact>("contacts", {
    filter: filterValues,
    sort,
    pagination: { page: 1, perPage: 5000 },
  });
  return (
    <Button
      variant="outline"
      size="sm"
      className="rounded-full"
      disabled={!data?.length}
      onClick={() => data && exportDonors(data)}
    >
      <Download aria-hidden />
      Export CSV
    </Button>
  );
};

/** CSV of what the screen shows: masked contact details, no raw addresses. */
const exportDonors = (records: DonorContact[]) =>
  jsonExport(
    records.map((d) => ({
      name: d.full_name,
      organization: d.company_name ?? "",
      type: d.donor_type,
      status: d.status_tags.map((t) => DONOR_TAG_LABELS[t]).join(", "),
      score: d.score,
      tier: d.tier,
      last_gift_date: d.last_gift_date ?? "",
      last_gift_amount: d.last_gift_amount ?? "",
      lifetime: d.total_given,
      gifts: d.gift_count,
      usual_timing: d.usual_cadence ?? "",
      city: d.city ?? "",
      email_masked: d.email ?? "",
      source_list: d.source,
    })),
    {},
    (_err: unknown, csv: string) => downloadCSV(csv, "donors"),
  );

const exporter: Exporter<DonorContact> = (records) => exportDonors(records);
