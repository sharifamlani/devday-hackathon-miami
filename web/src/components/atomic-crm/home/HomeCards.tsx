import { useId, useState } from "react";
import { ArrowRight, CalendarPlus, Send, Sparkles, Target } from "lucide-react";
import { Link } from "react-router";

import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { formatUsd } from "../contacts/donorFormat";
import type { CampaignSummary, DonationTarget } from "../providers/local/types";
import { formatDayShort } from "../outreach/dates";
import { AGENT_LABEL } from "../outreach/DayPlanner";
import type { Recommendation } from "../outreach/recommend";
import { campaignProgress, formatCompactUsd, initials } from "./homeData";

export const card = "rounded-[24px] bg-card p-5 shadow-sm sm:p-6";
const pill =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-full px-4 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

/* ---------- Hero: today at a glance ---------- */

export interface GlanceFigures {
  raised: number | null;
  raisedLabel: string | null; // "Q4 2026"
  needCall: number | null;
  drafts: number | null;
}

const Bubble = ({
  value,
  caption,
  className,
}: {
  value: string;
  caption: string;
  className: string;
}) => (
  <div
    className={cn(
      "absolute grid place-items-center rounded-full text-center shadow-[0_18px_40px_#24272814]",
      className,
    )}
  >
    <span className="px-2">
      <span className="block text-xl font-semibold tabular-nums sm:text-2xl">
        {value}
      </span>
      <span className="block text-[11px] font-medium">{caption}</span>
    </span>
  </div>
);

/**
 * Overlapping translucent bubbles in the Be.run style. They are decorative
 * (aria-hidden); the legend links and an sr-only sentence carry the figures.
 */
export const GlanceCard = ({
  figures,
  isPending,
}: {
  figures: GlanceFigures;
  isPending: boolean;
}) => {
  const headingId = useId();
  const show = (value: number | null, format: (n: number) => string) =>
    isPending || value == null ? "—" : format(value);
  const raised = show(figures.raised, formatCompactUsd);
  const needCall = show(figures.needCall, String);
  const drafts = show(figures.drafts, String);

  const legend = [
    {
      swatch: "bg-brand",
      label: `Raised ${figures.raisedLabel ? `in ${figures.raisedLabel}` : "this quarter"}`,
      value: raised,
      to: "/inbox",
    },
    {
      swatch: "bg-chart-3",
      label: "Donors needing a call",
      value: needCall,
      to: "/inbox?view=attention",
    },
    {
      swatch: "bg-primary",
      label: "Drafts awaiting approval",
      value: drafts,
      to: "/campaigns",
    },
  ];

  return (
    <section
      aria-labelledby={headingId}
      aria-busy={isPending}
      className="relative overflow-hidden rounded-[24px] bg-olive p-5 sm:p-6"
    >
      <h2 id={headingId} className="text-lg font-semibold tracking-[-0.3px]">
        Today at a glance
      </h2>
      <p className="text-sm text-muted-foreground">
        Gifts after merging duplicates · sample data
      </p>
      <p className="sr-only">
        {isPending
          ? "Loading today’s figures."
          : `${raised} raised ${figures.raisedLabel ? `in ${figures.raisedLabel}` : "this quarter"}, ${needCall} donors need a call, ${drafts} campaign drafts are waiting for approval.`}
      </p>
      <div className="mt-4 grid gap-6 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)] sm:items-end">
        <ul className="order-2 flex flex-col gap-1 sm:order-1">
          {legend.map((item) => (
            <li key={item.label}>
              <Link
                to={item.to}
                className="flex min-h-11 items-center gap-3 rounded-full pr-3 text-sm hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              >
                <span
                  aria-hidden="true"
                  className={cn("h-2.5 w-7 shrink-0 rounded-full", item.swatch)}
                />
                <span className="flex-1">{item.label}</span>
                <span className="font-semibold tabular-nums">{item.value}</span>
              </Link>
            </li>
          ))}
        </ul>
        <div
          aria-hidden="true"
          className="relative order-1 mx-auto h-[210px] w-full max-w-[320px] sm:order-2"
        >
          <Bubble
            value={raised}
            caption="raised"
            className="top-0 right-0 size-[170px] bg-brand/85 text-brand-foreground ring-8 ring-brand/30"
          />
          <Bubble
            value={needCall}
            caption="need a call"
            className="bottom-0 left-[12%] size-[120px] bg-chart-3/85 text-brand-foreground ring-8 ring-chart-3/25 mix-blend-multiply dark:mix-blend-normal"
          />
          <Bubble
            value={drafts}
            caption="drafts"
            className="top-[10%] left-[18%] size-[84px] bg-primary text-primary-foreground"
          />
        </div>
      </div>
    </section>
  );
};

/* ---------- Goal gauge ---------- */

const ARC = 2 * Math.PI * 52 * 0.75; // 270° of a r=52 circle

