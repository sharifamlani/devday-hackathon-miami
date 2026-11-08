import { useId, useMemo, useState } from "react";
import { ArrowLeft, Search, Sparkles } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import { SourceLink } from "../contacts/ResearchPanel";
import { formatUsd } from "../contacts/donorFormat";
import { DATA_MODE } from "../providers/local/config";
import { useDonor, useEnrichDonor } from "../providers/local/hooks";
import type { DonorDetail, DonorSummary } from "../providers/local/types";
import {
  donorMeta,
  donorTag,
  initials,
  maskEmail,
  searchDonors,
} from "./homeData";
import { focusRing, tagTone } from "./tile";

const pill = cn(
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-full px-4 text-sm font-semibold transition-colors disabled:opacity-60",
  focusRing,
);

/**
 * "Find a donor" from the CRM tile: search by name, email or organization,
 * pick one, see the essentials and any research the enrich agent saved.
 * "Enrich profile" runs the enrich agent on the live service; the static
 * snapshot only shows what was saved.
 */
export const FindDonorDialog = ({
  open,
  onOpenChange,
  donors,
  onOpenRecord,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  donors: DonorSummary[];
  onOpenRecord: (id: number) => void;
}) => {
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const inputId = useId();
  const results = useMemo(() => searchDonors(donors, query), [donors, query]);

  const close = (next: boolean) => {
    onOpenChange(next);
    if (!next) {
      setQuery("");
      setSelectedId(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] gap-4 overflow-y-auto rounded-[22px] p-6 sm:max-w-xl">
        <DialogTitle className="text-xl font-bold">Find a donor</DialogTitle>
        <DialogDescription className="sr-only">
          Search by name, email or organization, then pick a donor.
        </DialogDescription>
        {selectedId == null ? (
          <>
            <div className="flex items-center gap-2 rounded-full border border-border bg-card px-3.5 focus-within:border-foreground">
              <Search
                className="size-4 shrink-0 text-muted-foreground"
                aria-hidden="true"
              />
              <label htmlFor={inputId} className="sr-only">
                Donor name, email or organization
              </label>
              <input
                id={inputId}
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Name, email or organization"
                autoComplete="off"
                className="min-h-11 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
              />
            </div>
            <p aria-live="polite" className="sr-only">
              {query.trim()
                ? `${results.length} ${results.length === 1 ? "match" : "matches"}`
                : ""}
            </p>
            {query.trim() && results.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No donor matches “{query.trim()}”.
              </p>
            ) : (
              <ul className="-mx-1 grid gap-0.5" aria-label="Donors">
                {results.map((donor) => {
                  const tag = donorTag(donor);
                  return (
                    <li key={donor.id}>
                      <button
                        type="button"
                        onClick={() => setSelectedId(donor.id)}
                        className={cn(
                          "flex min-h-11 w-full items-center gap-2.5 rounded-xl px-1 py-2 text-left hover:bg-surface",
                          focusRing,
                        )}
                      >
                        <span
                          aria-hidden="true"
                          className="grid size-8 shrink-0 place-items-center rounded-full bg-quiet text-[11px] font-bold text-quiet-foreground"
                        >
                          {initials(donor.full_name)}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-semibold">
                            {donor.full_name}
                          </span>
                          <span className="block truncate text-xs text-muted-foreground">
                            {donorMeta(donor)}
                          </span>
                        </span>
                        <span
                          className={cn(
                            "shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold",
                            tagTone[tag.tone],
                          )}
                        >
                          {tag.label}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </>
        ) : (
          <DonorPick
            donorId={selectedId}
            onBack={() => setSelectedId(null)}
            onOpenRecord={() => {
              close(false);
              onOpenRecord(selectedId);
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  );
};

const Fact = ({ label, value }: { label: string; value: string }) => (
  <div className="rounded-xl bg-surface px-3 py-2">
    <dt className="text-xs text-muted-foreground">{label}</dt>
    <dd className="truncate font-semibold">{value}</dd>
  </div>
);

const DonorPick = ({
  donorId,
  onBack,
  onOpenRecord,
}: {
  donorId: number;
  onBack: () => void;
  onOpenRecord: () => void;
}) => {
  const { data: donor, isPending, error } = useDonor(donorId);
  return (
    <div className="grid gap-4">
      <button
        type="button"
        onClick={onBack}
        className={cn(
          "inline-flex min-h-9 w-fit items-center gap-1.5 rounded-full text-sm font-medium hover:underline",
          focusRing,
        )}
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        Back to search
      </button>
      {error ? (
        <p role="alert" className="text-sm text-alert-foreground">
          We couldn’t load this donor: {error.message}
        </p>
      ) : isPending || !donor ? (
        <div className="grid gap-2" aria-label="Loading donor">
          <Skeleton className="h-12 w-full rounded-xl" />
          <Skeleton className="h-28 w-full rounded-xl" />
        </div>
      ) : (
        <DonorSummaryView donor={donor} onOpenRecord={onOpenRecord} />
      )}
    </div>
  );
};

const DonorSummaryView = ({
  donor,
  onOpenRecord,
}: {
  donor: DonorDetail;
  onOpenRecord: () => void;
}) => {
  const live = DATA_MODE === "local";
  return (
    <>
      <div className="flex items-center gap-3">
        <span
          aria-hidden="true"
          className="grid size-11 shrink-0 place-items-center rounded-full bg-quiet text-sm font-bold text-quiet-foreground"
        >
          {initials(donor.full_name)}
        </span>
        <div className="min-w-0">
          <p className="truncate font-semibold">{donor.full_name}</p>
          <p className="text-sm text-muted-foreground">{donor.why_short}</p>
        </div>
      </div>
      <dl className="grid grid-cols-2 gap-2 text-sm">
        <Fact label="Lifetime" value={formatUsd(donor.total_given)} />
        <Fact label="Gifts" value={String(donor.gift_count)} />
        <Fact label="Email" value={maskEmail(donor.email)} />
        <Fact label="Pattern" value={donorMeta(donor) || "—"} />
      </dl>
      <Research donor={donor} live={live} />
      <div className="flex flex-wrap gap-2">
        {live && <EnrichButton donor={donor} />}
        <button
          type="button"
          onClick={onOpenRecord}
          className={cn(
            pill,
            live
              ? "bg-surface hover:bg-accent"
              : "bg-primary text-primary-foreground hover:bg-primary/85",
          )}
        >
          Open full record
        </button>
      </div>
    </>
  );
};

const Research = ({ donor, live }: { donor: DonorDetail; live: boolean }) => {
  if (donor.research.length === 0)
    return (
      <p className="rounded-xl border-l-4 border-brand bg-surface px-3.5 py-2.5 text-sm text-muted-foreground">
        {live
          ? "No research yet. Enrich profile looks up public, professional sources."
          : "No saved research for this donor. Enrichment runs on the live service."}
      </p>
    );
  return (
    <div className="rounded-xl border-l-4 border-brand bg-surface px-3.5 py-2.5 text-sm">
      <p className="font-semibold">
        Enrichment found (public web, review before using):
      </p>
      <ul className="mt-1 grid gap-1">
        {donor.research.map((fact) => (
          <li key={fact.id}>
            {fact.fact} <SourceLink href={fact.source_url} />
          </li>
        ))}
      </ul>
    </div>
  );
};

const EnrichButton = ({ donor }: { donor: DonorDetail }) => {
  const enrich = useEnrichDonor(donor.id);
  return (
    <>
      <button
        type="button"
        onClick={() => enrich.mutate()}
        disabled={enrich.isPending}
        className={cn(
          pill,
          "bg-primary text-primary-foreground hover:bg-primary/85",
        )}
      >
        {enrich.isPending ? (
          <Spinner />
        ) : (
          <Sparkles className="size-4" aria-hidden="true" />
        )}
        {enrich.isPending ? "Enriching…" : "Enrich profile"}
      </button>
      {enrich.isError && (
        <p role="alert" className="basis-full text-sm text-alert-foreground">
          {enrich.error.message}
        </p>
      )}
    </>
  );
};
