import { useMemo, useState, type ReactNode, type ComponentType } from "react";
import { Link, useSearchParams } from "react-router";
import {
  BarChart3,
  CalendarDays,
  CheckSquare,
  ChevronRight,
  FileText,
  FolderOpen,
  House,
  PanelLeftClose,
  PanelLeftOpen,
  Users,
  X,
} from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { UserMenu } from "@/components/admin/user-menu";
import { cn } from "@/lib/utils";
import { AskSidebarTrigger, LiveTranscriptTrigger } from "../ask/AskSidebar";
import { DonorDrawer } from "../contacts/DonorDrawer";
import { ImportDonorsDialog } from "../import/ImportDonorsDialog";
import { RestartOnboardingMenuItem } from "../onboarding/RestartOnboardingMenuItem";
import { TaskDayPanel } from "./TaskDayPanel";
import { isIsoDate, toIsoDate } from "../outreach/dates";
import { DATA_MODE } from "../providers/local/config";
import { useDonors, useTargets } from "../providers/local/hooks";
import { useHomeData } from "../providers/local/homeFeed";
import { useCompleteTask } from "../providers/local/tasks";
import {
  ArtifactsTile,
  CrmTile,
  GlanceTile,
  Q4ProgressTile,
  TasksTile,
} from "./HomeCards";
import { FocusTaskCard } from "./HomeChat";
import { FindDonorDialog } from "./FindDonorDialog";
import { ProjectsTile } from "./ProjectsTile";
import { WeekCalendarTile } from "./WeekCalendarTile";
import {
  artifactRows,
  draftEmailHref,
  tasksFromApi,
  type HomeTask,
} from "./homeData";
import { OVERVIEW_ID, useOverview } from "./overviewContext";
import "./dashboard.css";
import "./workspace.css";

type SidebarItem = {
  id: string;
  label: string;
  icon: ComponentType<{ size?: number }>;
  content: ReactNode;
};