export const GoalGaugeCard = ({
  target,
  isPending,
}: {
  target: DonationTarget | undefined;
  isPending: boolean;
}) => {
  const headingId = useId();
  const percent = target?.percent ?? null;
  const filled = percent == null ? 0 : Math.min(percent, 100) / 100;
  return (
    <section
      aria-labelledby={headingId}
      className={cn(card, "flex flex-col gap-4")}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2
            id={headingId}
            className="text-lg font-semibold tracking-[-0.3px]"
          >
            {target ? `${target.label} goal` : "Quarter goal"}
          </h2>
          <p className="text-sm text-muted-foreground">Sample goal</p>
        </div>
        <span
          aria-hidden="true"
          className="grid size-9 place-items-center rounded-full bg-brand-soft text-brand-soft-foreground"
        >
          <Target className="size-4" />
        </span>
      </div>
      {isPending ? (
        <Skeleton className="mx-auto size-36 rounded-full" />
      ) : !target ? (
        <p className="text-sm text-muted-foreground">
          Goals aren’t in this data yet.
        </p>
      ) : (
        <div className="flex flex-wrap items-center gap-5">
          <div className="relative size-36 shrink-0">
            <svg
              viewBox="0 0 120 120"
              className="size-full -rotate-[225deg]"
              aria-hidden="true"
            >
              <circle
                cx="60"
                cy="60"
                r="52"
                fill="none"
                strokeWidth="12"
                strokeLinecap="round"
                className="stroke-quiet"
                strokeDasharray={`${ARC} 999`}
              />
              <circle
                cx="60"
                cy="60"
                r="52"
                fill="none"
                strokeWidth="12"
                strokeLinecap="round"
                className="stroke-brand"
                strokeDasharray={`${ARC * filled} 999`}
              />
            </svg>
            <div className="absolute inset-0 grid place-items-center text-center">
              <span>
                <span className="block text-3xl font-semibold tabular-nums">
                  {percent == null ? "—" : `${Math.round(percent)}%`}
                </span>
                <span className="block text-xs text-muted-foreground">
                  of goal
                </span>
              </span>
            </div>
          </div>
          <dl className="flex min-w-0 flex-col gap-2 text-sm">
            <div>
              <dt className="text-muted-foreground">Raised</dt>
              <dd className="text-lg font-semibold tabular-nums">
                {formatUsd(target.raised)}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Goal</dt>
              <dd className="font-medium tabular-nums">
                {formatUsd(target.goal)}
              </dd>
            </div>
            <div>
              <dt className="sr-only">Time left</dt>
              <dd className="rounded-full bg-quiet px-3 py-1 text-quiet-foreground">
                {target.days_left} {target.days_left === 1 ? "day" : "days"}{" "}
                left
              </dd>
            </div>
          </dl>
        </div>
      )}
    </section>
  );
};

/* ---------- Campaign progress ---------- */

export const CampaignProgressCard = ({
  campaign,
  isPending,
}: {
  campaign: CampaignSummary | null;
  isPending: boolean;
}) => {
  const headingId = useId();
  const progress = campaign ? campaignProgress(campaign) : null;
  return (
    <section
      aria-labelledby={headingId}
      className={cn(card, "flex flex-col gap-4")}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2
            id={headingId}
            className="text-lg font-semibold tracking-[-0.3px]"
          >
            Campaign progress
          </h2>
          <p className="truncate text-sm text-muted-foreground">
            {campaign ? campaign.name : "No campaign yet"}
          </p>
        </div>
        {progress && (
          <p className="text-right">
            <span className="block text-2xl font-semibold tabular-nums">
              {progress.percent}%
            </span>
            <span className="block text-xs text-muted-foreground">
              approved or sent
            </span>
          </p>
        )}
      </div>
      {isPending ? (
        <Skeleton className="h-3 w-full" />
      ) : !campaign || !progress ? (
        <Link
          to="/campaigns/new"
          className={cn(
            pill,
            "w-fit bg-primary text-primary-foreground hover:bg-primary/85",
          )}
        >
          <Send className="size-4" aria-hidden="true" />
          Start a campaign
        </Link>
      ) : (
        <>
          <div
            aria-hidden="true"
            className="flex h-3 overflow-hidden rounded-full bg-quiet"
          >
            {progress.total > 0 && (
              <>
                <span
                  className="bg-primary"
                  style={{
                    width: `${(progress.sent / progress.total) * 100}%`,
                  }}
                />
                <span
                  className="bg-brand"
                  style={{
                    width: `${(progress.approved / progress.total) * 100}%`,
                  }}
                />
              </>
            )}
          </div>
          <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
            <li className="flex items-center gap-1.5">
              <span
                aria-hidden="true"
                className="size-2.5 rounded-full bg-primary"
              />
              {progress.sent} sent
            </li>
            <li className="flex items-center gap-1.5">
              <span
                aria-hidden="true"
                className="size-2.5 rounded-full bg-brand"
              />
              {progress.approved} approved
            </li>
            <li className="flex items-center gap-1.5">
              <span
                aria-hidden="true"
                className="size-2.5 rounded-full border border-current"
              />
              {progress.draft} drafts
            </li>
            {progress.skipped > 0 && <li>{progress.skipped} skipped</li>}
          </ul>
          <Link
            to={`/campaigns/${campaign.id}`}
            className={cn(
              pill,
              "w-fit bg-quiet px-5 text-quiet-foreground hover:bg-accent",
            )}
          >
            Review campaign
            <span className="sr-only">: {campaign.name}</span>
            <ArrowRight className="size-4" aria-hidden="true" />
          </Link>
        </>
      )}
    </section>
  );
};

