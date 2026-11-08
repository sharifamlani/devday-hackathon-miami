import { useMemo, useState } from "react";
import { useGetIdentity } from "ra-core";
import { useSearchParams } from "react-router";

import { cn } from "@/lib/utils";
import { DonorDrawer } from "../contacts/DonorDrawer";
import { ImportDonorsDialog } from "../import/ImportDonorsDialog";
import { useEvents } from "../providers/local/crmHooks";
import {
  useCampaigns,
  useDonors,
  useDuplicates,
  useTargets,
} from "../providers/local/hooks";
import { eventDays } from "../calendar/planLayer";
import { computeDayMarks } from "../outreach/calendarMonth";
import { daysBetween, isIsoDate, toIsoDate } from "../outreach/dates";
import { DayPlanner } from "../outreach/DayPlanner";
import { useOutreachPlan } from "../outreach/outreachPlan";
import { recommendOutreach } from "../outreach/recommend";
import { useCallNotes } from "../voice/callNotes";
import { FindDonorDialog } from "./FindDonorDialog";
import {
  ArtifactsTile,
  CrmTile,
  GlanceTile,
  Q4ProgressTile,
  TasksTile,
  WeekTile,
} from "./HomeCards";
import { AgentThread, Composer, FocusTaskCard } from "./HomeChat";
import {
  agendaLines,
  attentionDonors,
  buildTasks,
  donorFacts,
  draftEmailHref,
  firstName,
  giveMiamiDay,
  goalEnds,
  greeting,
  toRecCampaigns,
  weekDays,
  type HomeTask,
} from "./homeData";
import { tile } from "./tile";

/**
 * Board height at three columns: the viewport under the header and the
 * shell's 16px padding. Adjust here if the shell header changes height.
 */
const BOARD_HEIGHT = "@min-[1081px]:h-[calc(100dvh-6.5rem)]";

/**
 * Home ("/"): a three-column board. Left: quarter progress, today at a
 * glance and the CRM tile. Center: the focused task and a chat with the
 * agent (the shared Ask session). Right: this week, today's tasks and
 * artifacts. It drops to two columns when the side panels squeeze it and to
 * one on phones. `?plan=YYYY-MM-DD` (or `?plan=today`) opens that day's
 * outreach plan; the full calendar is /calendar.
 */
