import { OVERVIEW_ID, useOverview } from "./overviewContext";
import { AgendaList } from "./AgendaList";
import { TaskDayPanel } from "./TaskDayPanel";
import { useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";

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
  useDonors,
  useOrgContext,
  useOrgProfile,
  useTargets,
} from "../providers/local/hooks";
import { useHomeData } from "../providers/local/homeFeed";
import { useCompleteTask } from "../providers/local/tasks";
import { isIsoDate, toIsoDate } from "../outreach/dates";
import { FindDonorDialog } from "./FindDonorDialog";
import {
  ArtifactsTile,
  CrmTile,
  ImpactTile,
  Q4ProgressTile,
  TasksTile,
} from "./HomeCards";
import { AgentThread, Composer, FocusTaskCard } from "./HomeChat";
import { buildBriefing } from "./briefing";
import { DailyBriefing } from "./DailyBriefing";
import { sendToAgent, useAgentChat } from "./agentChat";
import { useAgentRefetch } from "../providers/local/refetch";
import { taskPrompt } from "./taskPrompt";
import {
  artifactRows,
  draftEmailHref,
  firstName,
  greeting,
  tasksFromApi,
  type HomeTask,
} from "./homeData";
import { CalendarPanel } from "./panels/CalendarPanel";
import { CrmPanel } from "./panels/CrmPanel";
import { ImpactPanel, listFacts, type ImpactFact } from "./panels/ImpactPanel";
import { TasksPanel } from "./panels/TasksPanel";
import {
  PanelFrame,
  PlaceholderPanel,
  PANEL_TITLES,
} from "./panels/PanelFrame";
import { useWorkspaceView } from "./workspaceView";
import "./dashboard.css";
import "./zoom.css";

/** White conversation canvas with a compact overview on the left.
 * Task actions remain available in a dialog selected from the project list.
 */
export const HomePage = () => {
  const overview = useOverview();
  const { view: panel, closeWorkspace } = useWorkspaceView();
  const targets = useTargets();
  const orgContext = useOrgContext();
  const impactFacts = useMemo(
    () => listFacts((orgContext.data?.facts ?? []) as ImpactFact[]).length,
    [orgContext.data],
  );
  // "Today" is the service's as-of date (the demo runs as of Nov 8), not this
  // browser's clock; the browser's date only holds until /targets answers.
  const today = targets.data?.quarter?.as_of ?? toIsoDate(new Date());
  const live = DATA_MODE === "local";
  const home = useHomeData(today);
  const donors = useDonors();
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
  const donorList = useMemo(() => donors.data ?? [], [donors.data]);
  // Nothing uploaded yet: the empty states say so instead of "all caught up".
  const hasData = !donors.isPending && donorList.length > 0;

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

  // A task click hands the task to the home agent, which loads it and does the next step
  // (service/chat_agent.py). The read-only snapshot has no agent: a click opens the details
  // instead (so does the info button).
  const agent = useAgentChat();
  const refetch = useAgentRefetch();
  const navigate = useNavigate();
  const openDetails = (key: string) => {
    setSelectedKey(key);
    setTaskOpen(true);
  };
  const workOn = (task: HomeTask) => {
    setSelectedKey(task.key);
    setTaskOpen(false);
    if (agent.pending) {
      setStatus("The agent is still working. Try the task again in a moment.");
      return;
    }
    navigate("/");
    void sendToAgent(taskPrompt(task), refetch);
    setStatus(`Handed to the agent: ${task.title}.`);
  };

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

  // Staff name: the org profile's if it ever carries one; no name at all
  // reads as a plain greeting (onboarding no longer asks for one).
  const staffName = (
    profile.data as { staff_name?: string | null } | null | undefined
  )?.staff_name;
  const name = firstName(staffName);
  const tasksPending = home.tasks.isPending;
  const briefing = hasData ? buildBriefing(summary, tasks) : null;
  const startTask = (key: string) => {
    const task = tasks.find((t) => t.key === key);
    if (live && task) workOn(task);
    else openDetails(key);
  };

  return (
    <div className="home-design @container h-full">
      <p role="status" aria-live="polite" className="sr-only">
        {status}
      </p>
      <div
        className={
          (overview.open ? "home-board" : "home-board home-overview-hidden") +
          (panel ? " has-panel" : "")
        }
      >
        <aside
          id={OVERVIEW_ID}
          hidden={!overview.open || !!panel}
          aria-label="Workspace overview"
          className="home-overview"
        >
          <Q4ProgressTile
            target={targets.data?.quarter}
            goal={targets.data?.quarter?.goal ?? null}
            goalIsSample={targets.data?.quarter?.goal_is_sample ?? false}
            isPending={targets.isPending}
          />
          <ImpactTile factCount={impactFacts} />
          <AgendaList today={today} onOpenDay={openDay} />
          <TasksTile
            tasks={tasks}
            hasData={hasData}
            live={live}
            selectedKey={focus?.key ?? null}
            onSelect={(key) => {
              const task = tasks.find((t) => t.key === key);
              if (live && task) workOn(task);
              else openDetails(key);
            }}
            onInfo={openDetails}
            agentLive={live}
            onPlan={() => openDay(today)}
            isPending={tasksPending}
          />
          <CrmTile
            people={home.attention.data ?? []}
            hasData={hasData}
            live={live}
            isPending={home.attention.isPending}
            error={home.attention.error}
            onFind={() => setFindOpen(true)}
            onOpenDonor={setDonorId}
          />
          <ArtifactsTile rows={artifacts} />
        </aside>

        {/* Center */}
        <section
          aria-label="Agent"
          data-tour="chat"
          className="home-conversation"
        >
          <div className="home-greeting">
            <h1 className="home-greeting-title">
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
          <AgentThread
            intro={
              briefing ? (
                <DailyBriefing briefing={briefing} onStartTask={startTask} />
              ) : undefined
            }
          />
          <Composer onUploadList={() => setImportOpen(true)} />
        </section>
        {panel && (
          <PanelFrame view={panel} onClose={closeWorkspace}>
            {panel === "crm" ? (
              <CrmPanel />
            ) : panel === "calendar" ? (
              <CalendarPanel />
            ) : panel === "tasks" ? (
              <TasksPanel
                tasks={home.tasks.data ?? []}
                today={today}
                live={live}
                isPending={tasksPending}
                onWork={(task) => {
                  if (live) workOn(task);
                  else openDetails(task.key);
                }}
                onInfo={openDetails}
                onAdd={() => openDay(today)}
              />
            ) : panel === "impact" ? (
              <ImpactPanel />
            ) : (
              <PlaceholderPanel title={PANEL_TITLES[panel]} />
            )}
          </PanelFrame>
        )}
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
            onWork={live ? workOn : undefined}
            isPending={tasksPending}
            hasData={hasData}
            live={live}
          />
        </DialogContent>
      </Dialog>

      <TaskDayPanel
        date={planDate}
        onClose={() => openDay(null)}
        donors={donorList
          .map((d) => ({ id: d.id, name: d.full_name }))
          .sort((a, b) => a.name.localeCompare(b.name))}
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
