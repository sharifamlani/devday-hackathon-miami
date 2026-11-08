import { useMemo, useState } from "react";
import { useGetIdentity } from "ra-core";
import { useSearchParams } from "react-router";

import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { DonorDrawer } from "../contacts/DonorDrawer";
import { ImportDonorsDialog } from "../import/ImportDonorsDialog";
import { useEvents } from "../providers/local/crmHooks";
import { useCampaigns, useDonors, useTargets } from "../providers/local/hooks";
import { eventDays } from "../calendar/planLayer";
import { computeDayMarks } from "../outreach/calendarMonth";
import { isIsoDate, toIsoDate } from "../outreach/dates";
import { DayPlanner } from "../outreach/DayPlanner";
import { useOutreachPlan } from "../outreach/outreachPlan";
import { recommendOutreach } from "../outreach/recommend";
import { useCallNotes } from "../voice/callNotes";
import { FindDonorDialog } from "./FindDonorDialog";
import {
  ArtifactsTile,
  Q4ProgressTile,
  TasksTile,
  WeekTile,
} from "./HomeCards";
import { AgentThread, Composer, FocusTaskCard } from "./HomeChat";
import {
  agendaLines,
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
import "./dashboard.css";

/** White conversation canvas with a compact overview on the left.
 * Task actions remain available in a dialog selected from the project list.
 */
export const HomePage = () => {
  const today = toIsoDate(new Date());
  const { identity } = useGetIdentity();
  const donors = useDonors();
  const targets = useTargets();
  const campaigns = useCampaigns();
  const events = useEvents();
  const plan = useOutreachPlan();
  const notes = useCallNotes();
  const [params, setParams] = useSearchParams();
  const [donorId, setDonorId] = useState<number | null>(null);
  const [findOpen, setFindOpen] = useState(false);
  const [taskOpen, setTaskOpen] = useState(false);
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
    setTaskOpen(false);
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
    <div className="home-design @container h-full">
      <p role="status" aria-live="polite" className="sr-only">
        {status}
      </p>
      <div className="home-board">
        <aside aria-label="Workspace overview" className="home-overview">
          <Q4ProgressTile
            target={targets.data?.quarter}
            isPending={targets.isPending}
          />
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
            onSelect={(key) => {
              setSelectedKey(key);
              setTaskOpen(true);
            }}
            onPlan={() => openDay(today)}
            isPending={donors.isPending}
          />
          <ArtifactsTile notes={notes} campaigns={campaignList} />
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
          <Composer onUploadList={() => setImportOpen(true)} />
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
            onAction={() => setTaskOpen(false)}
            onDone={markDone}
            isPending={loading}
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
