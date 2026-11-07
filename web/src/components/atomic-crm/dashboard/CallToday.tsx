import { useState } from "react";
import {
  ArrowRight,
  CalendarDays,
  CheckCircle2,
  Heart,
  Inbox,
  Search,
  ShieldCheck,
  Sparkles,
  Upload,
  Users,
  X,
} from "lucide-react";

import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ImportDonorsDialog } from "../import/ImportDonorsDialog";
import { DonorDrawer } from "../contacts/DonorDrawer";
import { DuplicateBanner } from "../contacts/DuplicateMerge";
import {
  formatMonthYear,
  formatUsd,
  scoreClass,
  statusClass,
  statusLabel,
  tierLabel,
} from "../contacts/donorFormat";
import { DATA_MODE } from "../providers/local/config";
import { useDonors, useSourceLabel } from "../providers/local/hooks";
import type { DonorSummary } from "../providers/local/types";
import { TargetsCard } from "./TargetsCard";
import "./donor-inbox.css";

type InboxFilter = "all" | "attention" | "due" | "on_track" | "stars";

const belongsTo = (donor: DonorSummary, filter: InboxFilter) =>
  filter === "all" ||
  (filter === "stars"
    ? donor.is_star
    : filter === "attention"
      ? donor.status === "lapsing" || donor.status === "lapsed"
      : donor.status === filter);

const filters = [
  { id: "all", label: "All outreach", icon: Inbox },
  { id: "attention", label: "Needs attention", icon: Heart },
  { id: "due", label: "Upcoming", icon: CalendarDays },
  { id: "on_track", label: "On track", icon: CheckCircle2 },
  { id: "stars", label: "Star donors", icon: Sparkles },
] as const;

