import { addDays, formatDayLong, mondayIndex, toIsoDate } from "./dates";
import type { OutreachPlanItem } from "./outreachPlan";

/** One cell of a Monday-first month grid. */
export interface DayCell {
  date: string; // YYYY-MM-DD
  day: number; // 1-31
  inMonth: boolean;
}

/**
 * The weeks that touch a month, Monday to Sunday, padded with the days of the
 * neighbouring months (4 to 6 rows). `month` is 0-based like Date.
 */
export const monthWeeks = (year: number, month: number): DayCell[][] => {
  const first = toIsoDate(new Date(year, month, 1));
  const last = toIsoDate(new Date(year, month + 1, 0));
  let day = addDays(first, -mondayIndex(first));
  const weeks: DayCell[][] = [];
  while (day <= last) {
    const week: DayCell[] = [];
    for (let i = 0; i < 7; i += 1) {
      const [y, m, d] = day.split("-").map(Number);
      week.push({ date: day, day: d, inMonth: y === year && m - 1 === month });
      day = addDays(day, 1);
    }
    weeks.push(week);
  }
  return weeks;
};

/** What a day carries: the dots and the words behind them. */
export interface DayMarks {
  planned: number; // open outreach plan items
  done: number; // plan items marked done
  campaignEnds: string[]; // names of campaigns or goal periods ending that day
  events: string[]; // titles of org events that day (calendar page)
  giveMiamiDay: boolean;
}

export interface MarkSources {
  plan?: OutreachPlanItem[];
  campaignEnds?: { date: string; label: string }[];
  events?: { date: string; label: string }[];
  giveMiamiDay?: string | null;
}

const emptyMarks = (): DayMarks => ({
  planned: 0,
  done: 0,
  campaignEnds: [],
  events: [],
  giveMiamiDay: false,
});

/** Day → marks, for every day that has at least one. */
export const computeDayMarks = (
  sources: MarkSources,
): Map<string, DayMarks> => {
  const marks = new Map<string, DayMarks>();
  const at = (date: string) => {
    let entry = marks.get(date);
    if (!entry) {
      entry = emptyMarks();
      marks.set(date, entry);
    }
    return entry;
  };
  for (const item of sources.plan ?? []) {
    if (item.done) at(item.date).done += 1;
    else at(item.date).planned += 1;
  }
  for (const end of sources.campaignEnds ?? []) {
    at(end.date.slice(0, 10)).campaignEnds.push(end.label);
  }
  for (const event of sources.events ?? []) {
    at(event.date.slice(0, 10)).events.push(event.label);
  }
  if (sources.giveMiamiDay)
    at(sources.giveMiamiDay.slice(0, 10)).giveMiamiDay = true;
  return marks;
};

const count = (n: number, one: string, many: string) =>
  `${n} ${n === 1 ? one : many}`;

/** Words for a day's marks, without the date ("Give Miami Day. 2 planned, 1 done"). */
export const describeMarks = (marks: DayMarks | undefined): string[] => {
  if (!marks) return [];
  const parts: string[] = [];
  if (marks.giveMiamiDay) parts.push("Give Miami Day");
  if (marks.planned)
    parts.push(count(marks.planned, "outreach planned", "outreach planned"));
  if (marks.done)
    parts.push(count(marks.done, "outreach done", "outreach done"));
  if (marks.campaignEnds.length)
    parts.push(`Ends: ${marks.campaignEnds.join(", ")}`);
  if (marks.events.length)
    parts.push(count(marks.events.length, "event", "events"));
  return parts;
};

/** The accessible name of a day button. */
export const describeDay = (
  date: string,
  marks: DayMarks | undefined,
  today: string,
): string =>
  [
    `${formatDayLong(date)}${date === today ? ", today" : ""}`,
    ...describeMarks(marks),
  ].join(". ");
