import { useId, useState } from "react";
import { ArrowRight, CalendarHeart, Target } from "lucide-react";
import { Link } from "react-router";

import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { formatUsd } from "../contacts/donorFormat";
import { useTargets } from "../providers/local/hooks";
import type { DonationTarget, TargetPeriod } from "../providers/local/types";

const SEGMENTS = 12;
const PERIODS: { id: TargetPeriod; label: string }[] = [
  { id: "month", label: "Month" },
  { id: "quarter", label: "Quarter" },
];

const plural = (n: number, one: string, many: string) =>
  `${n} ${n === 1 ? one : many}`;

/** Thank-you flow entry: the campaigns screen (feat/campaigns) reads these params. */
const thankYouHref = (donorIds: number[]) =>
  `/campaigns/new?${new URLSearchParams({
    donors: donorIds.join(","),
    intent: "thank_you",
  }).toString()}`;

const formatPercent = (percent: number) =>
  `${Number.isInteger(percent) ? percent : percent.toFixed(1)}%`;

/** Decorative: the sr-only sentence next to it carries the meaning. */
const SegmentedBar = ({ percent }: { percent: number }) => {
  const filled = Math.min(SEGMENTS, Math.floor((percent / 100) * SEGMENTS));
  return (
    <div aria-hidden="true" className="flex gap-1">
      {Array.from({ length: SEGMENTS }, (_, i) => (
        <span
          key={i}
          className={cn(
            "h-2 flex-1 rounded-full",
            i < filled ? "bg-brand" : "bg-quiet",
          )}
        />
      ))}
    </div>
  );
};

const ChannelBreakdown = ({ target }: { target: DonationTarget }) => {
  const channels = target.by_channel.slice(0, 4);
  const largest = Math.max(...channels.map((c) => c.amount), 0);
  if (!channels.length) {
    return (
      <p className="text-sm text-muted-foreground">
        No gifts recorded yet this {target.period}.
      </p>
    );
  }
  return (
    <ul className="flex flex-col gap-3" aria-label="Raised by channel">
      {channels.map((c) => (
        <li key={c.channel} className="flex flex-col gap-1">
          <span className="flex items-baseline justify-between gap-3 text-sm">
            <span className="truncate">{c.channel}</span>
            <span className="font-semibold tabular-nums">
              {formatUsd(c.amount)}
            </span>
          </span>
          <span aria-hidden="true" className="h-1.5 rounded-full bg-quiet">
            <span
              className="block h-full rounded-full bg-brand"
              style={{
                width: `${largest > 0 ? Math.max(4, (c.amount / largest) * 100) : 0}%`,
              }}
            />
          </span>
        </li>
      ))}
    </ul>
  );
};

/**
 * Kindred metric card on the inbox: raised vs. SAMPLE goal for this month or
 * quarter (service/targets.py; nothing here is computed except bar widths).
 * "See who gave" opens the thank-you campaign for those donors.
 */
export const TargetsCard = () => {
  const { data, isPending, error } = useTargets();
  const [period, setPeriod] = useState<TargetPeriod>("quarter");
  const headingId = useId();
  const target = data?.[period];

  return (
    <section
      aria-labelledby={headingId}
      aria-busy={isPending}
      className="mb-6 rounded-[24px] bg-card p-5 shadow-sm sm:p-6"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <span
            aria-hidden="true"
            className="flex size-9 shrink-0 items-center justify-center rounded-full bg-brand-soft text-brand-soft-foreground"
          >
            <Target className="size-4" />
          </span>
          <div>
            <h3 id={headingId} className="text-base font-semibold">
              {target ? `${target.label} goal` : "Donation goal"}
            </h3>
            <p className="text-xs text-muted-foreground">
              Sample goal · gifts after merging duplicates
            </p>
          </div>
        </div>
        <div
          role="group"
          aria-label="Goal period"
          className="flex rounded-full bg-quiet p-1"
        >
          {PERIODS.map(({ id, label }) => (
            <button
              key={id}
              type="button"
              aria-pressed={period === id}
              onClick={() => setPeriod(id)}
              className={cn(
                "min-h-11 min-w-[88px] rounded-full px-4 text-sm font-medium transition-colors",
                period === id
                  ? "bg-primary text-primary-foreground"
                  : "text-quiet-foreground hover:bg-card",
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {error ? (
        <p role="alert" className="mt-4 text-sm text-alert-foreground">
          We couldn’t load the donation goal: {error.message}
        </p>
      ) : isPending ? (
        <div className="mt-5 flex flex-col gap-3" aria-label="Loading goal">
          <Skeleton className="h-10 w-64" />
          <Skeleton className="h-2 w-full" />
        </div>
      ) : !target ? (
        <p className="mt-4 text-sm text-muted-foreground">
          Goals aren’t in this data yet. Re-export the snapshot to include them.
        </p>
      ) : (
        <TargetBody target={target} />
      )}
    </section>
  );
};

const TargetBody = ({ target }: { target: DonationTarget }) => {
  const gmd = target.give_miami_day;
  const percent = target.percent ?? 0;
  const summary =
    target.goal != null
      ? `${formatUsd(target.raised)} raised of the ${formatUsd(target.goal)} sample goal for ${target.label}, ${formatPercent(percent)}.`
      : `${formatUsd(target.raised)} raised in ${target.label}. No goal is set.`;

  return (
    <div className="mt-5 grid gap-6 md:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      <div className="flex min-w-0 flex-col gap-4">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <p className="text-4xl font-semibold tabular-nums">
            {formatUsd(target.raised)}
          </p>
          {target.goal != null && (
            <p className="text-base text-muted-foreground">
              of {formatUsd(target.goal)}
            </p>
          )}
          {target.percent != null && (
            <p className="ml-auto text-2xl font-semibold tabular-nums">
              {formatPercent(target.percent)}
            </p>
          )}
        </div>
        <SegmentedBar percent={percent} />
        <p className="sr-only">{summary}</p>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="rounded-full bg-quiet px-3 py-1 text-quiet-foreground">
            {target.days_left === 0
              ? `Last day of ${target.label}`
              : `${plural(target.days_left, "day", "days")} left`}
          </span>
          {gmd && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-soft px-3 py-1 text-brand-soft-foreground">
              <CalendarHeart className="size-4" aria-hidden="true" />
              {gmd.days_until === 0
                ? "Give Miami Day is today"
                : `Give Miami Day in ${plural(gmd.days_until, "day", "days")}`}
            </span>
          )}
          <span className="text-muted-foreground">
            {plural(target.donors_count, "donor", "donors")} ·{" "}
            {plural(target.gifts_count, "gift", "gifts")} ·{" "}
            {target.new_donors} new, {target.returning_donors} returning
          </span>
        </div>
        {target.donor_ids.length > 0 ? (
          <Link
            to={thankYouHref(target.donor_ids)}
            className="inline-flex min-h-11 w-fit items-center gap-2 rounded-full bg-primary px-5 text-sm font-medium text-primary-foreground outline-none hover:bg-primary/85 focus-visible:ring-3 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            See who gave
            <span className="sr-only">
              {" "}
              in {target.label} and thank them
            </span>
            <ArrowRight className="size-4" aria-hidden="true" />
          </Link>
        ) : (
          <p className="text-sm text-muted-foreground">
            No one has given yet this {target.period}.
          </p>
        )}
      </div>
      <div className="min-w-0 rounded-[18px] bg-surface p-4">
        <p className="mb-3 text-xs font-semibold tracking-wide text-muted-foreground">
          BY CHANNEL
        </p>
        <ChannelBreakdown target={target} />
      </div>
    </div>
  );
};
