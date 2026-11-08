import { useMemo, useState } from "react";
import { CalendarPlus } from "lucide-react";
import { useSearchParams } from "react-router";

import { DonorDrawer } from "../contacts/DonorDrawer";
import { useCampaigns, useDonors, useTargets } from "../providers/local/hooks";
import { computeDayMarks } from "../outreach/calendarMonth";
import {
  formatDayShort,
  isIsoDate,
  monthOf,
  toIsoDate,
  type MonthRef,
} from "../outreach/dates";
import { DayPlanner } from "../outreach/DayPlanner";
import { MonthGrid, MonthLegend } from "../outreach/MonthGrid";
import { itemsOn, useOutreachPlan } from "../outreach/outreachPlan";
import { recommendOutreach } from "../outreach/recommend";
import {
  CampaignProgressCard,
  GlanceCard,
  GoalGaugeCard,
  RecommendedCard,
} from "./HomeCards";
import {
  draftsAwaiting,
  featuredCampaign,
  giveMiamiDay,
  goalEnds,
  greeting,
  needsCall,
  toRecCampaigns,
} from "./homeData";

/**
 * Home ("/"): today at a glance, the outreach-days calendar, the quarter goal,
 * campaign progress and the outreach agent's recommendations, laid out like
 * the Be.run dashboard in the Kindred look. `?plan=YYYY-MM-DD` (or
 * `?plan=today`) opens that day's outreach plan; the rail's Calendar icon uses it.
 */
export const HomePage = () => {
  const today = toIsoDate(new Date());
  const donors = useDonors();
  const targets = useTargets();
  const campaigns = useCampaigns();
  const plan = useOutreachPlan();
  const [params, setParams] = useSearchParams();
  const [month, setMonth] = useState<MonthRef>(() => monthOf(today));
  const [donorId, setDonorId] = useState<number | null>(null);

  const planParam = params.get("plan");
  const planDate =
    planParam === "today" ? today : isIsoDate(planParam) ? planParam : null;
  const openDay = (date: string | null) => {
    const next = new URLSearchParams(params);
    if (date) next.set("plan", date);
    else next.delete("plan");
    setParams(next, { replace: true });
  };

  const gmd = giveMiamiDay(targets.data, today);
  const campaignList = useMemo(() => campaigns.data ?? [], [campaigns.data]);

  const recommendations = useMemo(
    () =>
      recommendOutreach(donors.data ?? [], {
        today,
        plan: plan.items,
        campaigns: toRecCampaigns(campaignList),
        giveMiamiDay: gmd,
        limit: 6,
      }),
    [donors.data, today, plan.items, campaignList, gmd],
  );

  const marks = useMemo(
    () =>
      computeDayMarks({
        plan: plan.items,
        campaignEnds: goalEnds(targets.data),
        giveMiamiDay: gmd,
      }),
    [plan.items, targets.data, gmd],
  );

  const quarter = targets.data?.quarter;
  const todayCount = itemsOn(plan.items, today).filter((i) => !i.done).length;
  const dayNotes = (date: string) => [
    ...(date === gmd ? ["Give Miami Day"] : []),
    ...goalEnds(targets.data)
      .filter((end) => end.date === date)
      .map((end) => `${end.label} ends`),
  ];

  return (
    <div className="flex flex-col gap-6 pb-10">
      <header>
        <h1 className="text-2xl font-semibold tracking-[-0.8px] sm:text-3xl">
          {greeting(new Date().getHours())}
        </h1>
        <p className="text-sm text-muted-foreground">
          Here’s your outreach for {formatDayShort(today)}
          {todayCount > 0
            ? ` · ${todayCount} ${todayCount === 1 ? "person" : "people"} planned today`
            : ""}
          .
        </p>
      </header>

      <div className="grid gap-6 xl:grid-cols-12">
        <div className="xl:col-span-7">
          <GlanceCard
            isPending={
              donors.isPending || targets.isPending || campaigns.isPending
            }
            figures={{
              raised: quarter?.raised ?? null,
              raisedLabel: quarter?.label ?? null,
              needCall: donors.data
                ? donors.data.filter(needsCall).length
                : null,
              drafts: campaigns.data ? draftsAwaiting(campaigns.data) : null,
            }}
          />
        </div>

        <section
          aria-label="Outreach calendar"
          className="rounded-[24px] bg-primary p-5 text-primary-foreground sm:p-6 xl:col-span-5 dark:bg-card dark:text-card-foreground"
        >
          <MonthGrid
            title="Your outreach days"
            month={month}
            onMonthChange={setMonth}
            marks={marks}
            today={today}
            selected={planDate}
            onSelectDay={openDay}
          />
          <div className="mt-4 flex flex-wrap items-end justify-between gap-3">
            <MonthLegend />
            <button
              type="button"
              onClick={() => openDay(today)}
              className="inline-flex min-h-11 items-center gap-2 rounded-full bg-brand px-4 text-sm font-medium text-brand-foreground hover:bg-brand/85 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              <CalendarPlus className="size-4" aria-hidden="true" />
              Plan today
            </button>
          </div>
        </section>

        <div className="grid gap-6 md:grid-cols-2 xl:col-span-5 xl:grid-cols-1">
          <GoalGaugeCard target={quarter} isPending={targets.isPending} />
          <CampaignProgressCard
            campaign={featuredCampaign(campaignList)}
            isPending={campaigns.isPending}
          />
        </div>

        <div className="xl:col-span-7">
          <RecommendedCard
            recommendations={recommendations}
            isPending={donors.isPending}
            error={donors.error}
            onOpenDonor={setDonorId}
            onPlan={(rec) =>
              plan.add({
                date: rec.date,
                donor_id: rec.donor_id,
                campaign_id: rec.campaign_id,
                label: rec.label,
                note: rec.reason,
                source: "agent",
              })
            }
          />
        </div>
      </div>

      <DayPlanner
        date={planDate}
        onClose={() => openDay(null)}
        donors={(donors.data ?? [])
          .map((d) => ({ id: d.id, name: d.full_name }))
          .sort((a, b) => a.name.localeCompare(b.name))}
        campaigns={campaignList.map((c) => ({ id: c.id, name: c.name }))}
        recommendations={
          planDate
            ? recommendOutreach(donors.data ?? [], {
                today,
                plan: plan.items,
                campaigns: toRecCampaigns(campaignList),
                giveMiamiDay: gmd,
                limit: 12,
              })
            : []
        }
        dayNotes={planDate ? dayNotes(planDate) : []}
      />
      <DonorDrawer donorId={donorId} onClose={() => setDonorId(null)} />
    </div>
  );
};