/* ---------- Recommended outreach ---------- */

const SEGMENTS = 10;

export const RecommendedCard = ({
  recommendations,
  isPending,
  error,
  onPlan,
  onOpenDonor,
}: {
  recommendations: Recommendation[];
  isPending: boolean;
  error: Error | null;
  onPlan: (rec: Recommendation) => boolean;
  onOpenDonor: (id: number) => void;
}) => {
  const headingId = useId();
  const [status, setStatus] = useState("");
  return (
    <section
      aria-labelledby={headingId}
      className={cn(card, "flex flex-col gap-4")}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2
            id={headingId}
            className="text-lg font-semibold tracking-[-0.3px]"
          >
            Recommended outreach
          </h2>
          <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <Sparkles className="size-4 shrink-0" aria-hidden="true" />
            {AGENT_LABEL}
          </p>
        </div>
        <Link
          to="/inbox"
          className={cn(pill, "bg-quiet text-quiet-foreground hover:bg-accent")}
        >
          Outreach inbox
          <ArrowRight className="size-4" aria-hidden="true" />
        </Link>
      </div>
      <p role="status" aria-live="polite" className="sr-only">
        {status}
      </p>
      {error ? (
        <p role="alert" className="text-sm text-alert-foreground">
          We couldn’t load donors for recommendations: {error.message}
        </p>
      ) : isPending ? (
        <div
          className="flex flex-col gap-2"
          aria-label="Loading recommendations"
        >
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-16 w-full rounded-2xl" />
          ))}
        </div>
      ) : recommendations.length === 0 ? (
        <p className="rounded-2xl bg-surface p-4 text-sm text-muted-foreground">
          Everyone who needs a call is already on your plan. Nice work.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {recommendations.map((rec) => {
            const filled = Math.max(
              1,
              Math.min(SEGMENTS, Math.round((rec.priority / 150) * SEGMENTS)),
            );
            return (
              <li
                key={rec.key}
                className="flex flex-col gap-3 rounded-2xl bg-surface p-3 sm:flex-row sm:items-center"
              >
                <div className="flex min-w-0 flex-1 items-center gap-3">
                  <span
                    aria-hidden="true"
                    className="grid size-10 shrink-0 place-items-center rounded-full bg-card text-xs font-semibold"
                  >
                    {rec.kind === "campaign" ? (
                      <Send className="size-4" />
                    ) : (
                      initials(rec.label)
                    )}
                  </span>
                  <div className="min-w-0">
                    {rec.donor_id != null ? (
                      <button
                        type="button"
                        onClick={() => onOpenDonor(rec.donor_id as number)}
                        data-donor-id={rec.donor_id}
                        className="text-left text-sm font-semibold hover:underline focus-visible:outline-2 focus-visible:outline-ring"
                      >
                        {rec.label}
                      </button>
                    ) : (
                      <Link
                        to={`/campaigns/${rec.campaign_id}`}
                        className="text-sm font-semibold hover:underline focus-visible:outline-2 focus-visible:outline-ring"
                      >
                        {rec.label}
                      </Link>
                    )}
                    <p className="text-xs text-muted-foreground">
                      {rec.reason}
                    </p>
                  </div>
                </div>
                <div className="flex items-center justify-between gap-3 sm:justify-end">
                  <span className="flex flex-col gap-1">
                    <span className="text-[11px] text-muted-foreground">
                      Priority
                      <span className="sr-only">
                        {" "}
                        {filled} of {SEGMENTS}
                      </span>
                    </span>
                    <span aria-hidden="true" className="flex gap-0.5">
                      {Array.from({ length: SEGMENTS }, (_, i) => (
                        <span
                          key={i}
                          className={cn(
                            "h-3 w-1.5 rounded-full",
                            i < filled ? "bg-chart-3" : "bg-quiet",
                          )}
                        />
                      ))}
                    </span>
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      const added = onPlan(rec);
                      setStatus(
                        added
                          ? `Planned ${rec.label} for ${formatDayShort(rec.date)}.`
                          : `${rec.label} is already planned for ${formatDayShort(rec.date)}.`,
                      );
                    }}
                    className={cn(
                      pill,
                      "shrink-0 bg-primary text-primary-foreground hover:bg-primary/85",
                    )}
                  >
                    <CalendarPlus className="size-4" aria-hidden="true" />
                    Plan for {formatDayShort(rec.date)}
                    <span className="sr-only">: {rec.label}</span>
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
};
