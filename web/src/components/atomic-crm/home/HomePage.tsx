import { OVERVIEW_ID, useOverview } from "./overviewContext";
import { ProjectsTile } from "./ProjectsTile";
import { WeekCalendarTile } from "./WeekCalendarTile";
import { useMemo, useState } from "react";
import { useSearchParams } from "react-router";

import { DATA_MODE } from "../providers/local/config";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { DonorDrawer } from "../contacts/DonorDrawer";
import { ImportDonorsDialog } from "../import/ImportDonorsDialog";
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
import { useOutreachPlan } from "../outreach/usePlan";
import { recommendOutreach } from "../outreach/recommend";
import { FindDonorDialog } from "./FindDonorDialog";
import { ArtifactsTile, Q4ProgressTile, TasksTile } from "./HomeCards";
import { AgentThread, Composer, FocusTaskCard } from "./HomeChat";
import {
  artifactRows,
  draftEmailHref,
  firstName,
  giveMiamiDay,
  goalEnds,
  greeting,
  tasksFromApi,
  type HomeTask,
} from "./homeData";
import "./dashboard.css";

/** White conversation canvas with a compact overview on the left.
 * Task actions remain available in a dialog selected from the project list.
 */
export const HomePage = () => {
  const overview = useOverview();
  const targets = useTargets();
  // "Today" is the service's as-of date (the demo runs as of Nov 8), not this
  // browser's clock; the browser's date only holds until /targets answers.
  const today = targets.data?.quarter?.as_of ?? toIsoDate(new Date());
  const live = DATA_MODE === "local";
  const home = useHomeData(today);
  const donors = useDonors();
  const campaigns = useCampaigns();
  const plan = useOutreachPlan();
  const profile = useOrgProfile();
  const completeTask = useCompleteTask();
  const [params, setParams] = useSearchParams();
  const [donorId, setDonorId] = useState<number | null>(null);
  const [findOpen, setFindOpen] = useState(false);
  const [taskOpen, setTaskOpen] = useState(false);
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

  const artifacts = useMemo(
    () => artifactRows(home.artifacts.data),
    [home.artifacts.data],
  );

  const markDone = (task: HomeTask) => {
    completeTask.mutate(task.id, {
      onSuccess: () => {
        const next = tasks.filter((t) => t.key !== task.key)[0] ?? null;
        setSelectedKey(next?.key ?? null);
        setTaskOpen(false);
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

  // Staff name: the org profile's if it ever carries one; no name at all
  // reads as a plain greeting (onboarding no longer asks for one).
  const staffName = (
    profile.data as { staff_name?: string | null } | null | undefined
  )?.staff_name;
  const name = firstName(staffName);
  const tasksPending = home.tasks.isPending;

  return (
    <div className="home-design @container h-full">
      <p role="status" aria-live="polite" className="sr-only">
        {status}
      </p>
      <div
        className={
          overview.open ? "home-board" : "home-board home-overview-hidden"
        }
      >
        <aside
          id={OVERVIEW_ID}
          hidden={!overview.open}
          aria-label="Workspace overview"
          className="home-overview"
        >
          <Q4ProgressTile
            target={targets.data?.quarter}
            goal={targets.data?.quarter?.goal ?? null}
            goalIsSample={targets.data?.quarter?.goal_is_sample ?? false}
            isPending={targets.isPending}
          />
          <WeekCalendarTile today={today} onOpenDay={openDay} />
          <TasksTile
            tasks={tasks}
            hasData={hasData}
            live={live}
            selectedKey={focus?.key ?? null}
            onSelect={(key) => {
              setSelectedKey(key);
              setTaskOpen(true);
            }}
            onPlan={() => openDay(today)}
            isPending={tasksPending}
          />
          <ProjectsTile />
          <ArtifactsTile rows={artifacts} />
        </aside>

        {/* Center */}
        <section
          aria-label="Agent"
          data-tour="chat"
          className="home-conversation"
        >
          <div className="home-greeting">
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
          </div>
          <AgentThread />
          <Composer
            onUploadList={() => setImportOpen(true)}
            suggestions={
              summary?.suggestions?.length ? summary.suggestions : undefined
            }
          />
        </section>
      </div>
      <Dialog open={taskOpen && !!focus} onOpenChange={setTaskOpen}>
        <DialogContent className="home-task-dialog">
          <DialogTitle className="sr-only">Task details</DialogTitle>
          <DialogDescription className="sr-only">
            Review the task and choose your next action.
          </DialogDescription>
          <FocusTaskCard
            task={focus}
            index={focusIndex}
            total={tasks.length}
            draftHref={focus ? draftEmailHref(focus) : null}
            onAction={() => setTaskOpen(false)}
            onDone={markDone}
            isPending={tasksPending}
            hasData={hasData}
            live={live}
          />
        </DialogContent>
      </Dialog>

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
