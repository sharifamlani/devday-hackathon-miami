import { useId, useMemo, useState, type ReactNode } from "react";
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
import { EmailLink, PhoneLink } from "../contacts/ContactLinks";
import { SourceLink } from "../contacts/ResearchPanel";
import { formatUsd } from "../contacts/donorFormat";
import { DATA_MODE } from "../providers/local/config";
import { contactEmail, contactPhone } from "../providers/local/crmDonors";
import { useDonor } from "../providers/local/hooks";
import { usePersonInterests } from "../providers/local/interests";
import { InterestChip, tagLabel, useTagLabels } from "../contacts/InterestChips";
import { ENRICH_COPY, EnrichProposal, enrichBox, useEnrichReview } from "../contacts/EnrichReview";
import type { DonorDetail, DonorSummary } from "../providers/local/types";
import {
  donorMeta,
  donorTag,
  initials,
  searchDonors,
} from "./homeData";
import { focusRing, tagTone } from "./tile";

const pill = cn(
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-full px-4 text-sm font-semibold transition-colors disabled:opacity-60",
  focusRing,
);

/**
 * "Find a donor" from the CRM tile: search givers by name, email or
 * organization. Pick a giver to see the essentials and anything the enrich
 * agent saved.
 * "Enrich profile" runs the agent on the live service as a dry run: it proposes
 * facts and interest areas (each with a source) and nothing is written until
 * staff press "Save to profile". Organizations only; the static snapshot only
 * shows what was saved.
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
  const total = results.length;

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
                ? `${total} ${total === 1 ? "match" : "matches"}`
                : ""}
            </p>
            {query.trim() && total === 0 ? (
              <p className="text-sm text-muted-foreground">
                No giver matches “{query.trim()}”.
              </p>
            ) : (
              <ul className="-mx-1 grid gap-0.5" aria-label="People">
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
                            {["Giver", donorMeta(donor)]
                              .filter(Boolean)
                              .join(" · ")}
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

const Fact = ({ label, value }: { label: string; value: ReactNode }) => (
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
        <Fact
          label="Email"
          value={<EmailLink email={contactEmail(donor.email)} />}
        />
        <Fact
          label="Phone"
          value={<PhoneLink phone={contactPhone(donor.phone)} />}
        />
        <Fact label="Pattern" value={donorMeta(donor) || "—"} />
      </dl>
      <Saved donor={donor} live={live} />
      <Enrich donor={donor} live={live} onOpenRecord={onOpenRecord} />
    </>
  );
};

const box = enrichBox;

/** What's already on the profile: saved research facts and interest areas. */
const Saved = ({ donor, live }: { donor: DonorDetail; live: boolean }) => {
  const { data: interests } = usePersonInterests(donor.id);
  const labels = useTagLabels();
  const tags = interests ?? [];
  if (donor.research.length === 0 && tags.length === 0)
    return (
      <p className={cn(box, "text-muted-foreground")}>
        {!live
          ? "Nothing saved for this donor yet. Enrichment runs on the live service."
          : donor.donor_type === "organization"
            ? "Nothing saved yet. Enrich profile looks up public, professional sources."
            : "Nothing saved yet."}
      </p>
    );
  return (
    <div className={box}>
      <p className="font-semibold">On the profile</p>
      {tags.length > 0 && (
        <ul className="mt-1.5 flex flex-wrap gap-1.5" aria-label="Saved interest areas">
          {tags.map((interest) => (
            <InterestChip
              key={`${interest.tag}:${interest.sub_tag ?? ""}`}
              interest={interest}
              label={tagLabel(interest, labels)}
            />
          ))}
        </ul>
      )}
      {donor.research.length > 0 && (
        <ul className="mt-1.5 grid gap-1">
          {donor.research.map((fact) => (
            <li key={fact.id}>
              {fact.fact} <SourceLink href={fact.source_url} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

/** Enrich → review → Save to profile (organizations only); the flow lives in contacts/EnrichReview. */
const Enrich = ({
  donor,
  live,
  onOpenRecord,
}: {
  donor: DonorDetail;
  live: boolean;
  onOpenRecord: () => void;
}) => {
  const review = useEnrichReview(donor);
  const { isOrg, found, preview, accept, picked } = review;
  return (
    <>
      {live && !isOrg && <p className={cn(box, "text-muted-foreground")}>{ENRICH_COPY.individual}</p>}
      <EnrichProposal review={review} />
      <div className="flex flex-wrap gap-2">
        {live && isOrg && found ? (
          <button
            type="button"
            onClick={review.save}
            disabled={accept.isPending || picked === 0}
            className={cn(pill, "bg-primary text-primary-foreground hover:bg-primary/85")}
          >
            {accept.isPending && <Spinner />}
            {accept.isPending ? "Saving…" : "Save to profile"}
          </button>
        ) : (
          live &&
          isOrg && (
            <button
              type="button"
              onClick={review.run}
              disabled={preview.isPending}
              className={cn(pill, "bg-primary text-primary-foreground hover:bg-primary/85")}
            >
              {preview.isPending ? <Spinner /> : <Sparkles className="size-4" aria-hidden="true" />}
              {preview.isPending ? "Enriching…" : "Enrich profile"}
            </button>
          )
        )}
        <button
          type="button"
          onClick={onOpenRecord}
          className={cn(
            pill,
            live && isOrg ? "bg-surface hover:bg-accent" : "bg-primary text-primary-foreground hover:bg-primary/85",
          )}
        >
          Open full record
        </button>
      </div>
    </>
  );
};
