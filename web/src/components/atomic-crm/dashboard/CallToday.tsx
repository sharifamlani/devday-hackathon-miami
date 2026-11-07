import { useId, useRef, useState } from "react";
import type { KeyboardEvent } from "react";

import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { DonorDrawer } from "../contacts/DonorDrawer";
import {
  formatMonthYear,
  formatUsd,
  scoreClass,
  statusClass,
  statusLabel,
  tierLabel,
} from "../contacts/donorFormat";
import { DuplicateBanner } from "../contacts/DuplicateMerge";
import { useDonors, useDuplicates } from "../providers/local/hooks";
import { CallTodayOverview } from "./CallTodayOverview";

type Filter = "all" | "lapsing" | "due" | "stars";

const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "lapsing", label: "Lapsing" },
  { id: "due", label: "Due" },
  { id: "stars", label: "Stars" },
];

const avatarTones = ["bg-olive", "bg-alert", "bg-good", "bg-quiet"];

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");

const focusRing =
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

/** Home screen: every donor, ranked by propensity score, highest first. */
export const CallToday = () => {
  const { data: donors, isPending, error } = useDonors();
  const { data: duplicates } = useDuplicates();
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const searchId = useId();
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const ranked = [...(donors ?? [])].sort((a, b) => b.score - a.score);
  const needCall = ranked.filter(
    (d) => d.status === "lapsing" || d.status === "due",
  ).length;
  const stars = ranked.filter((d) => d.is_star).length;
  const briefDonor = ranked.find((d) => d.is_star) ?? ranked[0];
  const nextSteps = ranked
    .filter(
      (d) =>
        d.id !== briefDonor?.id &&
        (d.status === "due" || d.status === "lapsing"),
    )
    .slice(0, 3);

  const needle = query.trim().toLowerCase();
  const rows = ranked
    .map((donor, index) => ({ donor, rank: index + 1 }))
    .filter(({ donor }) => {
      if (filter === "lapsing" && donor.status !== "lapsing") return false;
      if (filter === "due" && donor.status !== "due") return false;
      if (filter === "stars" && !donor.is_star) return false;
      return !needle || donor.full_name.toLowerCase().includes(needle);
    });

  const onTabKeyDown = (event: KeyboardEvent, index: number) => {
    let next = index;
    if (event.key === "ArrowRight") next = (index + 1) % FILTERS.length;
    else if (event.key === "ArrowLeft")
      next = (index - 1 + FILTERS.length) % FILTERS.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = FILTERS.length - 1;
    else return;
    event.preventDefault();
    setFilter(FILTERS[next].id);
    tabRefs.current[next]?.focus();
  };

  return (
    <div className="space-y-6 pt-2 max-md:px-4 max-md:pt-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          Philanthropy desk
        </p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight">
          Call today
        </h1>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          Ranked by propensity: recency, frequency, amount and the gap since
          each donor's usual gift. Click a donor to see why, research and a
          draft.
          <br />
          Start at the top; every draft stays a draft until you send it.
        </p>
      </div>

      <CallTodayOverview
        loading={isPending}
        total={ranked.length}
        needCall={needCall}
        stars={stars}
        duplicates={duplicates ? duplicates.length : null}
      />

      <DuplicateBanner />

      <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
        <section
          aria-labelledby={`${searchId}-title`}
          className="min-w-0 rounded-[24px] bg-card p-4 shadow-sm md:p-6"
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <h2 id={`${searchId}-title`} className="text-xl font-semibold">
                Ranked donors
              </h2>
              <span className="rounded-full bg-quiet px-2.5 py-0.5 text-sm font-medium tabular-nums text-quiet-foreground">
                {rows.length}
                <span className="sr-only"> shown</span>
              </span>
            </div>
            <div>
              <label htmlFor={searchId} className="sr-only">
                Search donors by name
              </label>
              <input
                id={searchId}
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search donors"
                className={cn(
                  "h-10 w-64 max-w-full rounded-full border-0 bg-surface px-4 text-sm placeholder:text-muted-foreground",
                  focusRing,
                )}
              />
            </div>
          </div>

          <div
            role="tablist"
            aria-label="Filter donors"
            className="mt-4 flex gap-5 border-b border-border"
          >
            {FILTERS.map((f, i) => {
              const active = filter === f.id;
              return (
                <button
                  key={f.id}
                  ref={(el) => {
                    tabRefs.current[i] = el;
                  }}
                  type="button"
                  role="tab"
                  id={`${searchId}-tab-${f.id}`}
                  aria-selected={active}
                  aria-controls={`${searchId}-panel`}
                  tabIndex={active ? 0 : -1}
                  onClick={() => setFilter(f.id)}
                  onKeyDown={(e) => onTabKeyDown(e, i)}
                  className={cn(
                    "-mb-px border-b-2 px-0.5 py-2 text-xs",
                    focusRing,
                    active
                      ? "border-primary font-semibold text-foreground"
                      : "border-transparent font-medium text-muted-foreground hover:text-foreground",
                  )}
                >
                  {f.label}
                </button>
              );
            })}
          </div>

          <div
            role="tabpanel"
            id={`${searchId}-panel`}
            aria-labelledby={`${searchId}-tab-${filter}`}
          >
            {error ? (
              <p role="alert" className="mt-4 text-sm text-destructive">
                Could not load donors: {error.message}
              </p>
            ) : isPending ? (
              <div className="mt-4 space-y-2">
                {Array.from({ length: 6 }, (_, i) => (
                  <Skeleton key={i} className="h-14 w-full" />
                ))}
              </div>
            ) : rows.length === 0 ? (
              <p className="mt-4 rounded-2xl bg-quiet p-6 text-center text-sm text-quiet-foreground">
                No donors match this filter.
              </p>
            ) : (
              <ul>
                {rows.map(({ donor, rank }) => (
                  <li
                    key={donor.id}
                    className="border-b border-border last:border-b-0"
                  >
                    <button
                      type="button"
                      data-donor-id={donor.id}
                      onClick={() => setSelectedId(donor.id)}
                      className="flex w-full items-center gap-3 px-1 py-3 text-left sm:gap-4 hover:bg-surface focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring md:px-2"
                    >
                      <span className="w-6 shrink-0 text-xs tabular-nums text-muted-foreground max-sm:sr-only">
                        <span className="sr-only">Rank </span>
                        {rank}
                      </span>
                      <span
                        aria-hidden="true"
                        className={cn(
                          "flex size-10 shrink-0 items-center justify-center rounded-full text-sm font-semibold",
                          avatarTones[(rank - 1) % avatarTones.length],
                        )}
                      >
                        {initials(donor.full_name)}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">
                          {donor.is_star && (
                            <span
                              className="mr-1 text-brand-soft-foreground"
                              role="img"
                              aria-label="Star donor"
                            >
                              ★
                            </span>
                          )}
                          {donor.full_name}
                        </span>
                        <span className="block truncate text-sm text-muted-foreground">
                          {donor.why_short}
                        </span>
                      </span>
                      <span className="flex shrink-0 flex-col-reverse items-end gap-1 sm:flex-row sm:items-center sm:gap-3">
                        <span
                          className={cn(
                            "rounded-full px-2.5 py-0.5 text-xs font-medium",
                            statusClass[donor.status],
                          )}
                        >
                          {statusLabel[donor.status]}
                        </span>
                        <span
                          className={cn(
                            "w-9 text-right text-lg font-bold tabular-nums",
                            scoreClass(donor.score),
                          )}
                        >
                          {donor.score}
                          <span className="sr-only"> score</span>
                        </span>
                        <span className="hidden w-28 text-right text-xs text-muted-foreground sm:block">
                          <span className="block">{tierLabel[donor.tier]}</span>
                          <span className="block">
                            {formatMonthYear(donor.last_gift_date)} ·{" "}
                            {formatUsd(donor.last_gift_amount)}
                          </span>
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

        <aside aria-label="Call support" className="space-y-4">
          {briefDonor && (
            <section
              aria-labelledby={`${searchId}-brief`}
              className="rounded-[24px] bg-primary p-6 text-primary-foreground"
            >
              <h2
                id={`${searchId}-brief`}
                className="text-xs font-semibold uppercase tracking-widest opacity-80"
              >
                Call brief
              </h2>
              <p className="mt-3 text-xl font-semibold">
                {briefDonor.is_star && (
                  <span
                    className="mr-1 text-brand"
                    role="img"
                    aria-label="Star donor"
                  >
                    ★
                  </span>
                )}
                {briefDonor.full_name}
              </p>
              <p className="mt-1 text-sm opacity-90">{briefDonor.why_short}</p>
              <p className="mt-3 text-sm opacity-90">
                Last gift {formatUsd(briefDonor.last_gift_amount)} ·{" "}
                {formatMonthYear(briefDonor.last_gift_date)}
              </p>
              <button
                type="button"
                onClick={() => setSelectedId(briefDonor.id)}
                className={cn(
                  "mt-5 w-full rounded-full bg-brand px-4 py-2.5 text-sm font-semibold text-brand-foreground hover:brightness-95",
                  focusRing,
                )}
              >
                Open call brief
              </button>
              <p className="mt-3 text-xs opacity-80">
                Drafts only. No call is placed.
              </p>
            </section>
          )}
          <section
            aria-labelledby={`${searchId}-next`}
            className="rounded-[24px] bg-card p-6 shadow-sm"
          >
            <h2 id={`${searchId}-next`} className="text-base font-semibold">
              Next steps
            </h2>
            {nextSteps.length === 0 ? (
              <p className="mt-3 text-sm text-muted-foreground">
                No other donors need a call right now.
              </p>
            ) : (
              <ul className="mt-2">
                {nextSteps.map((donor) => (
                  <li
                    key={donor.id}
                    className="border-b border-border last:border-b-0"
                  >
                    <button
                      type="button"
                      onClick={() => setSelectedId(donor.id)}
                      className="flex w-full items-center justify-between gap-3 py-2.5 text-left hover:bg-surface focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium">
                          {donor.full_name}
                        </span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {donor.why_short}
                        </span>
                      </span>
                      <span
                        className={cn(
                          "shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium",
                          statusClass[donor.status],
                        )}
                      >
                        {statusLabel[donor.status]}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </aside>
      </div>
      <DonorDrawer donorId={selectedId} onClose={() => setSelectedId(null)} />
    </div>
  );
};
