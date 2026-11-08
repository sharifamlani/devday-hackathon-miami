import type { CrmEvent } from "../providers/local/crmTypes";
import { fromIsoDate, giveMiamiDayFor } from "../outreach/dates";
import type { OutreachPlanItem } from "../outreach/outreachPlan";
import type { CalendarItem as ApiCalendarItem } from "../providers/local/calendarFeed";
import { kindInfo } from "./eventKinds";

/**
 * The outreach-plan layer on the calendar page: the viewer's planned donors
 * and campaigns (outreach/outreachPlan.ts) shown next to the org's events.
 * Pure helpers; CalendarPage renders them.
 */

/** Give Miami Day: the event of that name when the events agent found it, else the date rule. */
export const giveMiamiDayFrom = (events: CrmEvent[], today: string): string => {
  const found = events.find((e) => /give\s*miami\s*day/i.test(e.title));
  if (found) return found.starts_at.slice(0, 10);
  const year = Number(today.slice(0, 4));
  const thisYear = giveMiamiDayFor(year);
  return thisYear >= today ? thisYear : giveMiamiDayFor(year + 1);
};

/**
 * Fundraising campaigns that run over several days end on `ends_at`; those
 * days get the "campaign ends" mark (campaigns themselves carry no end date yet).
 */
export const campaignEndsFrom = (events: CrmEvent[]) =>
  events.flatMap((e) =>
    e.ends_at &&
    kindInfo(e).family === "fundraising" &&
    e.ends_at.slice(0, 10) !== e.starts_at.slice(0, 10)
      ? [{ date: e.ends_at.slice(0, 10), label: e.title }]
      : [],
  );

export const eventDays = (events: CrmEvent[]) =>
  events.map((e) => ({ date: e.starts_at.slice(0, 10), label: e.title }));

/**
 * A dated task on the calendar. Live: a row of GET /calendar (kind "task").
 * Snapshot build: an item of the browser-local outreach plan.
 */
export interface CalTask {
  /** The task id as a string (PATCH /tasks/{id}); the plan item id in the snapshot build. */
  id: string;
  date: string; // YYYY-MM-DD
  time: string | null;
  title: string;
  done: boolean;
  /** "agent" | "staff" | "generator" | ... */
  source: string | null;
  /** "call" | "review" | ... when known. */
  kind: string | null;
}

/** GET /calendar rows → the tasks among them (events stay with useEvents). */
export const tasksFromFeed = (
  items: (ApiCalendarItem & { done?: boolean; task_kind?: string })[],
): CalTask[] =>
  items.flatMap((item) =>
    item.kind === "task"
      ? [
          {
            id: String(item.ref ?? "").replace(/^task:/, ""),
            date: item.date.slice(0, 10),
            time: item.time,
            title: item.title,
            done: item.done === true,
            source: item.source,
            kind: item.task_kind ?? null,
          },
        ]
      : [],
  );

export const planItemTitle = (item: OutreachPlanItem) =>
  item.title ??
  `${item.campaign_id != null ? "Review " : "Contact "}${item.label}`;

/** Snapshot build: the local plan as calendar tasks. */
export const tasksFromPlan = (items: OutreachPlanItem[]): CalTask[] =>
  items.map((item) => ({
    id: item.id,
    date: item.date,
    time: null,
    title: planItemTitle(item),
    done: item.done,
    source: item.source,
    kind: null,
  }));

/** "Done: " and "(added by agent)" are part of how a task reads everywhere. */
export const taskLabel = (task: CalTask) =>
  `${task.done ? "Done: " : ""}${task.title}${task.source === "agent" ? " (added by agent)" : ""}`;

/** Who made the task, in words; null when it needs no note. */
export const taskOrigin = (task: Pick<CalTask, "source">) =>
  task.source === "agent"
    ? "added by agent"
    : task.source === "generator"
      ? "suggested from your data"
      : null;

/** A task as a react-big-calendar all-day entry. */
export const taskCalendarEntries = (tasks: CalTask[]) =>
  tasks.map((task) => ({
    id: `task-${task.id}`,
    title: taskLabel(task),
    start: fromIsoDate(task.date),
    end: fromIsoDate(task.date),
    allDay: true,
    task,
  }));

export type AgendaEntry =
  | { kind: "event"; date: string; event: CrmEvent }
  | { kind: "task"; date: string; task: CalTask };

/**
 * Upcoming list: events as given, plus tasks from `today` on (done ones stay,
 * ticked, so marking one done doesn't make it vanish), by day. Within a day
 * events come first, then tasks (by time, then as given).
 */
export const mergeAgenda = (
  events: CrmEvent[],
  tasks: CalTask[],
  today: string,
): AgendaEntry[] => {
  const entries: AgendaEntry[] = [
    ...events.map((event) => ({
      kind: "event" as const,
      date: event.starts_at.slice(0, 10),
      event,
    })),
    ...tasks
      .filter((task) => task.date >= today)
      .map((task) => ({ kind: "task" as const, date: task.date, task })),
  ];
  return entries.sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      (a.kind === b.kind
        ? a.kind === "task" && b.kind === "task"
          ? (a.task.time ?? "99:99").localeCompare(b.task.time ?? "99:99")
          : 0
        : a.kind === "event"
          ? -1
          : 1),
  );
};
