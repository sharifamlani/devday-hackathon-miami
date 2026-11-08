import type { CrmEvent } from "../providers/local/crmTypes";
import { fromIsoDate, giveMiamiDayFor } from "../outreach/dates";
import type { OutreachPlanItem } from "../outreach/outreachPlan";
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

/** A plan item as a react-big-calendar all-day entry. */
export const planItemTitle = (item: OutreachPlanItem) =>
  `${item.done ? "Done: " : ""}${item.campaign_id != null ? "Review " : "Contact "}${item.label}`;

export const planCalendarEntries = (items: OutreachPlanItem[]) =>
  items.map((item) => ({
    id: item.id,
    title: planItemTitle(item),
    start: fromIsoDate(item.date),
    end: fromIsoDate(item.date),
    allDay: true,
    item,
  }));

export type AgendaEntry =
  | { kind: "event"; date: string; event: CrmEvent }
  | { kind: "plan"; date: string; item: OutreachPlanItem };

/**
 * Upcoming list: events as given, plus plan items from `today` on (done ones
 * stay, ticked, so marking one done doesn't make it vanish), by day.
 * Within a day events come first, then plan items.
 */
export const mergeAgenda = (
  events: CrmEvent[],
  items: OutreachPlanItem[],
  today: string,
): AgendaEntry[] => {
  const entries: AgendaEntry[] = [
    ...events.map((event) => ({
      kind: "event" as const,
      date: event.starts_at.slice(0, 10),
      event,
    })),
    ...items
      .filter((item) => item.date >= today)
      .map((item) => ({ kind: "plan" as const, date: item.date, item })),
  ];
  return entries.sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      (a.kind === b.kind ? 0 : a.kind === "event" ? -1 : 1),
  );
};
