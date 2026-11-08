import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Calendar,
  dateFnsLocalizer,
  type Event as RbcEvent,
} from "react-big-calendar";
import { format, getDay, parse, startOfWeek } from "date-fns";
import { enUS } from "date-fns/locale/en-US";
import {
  CalendarCheck,
  CalendarDays,
  ExternalLink,
  MapPin,
} from "lucide-react";
import "react-big-calendar/lib/css/react-big-calendar.css";

import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

import {
  useContextStatus,
  useEvent,
  useEvents,
} from "../providers/local/crmHooks";
import { useDonors, useTargets } from "../providers/local/hooks";
import { useCalendarFeed } from "../providers/local/calendarFeed";
import { DATA_MODE } from "../providers/local/config";
import { TABS, TAB_LABELS } from "../providers/local/crmTypes";
import type {
  CrmEvent,
  CrmEventDetail,
  Tab,
} from "../providers/local/crmTypes";
import { calendarMarks } from "../home/homeData";
import {
  addDays,
  formatDayShort,
  fromIsoDate,
  monthOf,
  toIsoDate,
} from "../outreach/dates";
import { DayPlanner } from "../outreach/DayPlanner";
import { recommendOutreach } from "../outreach/recommend";
import type { OutreachPlanItem } from "../outreach/outreachPlan";
import { useOutreachPlan } from "../outreach/usePlan";
import {
  countByTab,
  placeable,
  sortByStart,
  usePlanEventOutreach,
} from "./calendarData";
import {
  FAMILIES,
  FAMILY_COLORS,
  FAMILY_LABELS,
  PLAN_COLORS,
  PLAN_LABEL,
  kindInfo,
  type Family,
} from "./eventKinds";
import {
  campaignEndsFrom,
  giveMiamiDayFrom,
  mergeAgenda,
  taskCalendarEntries,
  taskOrigin,
  tasksFromFeed,
  tasksFromPlan,
  type CalTask,
} from "./planLayer";
import { PlannerCard } from "./PlannerCard";
import "./calendar.css";

// react-big-calendar (MIT) with date-fns, which the app already ships.
// Weeks start on Monday, like the planner grid.
const localizer = dateFnsLocalizer({
  format,
  parse,
  startOfWeek: (date: Date) => startOfWeek(date, { weekStartsOn: 1 }),
  getDay,
  locales: { "en-US": enUS },
});

const when = (iso: string) =>
  new Date(iso).toLocaleString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

interface CalEvent extends RbcEvent {
  id: number | string;
  family: Family | "plan";
  /** Set for dated tasks (live: GET /calendar; snapshot build: the local plan). */
  task?: CalTask;
}

const FamilyBadge = ({ family }: { family: Family }) => (
  <span
    className="rounded-full px-2.5 py-0.5 text-[12px] font-medium"
    style={{
      background: FAMILY_COLORS[family].bg,
      color: FAMILY_COLORS[family].fg,
    }}
  >
    {FAMILY_LABELS[family]}
  </span>
);

const chip =
  "inline-flex min-h-11 items-center gap-2 rounded-full border border-border px-4 text-[13px] font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

/** How often the screen re-reads tasks, so work the agent adds appears without a reload. */
const REFRESH_MS = 4000;

/**
 * Live mode: re-read tasks and the calendar feed while this screen is open and
 * visible. The chat panel refetches after its own writes (useAgentRefetch);
 * this covers any other writer (the agent in another tab, a teammate, the
 * generator).
 */
const useLiveTaskRefresh = () => {
  const queryClient = useQueryClient();
  useEffect(() => {
    if (DATA_MODE !== "local") return;
    const timer = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      for (const key of ["tasks", "calendar", "home-summary"])
        void queryClient.invalidateQueries({ queryKey: ["donor-desk", key] });
    }, REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [queryClient]);
};