/** One persistent sidebar using Sharif's shared data hooks in live and snapshot modes. */
export const WorkspaceSidebar = () => {
  const overview = useOverview();
  const [active, setActive] = useState<string | null>(null);
  const targets = useTargets();
  // "Today" is the service's as-of date (the demo runs as of Nov 8), not this
  // browser's clock; the browser's date only holds until /targets answers.
  const today = targets.data?.quarter?.as_of ?? toIsoDate(new Date());
  const live = DATA_MODE === "local";
  const home = useHomeData(today);
  const donors = useDonors();
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

  const tasksPending = home.tasks.isPending;
  const closePopover = () => setActive(null);
  const panels: SidebarItem[] = [
    {
      id: "overview",
      label: "Overview",
      icon: BarChart3,
      content: (
        <>
          <Q4ProgressTile
            target={targets.data?.quarter}
            goal={targets.data?.quarter?.goal ?? null}
            goalIsSample={targets.data?.quarter?.goal_is_sample ?? false}
            isPending={targets.isPending}
          />
          <GlanceTile
            today={today}
            atRisk={summary?.gifts_at_risk ?? null}
            duplicates={summary?.duplicates ?? null}
            tasks={tasks.length}
            nextEvent={summary?.next_event ?? null}
            isPending={home.summary.isPending}
          />
        </>
      ),
    },
    {
      id: "calendar",
      label: "Calendar",
      icon: CalendarDays,
      content: (
        <>
          <WeekCalendarTile
            today={today}
            onOpenDay={(day) => {
              closePopover();
              openDay(day);
            }}
          />
          <Link
            className="desk-panel-link"
            to="/?workspace=calendar"
            onClick={closePopover}
          >
            Open full calendar <ChevronRight size={15} />
          </Link>
        </>
      ),
    },
    {
      id: "tasks",
      label: "Tasks",
      icon: CheckSquare,
      content: (
        <TasksTile
          tasks={tasks}
          hasData={hasData}
          live={live}
          selectedKey={focus?.key ?? null}
          onSelect={(key) => {
            setSelectedKey(key);
            closePopover();
            setTaskOpen(true);
          }}
          onPlan={() => {
            closePopover();
            openDay(today);
          }}
          isPending={tasksPending}
        />
      ),
    },
    {
      id: "crm",
      label: "CRM",
      icon: Users,
      content: (
        <>
          <div className="desk-crm-links">
            <Link to="/?workspace=donors" onClick={closePopover}>
              Donors <ChevronRight size={15} />
            </Link>
            <Link to="/?workspace=organizations" onClick={closePopover}>
              Organizations <ChevronRight size={15} />
            </Link>
          </div>
          <CrmTile
            people={home.attention.data ?? []}
            hasData={hasData}
            live={live}
            isPending={home.attention.isPending}
            error={home.attention.error}
            onFind={() => {
              closePopover();
              setFindOpen(true);
            }}
            onOpenDonor={(id) => {
              closePopover();
              setDonorId(id);
            }}
          />
        </>
      ),
    },
    {
      id: "projects",
      label: "Projects",
      icon: FolderOpen,
      content: <ProjectsTile />,
    },
    {
      id: "files",
      label: "Files & drafts",
      icon: FileText,
      content: <ArtifactsTile rows={artifacts} />,
    },
  ];
  return (
    <>
      {overview.open && (
        <button
          type="button"
          className="desk-sidebar-scrim"
          aria-label="Close expanded workspace sidebar"
          onClick={overview.toggle}
        />
      )}
      <aside
        className={cn("desk-sidebar", overview.open && "is-expanded")}
        aria-label="Workspace sidebar"
      >
        <nav className="desk-icon-rail" aria-label="Workspace tools">
          <button
            type="button"
            className="desk-sidebar-toggle"
            aria-label={
              overview.open
                ? "Collapse workspace sidebar"
                : "Expand workspace sidebar"
            }
            aria-expanded={overview.open}
            aria-controls={OVERVIEW_ID}
            onClick={() => {
              closePopover();
              overview.toggle();
            }}
          >
            {overview.open ? (
              <PanelLeftClose size={22} />
            ) : (
              <PanelLeftOpen size={22} />
            )}
          </button>
          <Link
            to="/"
            aria-label="Home chat"
            title="Home chat"
            className="desk-tool"
            onClick={closePopover}
          >
            <House size={20} />
          </Link>
          {panels.map(({ id, label, icon: Icon, content }) => (
            <Popover
              key={id}
              open={!overview.open && active === id}
              onOpenChange={(open) => setActive(open ? id : null)}
            >
              <PopoverTrigger
                render={
                  <button
                    type="button"
                    className={cn("desk-tool", active === id && "is-active")}
                    aria-label={label}
                    title={label}
                  />
                }
                onClick={() => {
                  if (overview.open)
                    document
                      .getElementById(`desk-section-${id}`)
                      ?.scrollIntoView({
                        block: "nearest",
                        behavior: "smooth",
                      });
                }}
              >
                <Icon size={20} />
              </PopoverTrigger>
              {!overview.open && (
                <PopoverContent
                  side="right"
                  align="start"
                  sideOffset={12}
                  className="desk-tool-popover"
                >
                  <div className="desk-popover-heading">
                    <strong>{label}</strong>
                    <button
                      type="button"
                      aria-label={`Close ${label}`}
                      onClick={closePopover}
                    >
                      <X size={17} />
                    </button>
                  </div>
                  <div className="desk-popover-body">{content}</div>
                </PopoverContent>
              )}
            </Popover>
          ))}
          <div className="desk-utilities">
            <LiveTranscriptTrigger className="size-10 border-0 bg-transparent shadow-none" />
            <AskSidebarTrigger className="size-10 border-0 bg-transparent shadow-none" />
            <UserMenu>
              <RestartOnboardingMenuItem />
            </UserMenu>
          </div>
        </nav>
        {overview.open && (
          <div id={OVERVIEW_ID} className="desk-sidebar-content">
            <div className="desk-sidebar-heading">
              <Link to="/">Your workspace</Link>
            </div>
            <div className="desk-sidebar-scroll">
              {panels.map(({ id, content }) => (
                <div
                  key={id}
                  id={`desk-section-${id}`}
                  className="desk-sidebar-section"
                >
                  {content}
                </div>
              ))}
            </div>
            <p
              className="desk-data-mode"
              title={
                live
                  ? "Uses the configured Python donor service"
                  : "Cached donor records; live actions require the Python service"
              }
            >
              {live ? "Local donor service" : "Cached workspace"}
            </p>
          </div>
        )}
      </aside>
      <p role="status" aria-live="polite" className="sr-only">
        {status}
      </p>
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
    </>
  );
};