/** Inbox presentation over the existing donor service; score and mutations stay in the shared layer. */
export const CallToday = () => {
  const { data: donors, isPending, error } = useDonors();
  const { data: sourceLabel } = useSourceLabel();
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [filter, setFilter] = useState<InboxFilter>("all");
  const [query, setQuery] = useState("");
  const [importOpen, setImportOpen] = useState(false);
  const ranked = [...(donors ?? [])].sort((a, b) => b.score - a.score);
  const search = query.trim().toLocaleLowerCase();
  const visible = ranked.filter(
    (donor) =>
      belongsTo(donor, filter) &&
      [donor.full_name, donor.email, donor.org_name]
        .filter(Boolean)
        .some((value) => value!.toLocaleLowerCase().includes(search)),
  );
  const selectedFilter = filters.find((item) => item.id === filter)!;
  const clearFilters = () => {
    setQuery("");
    setFilter("all");
  };

  return (
    <div className="donor-inbox">
      <header className="donor-inbox-welcome">
        <div>
          <p className="inbox-eyebrow">OUTREACH, WITH CARE</p>
          <h2>Every connection matters.</h2>
          <p>A thoughtful next step, grounded in each donor’s history.</p>
        </div>
        <div className="inbox-source">
          <ShieldCheck size={15} aria-hidden="true" />
          <span>
            <strong>SAMPLE DATA</strong>
            <span>
              {DATA_MODE === "local"
                ? "Live donor service"
                : `${sourceLabel ?? "Snapshot"} · changes stay in this tab`}
            </span>
          </span>
        </div>
      </header>

      <TargetsCard />

      <div className="donor-inbox-workspace">
        <aside className="inbox-folders" aria-label="Outreach views">
          <div className="inbox-workspace-name">
            <span className="inbox-workspace-icon">
              <Heart size={18} aria-hidden="true" />
            </span>
            <span>
              Donor Desk<small>The Miami Foundation</small>
            </span>
          </div>
          <p className="inbox-eyebrow">YOUR WORKSPACE</p>
          <div className="inbox-folder-list">
            {filters.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                type="button"
                className={cn("inbox-folder", filter === id && "is-active")}
                aria-pressed={filter === id}
                onClick={() => setFilter(id)}
              >
                <Icon size={18} aria-hidden="true" />
                <span>{label}</span>
                <b>{ranked.filter((donor) => belongsTo(donor, id)).length}</b>
              </button>
            ))}
          </div>
          <div className="inbox-sidebar-note">
            <Users size={19} aria-hidden="true" />
            <strong>The person behind the record.</strong>
            <p>
              Open a donor for their giving history, sourced research, and a
              draft you can review.
            </p>
          </div>
        </aside>

        <section
          className="inbox-main-panel"
          aria-label="Donor outreach inbox"
          aria-busy={isPending}
        >
          <header className="inbox-panel-heading">
            <div>
              <h3>
                Outreach inbox <span>{ranked.length}</span>
              </h3>
              <p>A small list. A meaningful difference.</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="inbox-priority-label">
                <Sparkles size={14} aria-hidden="true" />
                Priority order
              </span>
              <Button
                type="button"
                className="min-h-11 rounded-[28px] bg-primary px-5 text-xs font-medium text-primary-foreground hover:bg-primary/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                onClick={() => setImportOpen(true)}
              >
                <Upload />
                Import donors
              </Button>
            </div>
          </header>

          <div className="inbox-search">
            <Search size={18} aria-hidden="true" />
            <input
              type="search"
              aria-label="Search outreach donors"
              placeholder="Search people, email, or organization"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            {query && (
              <button
                type="button"
                aria-label="Clear donor search"
                onClick={() => setQuery("")}
              >
                <X size={16} />
              </button>
            )}
          </div>
          <div className="inbox-list-heading">
            <strong>{selectedFilter.label}</strong>
            <p role="status" aria-live="polite">
              {visible.length} of {ranked.length} people
            </p>
          </div>
          <div className="inbox-duplicate-slot">
            <DuplicateBanner />
          </div>

          {error ? (
            <div role="alert" className="inbox-empty text-destructive">
              <Inbox size={30} aria-hidden="true" />
              <h4>We couldn’t load your outreach list.</h4>
              <p>{error.message}</p>
            </div>
          ) : isPending ? (
            <div className="inbox-loading" aria-label="Loading donors">
              {Array.from({ length: 6 }, (_, index) => (
                <Skeleton key={index} className="h-20 w-full rounded-xl" />
              ))}
            </div>
          ) : visible.length === 0 ? (
            <div className="inbox-empty">
              <Inbox size={32} aria-hidden="true" />
              <h4>
                {query
                  ? "No matching people"
                  : "Nothing in this view right now"}
              </h4>
              <p>
                {query
                  ? "Try another name, email, or organization."
                  : "Choose another view to see the rest of your outreach list."}
              </p>
              {(query || filter !== "all") && (
                <button type="button" onClick={clearFilters}>
                  Show all outreach <ArrowRight size={15} aria-hidden="true" />
                </button>
              )}
            </div>
          ) : (
            <ul
              className="inbox-donor-list"
              aria-label="Donors ranked by priority"
            >
              {visible.map((donor) => (
                <li key={donor.id}>
                  <button
                    type="button"
                    className={cn(
                      "inbox-donor-row",
                      selectedId === donor.id && "is-selected",
                    )}
                    data-donor-id={donor.id}
                    aria-label={`Open ${donor.full_name}`}
                    aria-describedby={`donor-reason-${donor.id}`}
                    onClick={() => setSelectedId(donor.id)}
                  >
                    <span
                      className={cn(
                        "inbox-donor-avatar",
                        donor.donor_type === "organization" &&
                          "is-organization",
                      )}
                      aria-hidden="true"
                    >
                      {donor.full_name
                        .trim()
                        .split(/\s+/)
                        .slice(0, 2)
                        .map((name) => name[0])
                        .join("")}
                    </span>
                    <span className="inbox-donor-copy">
                      <span className="inbox-donor-name">
                        {donor.full_name}
                        {donor.is_star && (
                          <Sparkles
                            size={14}
                            className="inbox-star"
                            aria-label="Star donor"
                          />
                        )}
                      </span>
                      <span
                        id={`donor-reason-${donor.id}`}
                        className="inbox-donor-reason"
                      >
                        {donor.why_short}
                      </span>
                      <span className="inbox-donor-meta">
                        <span
                          className={cn(
                            "inbox-status",
                            statusClass[donor.status],
                          )}
                        >
                          {statusLabel[donor.status]}
                        </span>
                        <span>{tierLabel[donor.tier]} donor</span>
                        <span className="inbox-gift-summary">
                          Last gift {formatMonthYear(donor.last_gift_date)} ·{" "}
                          {formatUsd(donor.last_gift_amount)}
                        </span>
                        {donor.is_sample && (
                          <span className="inbox-sample-history">
                            Sample history
                          </span>
                        )}
                      </span>
                    </span>
                    <span
                      className="inbox-row-score"
                      aria-label={`Priority score ${donor.score} out of 100`}
                    >
                      <strong className={scoreClass(donor.score)}>
                        {donor.score}
                      </strong>
                      <small>priority</small>
                    </span>
                    <ArrowRight
                      size={17}
                      className="inbox-row-arrow"
                      aria-hidden="true"
                    />
                  </button>
                </li>
              ))}
            </ul>
          )}
          <footer className="inbox-panel-footer">
            <ShieldCheck size={14} aria-hidden="true" />
            <span>Human decisions. Complete donor context.</span>
            <span>Ranked by giving history</span>
          </footer>
        </section>
      </div>
      <ImportDonorsDialog open={importOpen} onOpenChange={setImportOpen} />
      <DonorDrawer donorId={selectedId} onClose={() => setSelectedId(null)} />
    </div>
  );
};
