import { useQuery } from "@tanstack/react-query";

import { call, qs } from "./endpoint";

/* plan.md §21.5: calendar feed and artifacts (owner 3a, B12). */

export interface CalendarItem {
  date: string; // YYYY-MM-DD
  time: string | null; // HH:MM
  title: string;
  kind: "event" | "task";
  source: string | null;
  ref: string | number | null; // "event:3" / "task:12"
  /** Tasks only: the task's kind (call | email | review | prep) and whether it's done. */
  task_kind?: string | null;
  done?: boolean;
}

export interface Artifact {
  kind: string; // "brief" | "call_note" | "campaign" | ...
  title: string;
  date: string;
  ref: string | number | null;
  /** The donor a draft or call note is for (service tasks.artifacts); null for prospects, campaigns, others. */
  donor_id?: number | null;
}

export const calendarKeys = {
  feed: (from?: string, to?: string) => ["donor-desk", "calendar", from ?? "", to ?? ""] as const,
  artifacts: ["donor-desk", "artifacts"] as const,
};

export const getCalendarFeed = (from?: string, to?: string) =>
  call<CalendarItem[]>("The calendar", "GET", `/calendar${qs({ from, to })}`, {
    snapshotValue: [],
    snapshot: (s) =>
      (s.calendar as CalendarItem[] | undefined)?.filter(
        (item) => (!from || item.date >= from) && (!to || item.date <= to),
      ),
  });

export const getArtifacts = () =>
  call<Artifact[]>("Artifacts", "GET", "/artifacts", {
    snapshotValue: [],
    snapshot: (s) => s.artifacts as Artifact[] | undefined,
  });

/** Events and tasks in one list, for the calendar and the mini calendar. */
export const useCalendarFeed = (from?: string, to?: string) =>
  useQuery({ queryKey: calendarKeys.feed(from, to), queryFn: () => getCalendarFeed(from, to) });

export const useArtifacts = () => useQuery({ queryKey: calendarKeys.artifacts, queryFn: getArtifacts });