/**
 * Event calendar: a month grid and an agenda list of the org's upcoming
 * events. Events come from the events agent (useEvents) and are read-only; we
 * never invent any. Alongside them, dated tasks from GET /calendar (the same
 * tasks the agent creates and edits): click one to open it, tick it done
 * (PATCH /tasks/{id}); pick a day to add donors, take the outreach agent's
 * recommendations (each becomes a real task). `onOpenBatch` lets the host open its chat panel on a batch
 * id; without it the batch id is shown in the side panel.
 */
export const CalendarPage = ({
  onOpenBatch,
}: {
  onOpenBatch?: (batchId: string) => void;
}) => {
  const { data, isPending, error } = useEvents();
  const status = useContextStatus();
  const donors = useDonors();
  const plan = useOutreachPlan();
  useLiveTaskRefresh();
  // "Today" is the service's as-of date (the demo runs as of Nov 8), like the home board.
  const targets = useTargets();
  const today = targets.data?.quarter?.as_of ?? toIsoDate(new Date());
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [taskId, setTaskId] = useState<string | null>(null);
  const [planDate, setPlanDate] = useState<string | null>(null);
  const [date, setDate] = useState<Date | null>(null);

  const [hidden, setHidden] = useState<Family[]>([]);
  const [showPlan, setShowPlan] = useState(true);
  const allEvents = useMemo(() => sortByStart(placeable(data ?? [])), [data]);
  const events = useMemo(
    () => allEvents.filter((e) => !hidden.includes(kindInfo(e).family)),
    [allEvents, hidden],
  );
  // Open on the month of the next event, not an empty current month.
  const firstEvent = allEvents[0] ? new Date(allEvents[0].starts_at) : null;
  const shownDate = date ?? firstEvent ?? new Date();
  const shownMonth = monthOf(toIsoDate(shownDate));

  // Dated tasks around the month on screen (a week either side for the grid's edges).
  const monthStart = toIsoDate(new Date(shownMonth.year, shownMonth.month, 1));
  const monthEnd = toIsoDate(
    new Date(shownMonth.year, shownMonth.month + 1, 0),
  );
  const feed = useCalendarFeed(addDays(monthStart, -7), addDays(monthEnd, 7));
  const tasks: CalTask[] = useMemo(
    () =>
      DATA_MODE === "local"
        ? tasksFromFeed(feed.data ?? [])
        : tasksFromPlan(plan.items),
    [feed.data, plan.items],
  );

  const calEvents: CalEvent[] = useMemo(
    () => [
      ...events.map((e) => ({
        id: e.id,
        family: kindInfo(e).family,
        title: e.title,
        start: new Date(e.starts_at),
        end: e.ends_at ? new Date(e.ends_at) : new Date(e.starts_at),
        allDay: !e.ends_at,
      })),
      ...(showPlan
        ? taskCalendarEntries(tasks).map((entry) => ({
            ...entry,
            family: "plan" as const,
          }))
        : []),
    ],
    [events, tasks, showPlan],
  );

  const gmd = giveMiamiDayFrom(allEvents, today);
  const marks = useMemo(
    () =>
      calendarMarks({
        items: [
          ...events.map((e) => ({
            date: e.starts_at.slice(0, 10),
            time: null,
            title: e.title,
            kind: "event" as const,
            source: null,
            ref: e.id,
          })),
          ...(showPlan
            ? tasks.map((t) => ({
                date: t.date,
                time: t.time,
                title: t.title,
                kind: "task" as const,
                source: t.source,
                ref: t.id,
                done: t.done,
              }))
            : []),
        ],
        campaignEnds: campaignEndsFrom(allEvents),
        giveMiamiDay: gmd,
      }),
    [tasks, showPlan, events, allEvents, gmd],
  );
  const recommendations = useMemo(
    () =>
      recommendOutreach(donors.data ?? [], {
        today,
        plan: plan.items,
        giveMiamiDay: gmd,
        limit: 12,
      }),
    [donors.data, today, plan.items, gmd],
  );
  const dayNotes = (day: string) => [
    ...(day === gmd ? ["Give Miami Day"] : []),
    ...allEvents
      .filter((e) => e.starts_at.slice(0, 10) === day)
      .map((e) => e.title),
  ];

  return (
    <section
      aria-labelledby="calendar-title"
      className="@container space-y-5 pb-8"
    >
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1
            id="calendar-title"
            className="text-2xl font-semibold tracking-[-0.8px] sm:text-3xl"
          >
            Calendar
          </h1>
          <p className="text-sm text-muted-foreground">
            The Foundation’s events and your tasks, side by side.
          </p>
        </div>
        {status.data?.label ? (
          <p className="rounded-full bg-quiet px-3 py-1.5 text-[13px] text-quiet-foreground">
            {status.data.label}
          </p>
        ) : null}
      </div>

      {isPending ? (
        <p role="status" className="text-sm text-muted-foreground">
          Loading events…
        </p>
      ) : error ? (
        <p role="alert" className="text-sm text-alert-foreground">
          Could not load events.
        </p>
      ) : allEvents.length === 0 ? (
        <div
          className="rounded-[24px] bg-card p-8 text-center shadow-sm"
          data-testid="calendar-empty"
        >
          <CalendarDays
            className="mx-auto mb-2 size-6 text-muted-foreground"
            aria-hidden
          />
          <p className="font-medium">
            No upcoming events found yet. Run context refresh.
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            You can still plan outreach by day below.
          </p>
        </div>
      ) : null}

      {!isPending && !error ? (
        <>
          <div
            role="group"
            aria-label="Filter by event type"
            className="flex flex-wrap gap-2"
          >
            {allEvents.length > 0 &&
              FAMILIES.map((f) => {
                const on = !hidden.includes(f);
                return (
                  <button
                    key={f}
                    type="button"
                    aria-pressed={on}
                    onClick={() =>
                      setHidden((h) =>
                        on ? [...h, f] : h.filter((x) => x !== f),
                      )
                    }
                    className={cn(chip, !on && "bg-card text-muted-foreground")}
                    style={
                      on
                        ? {
                            background: FAMILY_COLORS[f].bg,
                            color: FAMILY_COLORS[f].fg,
                            borderColor: "transparent",
                          }
                        : undefined
                    }
                  >
                    <span
                      aria-hidden="true"
                      className="size-2 rounded-full border border-current"
                      style={on ? { background: "currentColor" } : undefined}
                    />
                    {FAMILY_LABELS[f]}
                  </button>
                );
              })}
            <button
              type="button"
              aria-pressed={showPlan}
              onClick={() => setShowPlan((on) => !on)}
              className={cn(chip, !showPlan && "bg-card text-muted-foreground")}
              style={
                showPlan
                  ? {
                      background: PLAN_COLORS.bg,
                      color: PLAN_COLORS.fg,
                      borderColor: "transparent",
                    }
                  : undefined
              }
            >
              <CalendarCheck className="size-4" aria-hidden="true" />
              {PLAN_LABEL}
            </button>
          </div>
          <div className="grid grid-cols-[minmax(0,1fr)] gap-6 @min-[1100px]:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
            <div
              className="donor-calendar rounded-[24px] bg-card p-4 shadow-sm sm:p-5"
              style={{ height: 620 }}
            >
              <Calendar<CalEvent>
                localizer={localizer}
                events={calEvents}
                views={["month"]}
                defaultView="month"
                date={shownDate}
                getNow={() => fromIsoDate(today)}
                onNavigate={setDate}
                onSelectEvent={(e) =>
                  e.task ? setTaskId(e.task.id) : setSelectedId(e.id as number)
                }
                selectable
                onSelectSlot={(slot) => setPlanDate(toIsoDate(slot.start))}
                eventPropGetter={(e) => ({
                  className: cn(
                    e.family === "plan" && "donor-calendar-plan",
                    e.task?.done && "is-done",
                  ),
                  style:
                    e.family === "plan"
                      ? { background: PLAN_COLORS.bg, color: PLAN_COLORS.fg }
                      : {
                          background: FAMILY_COLORS[e.family].bg,
                          color: FAMILY_COLORS[e.family].fg,
                        },
                })}
                popup
              />
            </div>
            <div className="flex min-w-0 flex-col gap-6">
              <PlannerCard
                month={shownMonth}
                onMonthChange={(m) => setDate(new Date(m.year, m.month, 1))}
                marks={marks}
                today={today}
                selected={planDate}
                onSelectDay={setPlanDate}
                recommendations={recommendations.slice(0, 4)}
                recommendationsError={donors.isError}
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
              <AgendaList
                events={events}
                tasks={showPlan ? tasks : []}
                today={today}
                onSelect={setSelectedId}
                onOpenTask={setTaskId}
                onToggleDone={(task, done) => plan.update(task.id, { done })}
              />
            </div>
          </div>
        </>
      ) : null}

      <TaskPanel
        task={tasks.find((t) => t.id === taskId) ?? null}
        detail={plan.items.find((i) => i.id === taskId) ?? null}
        onClose={() => setTaskId(null)}
        onToggleDone={(task, done) => plan.update(task.id, { done })}
      />
      <EventPanel
        eventId={selectedId}
        onClose={() => setSelectedId(null)}
        onOpenBatch={onOpenBatch}
      />
      <DayPlanner
        date={planDate}
        onClose={() => setPlanDate(null)}
        donors={(donors.data ?? [])
          .map((d) => ({ id: d.id, name: d.full_name }))
          .sort((a, b) => a.name.localeCompare(b.name))}
        recommendations={recommendations}
        dayNotes={planDate ? dayNotes(planDate) : []}
      />
    </section>
  );
};

