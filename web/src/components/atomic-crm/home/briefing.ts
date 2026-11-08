import type { HomeSummary } from "../providers/local/homeSummary";
import type { HomeTask } from "./homeData";

/** What a briefing line's button does. */
export type BriefingAction =
  | { kind: "task"; taskKey: string; label: string }
  | { kind: "ask"; question: string; label: string }
  | { kind: "link"; to: string; label: string }
  | { kind: "panel"; view: "calendar" | "tasks"; label: string; date?: string };

export interface BriefingLine {
  key: "tasks" | "late" | "duplicates" | "event" | "reached";
  text: string;
  action: BriefingAction | null;
}

export interface Briefing {
  headline: string;
  lines: BriefingLine[];
}

const plural = (n: number, one: string, many: string) =>
  `${n} ${n === 1 ? one : many}`;

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

/** "2026-11-20" → "Nov 20"; the input unchanged if it isn't an ISO date. */
const shortDate = (iso: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${MONTHS[Number(m[2]) - 1]} ${Number(m[3])}` : iso;
};

const whenText = (days: number, date: string) =>
  days <= 0
    ? "today"
    : days === 1
      ? "tomorrow"
      : `in ${days} days (${shortDate(date)})`;

/** The question the late-gift line asks; the service's own chip says the same. */
export const LATE_QUESTION = "Who's late on a usual gift?";

/**
 * "Here's your day": the home chat's first agent message, built from data the
 * board already loaded (GET /home/summary + GET /tasks?due=today). Pure, no
 * model call. Only lines with something to say are kept, most urgent first.
 * Null while there is nothing to brief on yet (no summary, or no donors).
 */
export const buildBriefing = (
  summary: HomeSummary | null | undefined,
  tasks: HomeTask[],
): Briefing | null => {
  if (!summary) return null;
  const lines: BriefingLine[] = [];

  const openTasks = tasks.length || summary.tasks_today;
  if (openTasks > 0) {
    const first = tasks[0];
    lines.push({
      key: "tasks",
      text: first
        ? `${plural(openTasks, "task", "tasks")} today. First up: ${first.title}`
        : `${plural(openTasks, "task", "tasks")} today.`,
      action: first
        ? { kind: "task", taskKey: first.key, label: "Start" }
        : { kind: "panel", view: "tasks", label: "See tasks" },
    });
  }

  if (summary.gifts_at_risk > 0)
    lines.push({
      key: "late",
      text:
        summary.gifts_at_risk === 1
          ? "1 usual gift looks late."
          : `${summary.gifts_at_risk} usual gifts look late.`,
      action: { kind: "ask", question: LATE_QUESTION, label: "Show me" },
    });

  if (summary.duplicates > 0)
    lines.push({
      key: "duplicates",
      text: `${plural(summary.duplicates, "possible duplicate", "possible duplicates")} to review.`,
      action: { kind: "link", to: "/inbox", label: "Review" },
    });

  const event = summary.next_event;
  if (event)
    lines.push({
      key: "event",
      text: `Next event: ${event.title}, ${whenText(event.days, event.date)}.`,
      action: {
        kind: "panel",
        view: "calendar",
        label: "Open calendar",
        date: event.date,
      },
    });

  if (summary.reached_today > 0)
    lines.push({
      key: "reached",
      text: `You’ve reached ${plural(summary.reached_today, "person", "people")} today.`,
      action: null,
    });

  return {
    headline: lines.length ? "Here’s your day." : "Nothing urgent today.",
    lines,
  };
};