export const HomePage = () => {
  const today = toIsoDate(new Date());
  const { identity } = useGetIdentity();
  const donors = useDonors();
  const duplicates = useDuplicates();
  const targets = useTargets();
  const campaigns = useCampaigns();
  const events = useEvents();
  const plan = useOutreachPlan();
  const notes = useCallNotes();
  const [params, setParams] = useSearchParams();
  const [donorId, setDonorId] = useState<number | null>(null);
  const [findOpen, setFindOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [status, setStatus] = useState("");

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
  const donorList = useMemo(() => donors.data ?? [], [donors.data]);
  const campaignList = useMemo(() => campaigns.data ?? [], [campaigns.data]);
  const eventList = useMemo(() => eventDays(events.data ?? []), [events.data]);
  const donorById = useMemo(
    () => new Map(donorList.map((d) => [d.id, d])),
    [donorList],
  );

  const recommend = (limit: number) =>
    recommendOutreach(donorList, {
      today,
      plan: plan.items,
      campaigns: toRecCampaigns(campaignList),
      giveMiamiDay: gmd,
      limit,
    });
  const recommendations = useMemo(
    () => recommend(6),
    // recommend reads exactly these
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [donorList, today, plan.items, campaignList, gmd],
  );

  const tasks = useMemo(
    () =>
      buildTasks({
        today,
        plan: plan.items,
        recommendations,
        donors: donorList,
        dismissed,
      }),
    [today, plan.items, recommendations, donorList, dismissed],
  );
  const focusIndex = Math.max(
    0,
    tasks.findIndex((t) => t.key === selectedKey),
  );
  const focus = tasks[focusIndex] ?? null;

  const marks = useMemo(
    () =>
      computeDayMarks({
        plan: plan.items,
        campaignEnds: goalEnds(targets.data),
        events: eventList,
        giveMiamiDay: gmd,
      }),
    [plan.items, targets.data, eventList, gmd],
  );
  const agenda = useMemo(
    () =>
      agendaLines({
        today,
        events: eventList,
        plan: plan.items,
        giveMiamiDay: gmd,
      }),
    [today, eventList, plan.items, gmd],
  );

  const focusFacts = (task: HomeTask | null): string[] => {
    if (!task) return [];
    if (task.donorId != null) {
      const donor = donorById.get(task.donorId);
      return donor ? donorFacts(donor) : [];
    }
    const campaign = campaignList.find((c) => c.id === task.campaignId);
    return campaign
      ? [
          `${campaign.counts.draft} ${campaign.counts.draft === 1 ? "draft" : "drafts"} waiting`,
          `${campaign.counts.total} recipients`,
        ]
      : [];
  };

  const markDone = (task: HomeTask) => {
    if (task.planItemId) plan.update(task.planItemId, { done: true });
    else setDismissed((prev) => new Set(prev).add(task.key));
    const next = tasks.filter((t) => t.key !== task.key)[0] ?? null;
    setSelectedKey(next?.key ?? null);
    setStatus(
      `Marked done: ${task.title}.${next ? ` Next: ${next.title}.` : ""}`,
    );
  };

  const dayNotes = (date: string) => [
    ...(date === gmd ? ["Give Miami Day"] : []),
    ...goalEnds(targets.data)
      .filter((end) => end.date === date)
      .map((end) => `${end.label} ends`),
    ...eventList.filter((e) => e.date === date).map((e) => e.label),
  ];

  const name = firstName(identity?.fullName);
  const loading = donors.isPending || targets.isPending;

  return (
    <div className="@container">
      <p role="status" aria-live="polite" className="sr-only">
        {status}
      </p>
      <div
        className={cn(
          "grid grid-cols-1 gap-3",
          "@min-[721px]:grid-cols-[252px_minmax(0,1fr)]",
          "@min-[1081px]:min-h-[600px] @min-[1081px]:grid-cols-[264px_minmax(0,1fr)_286px]",
          BOARD_HEIGHT,
        )}
      >
        {/* Left */}
        <div className="order-2 flex min-h-0 flex-col gap-3 @min-[721px]:order-none">
          <Q4ProgressTile
            target={targets.data?.quarter}
            isPending={targets.isPending}
          />
          <GlanceTile
            today={today}
            atRisk={
              donors.data
                ? donors.data.filter((d) => d.status === "lapsing").length
                : null
            }
            duplicates={duplicates.data ? duplicates.data.length : null}
            tasks={tasks.length}
            gmdDays={Math.max(0, daysBetween(today, gmd))}
            isPending={loading}
          />
          <CrmTile
            donors={attentionDonors(donorList)}
            isPending={donors.isPending}
            error={donors.error}
            onFind={() => setFindOpen(true)}
            onOpenDonor={setDonorId}
          />
        </div>

        {/* Center */}
        <section
          aria-label="Focus and agent"
          className={cn(
            tile,
            "order-1 flex min-h-[560px] flex-col @min-[721px]:order-none",
            "@min-[721px]:h-[calc(100dvh-6.5rem)] @min-[1081px]:h-auto @min-[1081px]:min-h-0",
          )}
        >
          <div className="px-[22px] pt-5">
            <h1 className="mb-3.5 text-[28px] leading-tight font-normal tracking-[-0.02em]">
              {greeting(new Date().getHours())}
              {name ? (
                <>
                  , <b className="font-bold">{name}.</b>
                </>
              ) : (
                "."
              )}
            </h1>
            <FocusTaskCard
              task={focus}
              index={focusIndex}
              total={tasks.length}
              facts={focusFacts(focus)}
              draftHref={
                focus
                  ? draftEmailHref(
                      focus,
                      focus.donorId != null
                        ? donorById.get(focus.donorId)
                        : undefined,
                    )
                  : null
              }
              onDone={markDone}
              isPending={loading}
            />
          </div>
          <AgentThread />
          <Composer onUploadList={() => setImportOpen(true)} />
        </section>

        {/* Right */}
        <div
          className={cn(
            "order-3 flex min-h-0 flex-col gap-3",
            "@min-[721px]:order-none @min-[721px]:col-span-full @min-[721px]:grid @min-[721px]:grid-cols-3 @min-[721px]:items-start",
            "@min-[1081px]:col-span-1 @min-[1081px]:flex @min-[1081px]:items-stretch",
          )}
        >
          <WeekTile
            today={today}
            days={weekDays(today)}
            marks={marks}
            agenda={agenda}
            onOpenDay={openDay}
          />
          <TasksTile
            tasks={tasks}
            selectedKey={focus?.key ?? null}
            onSelect={setSelectedKey}
            onPlan={() => openDay(today)}
            isPending={donors.isPending}
          />
          <ArtifactsTile notes={notes} campaigns={campaignList} />
        </div>
      </div>

      <DayPlanner
        date={planDate}
        onClose={() => openDay(null)}
        donors={donorList
          .map((d) => ({ id: d.id, name: d.full_name }))
          .sort((a, b) => a.name.localeCompare(b.name))}
        campaigns={campaignList.map((c) => ({ id: c.id, name: c.name }))}
        recommendations={planDate ? recommend(12) : []}
        dayNotes={planDate ? dayNotes(planDate) : []}
      />
      <FindDonorDialog
        open={findOpen}
        onOpenChange={setFindOpen}
        donors={donorList}
        onOpenRecord={setDonorId}
      />
      <ImportDonorsDialog open={importOpen} onOpenChange={setImportOpen} />
      <DonorDrawer donorId={donorId} onClose={() => setDonorId(null)} />
    </div>
  );
};