const AgendaList = ({
  events,
  tasks,
  today,
  onSelect,
  onOpenTask,
  onToggleDone,
}: {
  events: CrmEvent[];
  tasks: CalTask[];
  today: string;
  onSelect: (id: number) => void;
  onOpenTask: (id: string) => void;
  onToggleDone: (task: CalTask, done: boolean) => void;
}) => {
  const entries = mergeAgenda(events, tasks, today);
  return (
    <div>
      <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
        Upcoming
      </h2>
      {entries.length === 0 ? (
        <p className="rounded-[24px] bg-card p-4 text-sm text-muted-foreground">
          Nothing coming up yet. Pick a day to add a task.
        </p>
      ) : (
        <ul className="space-y-3">
          {entries.map((entry) =>
            entry.kind === "event" ? (
              <AgendaItem
                key={`event-${entry.event.id}`}
                event={entry.event}
                onSelect={onSelect}
              />
            ) : (
              <TaskAgendaItem
                key={`task-${entry.task.id}`}
                task={entry.task}
                onOpenTask={onOpenTask}
                onToggleDone={onToggleDone}
              />
            ),
          )}
        </ul>
      )}
    </div>
  );
};

const TaskAgendaItem = ({
  task,
  onOpenTask,
  onToggleDone,
}: {
  task: CalTask;
  onOpenTask: (id: string) => void;
  onToggleDone: (task: CalTask, done: boolean) => void;
}) => {
  const origin = taskOrigin(task);
  return (
    <li className="flex items-start gap-3 rounded-[24px] bg-card p-4 shadow-sm">
      <input
        type="checkbox"
        checked={task.done}
        onChange={(event) => onToggleDone(task, event.target.checked)}
        aria-label={`Mark ${task.title} done`}
        className="mt-1 size-5 shrink-0 accent-primary"
      />
      <div className="min-w-0 flex-1">
        <p className="text-[13px] text-muted-foreground">
          {formatDayShort(task.date)}
          {task.time ? ` · ${task.time}` : ""}
        </p>
        <button
          type="button"
          onClick={() => onOpenTask(task.id)}
          className={cn(
            "mt-0.5 text-left text-base font-semibold hover:underline focus-visible:underline",
            task.done && "line-through",
          )}
        >
          {task.title}
        </button>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-[13px]">
          <span
            className="rounded-full px-2.5 py-0.5 text-[12px] font-medium"
            style={{ background: PLAN_COLORS.bg, color: PLAN_COLORS.fg }}
          >
            {PLAN_LABEL}
          </span>
          {origin ? (
            <span className="text-muted-foreground">{origin}</span>
          ) : null}
          {task.done ? <span className="font-medium">Done</span> : null}
        </div>
      </div>
    </li>
  );
};

