import { useMemo, useState } from "react";
import { useSearchParams } from "react-router";

import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";
import { DonorDrawer } from "../contacts/DonorDrawer";
import MobileHeader from "../layout/MobileHeader";
import { ImportDonorsDialog } from "../import/ImportDonorsDialog";
import {
  useOnboarding,
  useOnboardingQuarterGoal,
} from "../onboarding/onboardingState";
import {
  useCampaigns,
  useDonors,
  useOrgProfile,
  useTargets,
} from "../providers/local/hooks";
import { useHomeData } from "../providers/local/homeFeed";
import { useCompleteTask } from "../providers/local/tasks";
import { isIsoDate, toIsoDate } from "../outreach/dates";
import { DayPlanner } from "../outreach/DayPlanner";
import { useOutreachPlan } from "../outreach/outreachPlan";
import { recommendOutreach } from "../outreach/recommend";
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
  agendaFromCalendar,
  artifactRows,
  calendarMarks,
  draftEmailHref,
  firstName,
  giveMiamiDay,
  goalEnds,
  greeting,
  tasksFromApi,
  weekDays,
} from "./homeData";
import { tile } from "./tile";

/**
 * Board height at three columns: the viewport under the header and the
 * shell's 16px padding. Adjust here if the shell header changes height.
 */
const BOARD_HEIGHT = "@min-[1081px]:h-full";

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
  const isMobile = useIsMobile();
  const home = useHomeData(today);
  const donors = useDonors();
  const targets = useTargets();
  const campaigns = useCampaigns();
  const plan = useOutreachPlan();
  const profile = useOrgProfile();
  const onboarding = useOnboarding();
  const quarterGoal = useOnboardingQuarterGoal();
  const completeTask = useCompleteTask();
  const [params, setParams] = useSearchParams();
  const [donorId, setDonorId] = useState<number | null>(null);
  const [findOpen, setFindOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
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

  const summary = home.summary.data ?? null;
  const gmd = giveMiamiDay(targets.data, today);
  const donorList = useMemo(() => donors.data ?? [], [donors.data]);
  const campaignList = useMemo(() => campaigns.data ?? [], [campaigns.data]);
  const calendarItems = useMemo(
    () => home.calendar.data ?? [],
    [home.calendar.data],
  );
  // Nothing uploaded yet: the empty states say so instead of "all caught up".
  const hasData = !donors.isPending && donorList.length > 0;

  // The day planner's own suggestions (its plan lives in this browser).
  const recommend = (limit: number) =>
    recommendOutreach(donorList, {
      today,
      plan: plan.items,
      campaigns: campaignList
        .filter((c) => c.status === "draft")
        .map((c) => ({
          id: c.id,
          name: c.name,
          drafts: c.counts.draft,
          ends_on: null,
        })),
      giveMiamiDay: gmd,
      limit,
    });

  const tasks = useMemo(() => tasksFromApi(home.tasks.data), [home.tasks.data]);
  const focusIndex = Math.max(
    0,
    tasks.findIndex((t) => t.key === selectedKey),
  );
  const focus = tasks[focusIndex] ?? null;

  const marks = useMemo(
    () =>
      calendarMarks({
        items: calendarItems,
        campaignEnds: goalEnds(targets.data),
        giveMiamiDay: gmd,
      }),
    [calendarItems, targets.data, gmd],
  );
  const agenda = useMemo(
    () =>
      agendaFromCalendar({
        today,
        items: calendarItems,
        nextEvent: summary?.next_event,
      }),
    [today, calendarItems, summary?.next_event],
  );
  const artifacts = useMemo(
    () => artifactRows(home.artifacts.data),
    [home.artifacts.data],
  );

  const markDone = (task: (typeof tasks)[number]) => {
    completeTask.mutate(task.id, {
      onSuccess: () => {
        const next = tasks.filter((t) => t.key !== task.key)[0] ?? null;
        setSelectedKey(next?.key ?? null);
        setStatus(
          `Marked done: ${task.title}.${next ? ` Next: ${next.title}.` : ""}`,
        );
      },
      onError: (error) =>
        setStatus(`Couldn’t mark that done: ${error.message}`),
    });
  };

  const dayNotes = (date: string) => [
    ...(date === gmd ? ["Give Miami Day"] : []),
    ...goalEnds(targets.data)
      .filter((end) => end.date === date)
      .map((end) => `${end.label} ends`),
    ...calendarItems
      .filter(
        (item) => item.kind === "event" && item.date.slice(0, 10) === date,
      )
      .map((item) => item.title),
  ];

  // Staff name: the org profile's if it ever carries one, else what was typed
  // in onboarding; no name at all reads as a plain greeting.
  const staffName = (
    profile.data as { staff_name?: string | null } | null | undefined
  )?.staff_name;
  const name = firstName(staffName) ?? firstName(onboarding.data.personName);
  const summaryPending = home.summary.isPending;
  const tasksPending = home.tasks.isPending;

  return (
    <div className="@container h-full">
      {/* Phones have no desktop top bar: this one carries Live transcript,
          theme, Ask and the account menu (Restart tour, Log out). */}
      {isMobile && (
        <>
          <MobileHeader>
            <span className="truncate text-xl font-bold tracking-[-0.02em]">
              Donor Desk
            </span>
          </MobileHeader>
          <div className="h-14" aria-hidden="true" />
        </>
      )}
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
            goal={quarterGoal?.amount ?? null}
            reachedToday={summary ? summary.reached_today : null}
            isPending={targets.isPending}
          />
          <GlanceTile
            today={today}
            atRisk={summary ? summary.gifts_at_risk : null}
            duplicates={summary ? summary.duplicates : null}
            tasks={summary ? summary.tasks_today : null}
            nextEvent={
              summary?.next_event
                ? {
                    title: summary.next_event.title,
                    days: summary.next_event.days,
                  }
                : null
            }
            isPending={summaryPending}
          />
          <CrmTile
            people={home.attention.data ?? []}
            hasData={hasData}
            isPending={home.attention.isPending}
            error={home.attention.error}
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
              draftHref={focus ? draftEmailHref(focus) : null}
              onDone={markDone}
              isPending={tasksPending}
              hasData={hasData}
            />
          </div>
          <AgentThread />
          <Composer
            onUploadList={() => setImportOpen(true)}
            suggestions={
              summary?.suggestions?.length ? summary.suggestions : undefined
            }
          />
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
            hasData={hasData}
            selectedKey={focus?.key ?? null}
            onSelect={setSelectedKey}
            onPlan={() => openDay(today)}
            isPending={tasksPending}
          />
          <ArtifactsTile rows={artifacts} />
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