/** One task, opened from the grid or the list: why, facts, and Mark done / Reopen (PATCH /tasks/{id}). */
const TaskPanel = ({
  task,
  detail,
  onClose,
  onToggleDone,
}: {
  task: CalTask | null;
  detail: OutreachPlanItem | null;
  onClose: () => void;
  onToggleDone: (task: CalTask, done: boolean) => void;
}) => {
  const origin = task ? taskOrigin(task) : null;
  return (
    <Sheet open={task != null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-md">
        {task ? (
          <>
            <SheetHeader>
              <SheetTitle className="text-lg">{task.title}</SheetTitle>
              <SheetDescription>
                {formatDayShort(task.date)}
                {task.time ? ` · ${task.time}` : ""}
                {origin ? ` · ${origin}` : ""}
              </SheetDescription>
            </SheetHeader>
            <div className="space-y-4 px-4 pb-6 text-sm">
              {detail?.note ? <p>{detail.note}</p> : null}
              {detail?.chips && detail.chips.length > 0 ? (
                <ul className="flex flex-wrap gap-1.5" aria-label="Facts">
                  {detail.chips.map((chip) => (
                    <li
                      key={chip}
                      className="rounded-full bg-brand-soft px-2.5 py-0.5 text-[12px] font-medium text-brand-soft-foreground"
                    >
                      {chip}
                    </li>
                  ))}
                </ul>
              ) : null}
              <Button
                type="button"
                onClick={() => onToggleDone(task, !task.done)}
                className="min-h-11 rounded-full px-5"
              >
                {task.done ? "Reopen" : "Mark done"}
              </Button>
              {task.done ? (
                <p className="font-medium" role="status">
                  Done
                </p>
              ) : null}
            </div>
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  );
};

const AgendaItem = ({
  event,
  onSelect,
}: {
  event: CrmEvent;
  onSelect: (id: number) => void;
}) => {
  const detail = useEvent(event.id);
  const counts = detail.data ? countByTab(detail.data.recipients) : null;
  return (
    <li className="rounded-[24px] bg-card p-4 shadow-sm">
      <p className="text-[13px] text-muted-foreground">
        {when(event.starts_at)}
      </p>
      <button
        type="button"
        onClick={() => onSelect(event.id)}
        className="mt-0.5 text-left text-base font-semibold hover:underline focus-visible:underline"
      >
        {event.title}
      </button>
      {event.place ? (
        <p className="mt-0.5 flex items-center gap-1 text-[13px] text-muted-foreground">
          <MapPin className="size-3.5" aria-hidden /> {event.place}
        </p>
      ) : null}
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px]">
        <FamilyBadge family={kindInfo(event).family} />
        <AudienceChips counts={counts} total={event.audience_count} />
        {event.drafts_ready != null ? (
          <span className="font-medium">{event.drafts_ready} drafts ready</span>
        ) : null}
        <SourceLink url={event.source_url} />
      </div>
    </li>
  );
};

const AudienceChips = ({
  counts,
  total,
}: {
  counts: Record<Tab, number> | null;
  total: number | null;
}) => {
  if (counts && TABS.some((t) => counts[t] > 0)) {
    return (
      <span className="flex flex-wrap gap-1.5">
        {TABS.filter((t) => counts[t] > 0).map((t) => (
          <span
            key={t}
            className="rounded-full bg-brand-soft px-2 py-0.5 text-[12px] font-medium text-brand-soft-foreground"
          >
            {counts[t]} {TAB_LABELS[t]}
          </span>
        ))}
      </span>
    );
  }
  return total != null ? <span>{total} in audience</span> : null;
};

const SourceLink = ({ url }: { url: string | null }) =>
  url ? (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      aria-label="Source"
      className="inline-flex items-center gap-1 underline underline-offset-2"
    >
      src <ExternalLink className="size-3" aria-hidden />
    </a>
  ) : (
    <span className="text-muted-foreground">no source</span>
  );

const EventPanel = ({
  eventId,
  onClose,
  onOpenBatch,
}: {
  eventId: number | null;
  onClose: () => void;
  onOpenBatch?: (batchId: string) => void;
}) => {
  const { data, isPending } = useEvent(eventId);
  const plan = usePlanEventOutreach();
  return (
    <Sheet
      open={eventId != null}
      onOpenChange={(open) => {
        if (!open) {
          plan.reset();
          onClose();
        }
      }}
    >
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-md">
        {isPending || !data ? (
          <SheetHeader>
            <SheetTitle>Event</SheetTitle>
            <SheetDescription>Loading…</SheetDescription>
          </SheetHeader>
        ) : (
          <PanelBody event={data} plan={plan} onOpenBatch={onOpenBatch} />
        )}
      </SheetContent>
    </Sheet>
  );
};

const PanelBody = ({
  event,
  plan,
  onOpenBatch,
}: {
  event: CrmEventDetail;
  plan: ReturnType<typeof usePlanEventOutreach>;
  onOpenBatch?: (batchId: string) => void;
}) => {
  const counts = countByTab(event.recipients);
  const sample = event.drafts[0];
  const batchId = plan.data?.batchId ?? null;
  return (
    <>
      <SheetHeader>
        <SheetTitle className="text-lg">{event.title}</SheetTitle>
        <SheetDescription>
          {when(event.starts_at)}
          {event.place ? ` · ${event.place}` : ""}
        </SheetDescription>
      </SheetHeader>
      <div className="space-y-5 px-4 pb-6 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          <FamilyBadge family={kindInfo(event).family} />
          {kindInfo(event).lead ? (
            <span className="text-[13px] text-muted-foreground">
              Lead time: {kindInfo(event).lead} (suggested, editable)
            </span>
          ) : null}
        </div>
        <section aria-labelledby="aud-h">
          <h3 id="aud-h" className="mb-1 font-semibold">
            Audience
          </h3>
          <ul className="space-y-1">
            {TABS.map((t) => (
              <li key={t} className="flex justify-between">
                <span>{TAB_LABELS[t]}</span>
                <span className="font-medium">{counts[t]}</span>
              </li>
            ))}
          </ul>
        </section>

        <section aria-labelledby="inv-h">
          <h3 id="inv-h" className="mb-1 font-semibold">
            Sample invite ({event.drafts.length} drafts ready)
          </h3>
          {sample ? (
            <blockquote className="whitespace-pre-wrap rounded-2xl bg-surface p-3">
              {sample.subject ? (
                <strong className="block">{sample.subject}</strong>
              ) : null}
              {sample.body}
              {sample.name ? (
                <footer className="mt-2 text-[12px] text-muted-foreground">
                  To {sample.name}
                </footer>
              ) : null}
            </blockquote>
          ) : (
            <p className="text-muted-foreground">No drafts yet.</p>
          )}
        </section>

        <section aria-labelledby="src-h">
          <h3 id="src-h" className="mb-1 font-semibold">
            Source
          </h3>
          <SourceLink url={event.source_url} />
          {event.source ? (
            <span className="ml-2 text-muted-foreground">{event.source}</span>
          ) : null}
        </section>

        <div>
          <Button
            type="button"
            onClick={() => plan.mutate(event.id)}
            disabled={plan.isPending}
            className="min-h-11 rounded-full px-5"
          >
            {plan.isPending ? "Planning…" : "Review"}
          </Button>
          <div aria-live="polite" className="mt-2">
            {plan.isError ? (
              <p role="alert" className="text-alert-foreground">
                {(plan.error as Error).message}
              </p>
            ) : null}
            {plan.data && batchId ? (
              onOpenBatch ? (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => onOpenBatch(batchId)}
                  className="min-h-11 rounded-full px-5"
                >
                  Open batch {batchId}
                </Button>
              ) : (
                <p>
                  Batch ready: <code>{batchId}</code>
                </p>
              )
            ) : null}
            {plan.data && !batchId ? (
              <p>Outreach planned, but no batch id was returned.</p>
            ) : null}
          </div>
        </div>
      </div>
    </>
  );
};
