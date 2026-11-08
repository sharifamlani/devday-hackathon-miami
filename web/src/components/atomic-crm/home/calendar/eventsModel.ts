import { addDays, isIsoDate } from "../../outreach/dates";
import type { CrmEvent } from "../../providers/local/crmTypes";
import {
  isEditableSource,
  type CalendarEvent,
  type EventInput,
  type EventKind,
} from "../../providers/local/events";
import { parseWhen } from "../../providers/local/parseWhen";
import { clock } from "../AgendaList";

/* Pure helpers for the Calendar v3 panel: events only, never tasks. */

const minutesOf = (time: string | null): number | null => {
  const m = time?.match(/^(\d{2}):(\d{2})/);
  return m && Number(m[1]) < 24 && Number(m[2]) < 60 ? Number(m[1]) * 60 + Number(m[2]) : null;
};

export interface EventRow {
  key: string;
  ref: string | number | null;
  /** "8:00 AM" or "All day". */
  time: string;
  title: string;
  place: string | null;
  kind: string; // fundraising | stewardship | community | other
  /** "added by you" / "added by the agent" / the source's domain. */
  provenance: string;
  sourceUrl: string | null;
  editable: boolean;
  key_date: boolean;
  event: CalendarEvent;
}

export interface EventDay {
  date: string;
  rows: EventRow[];
}

export const isGiveMiamiDay = (title: string) => /give\s*miami\s*day/i.test(title);

export const domainOf = (url: string | null | undefined): string | null => {
  try {
    return url ? new URL(url).hostname.replace(/^www\./, "") : null;
  } catch {
    return null;
  }
};

export const provenance = (e: CalendarEvent): string =>
  e.source === "staff"
    ? "added by you"
    : e.source === "agent"
      ? "added by the agent"
      : (domainOf(e.source_url) ?? e.source ?? "website");

const toRow = (e: CalendarEvent, n: number): EventRow => ({
  key: `${e.ref ?? e.title}-${n}`,
  ref: e.ref,
  time: minutesOf(e.time) == null ? "All day" : clock(minutesOf(e.time)!),
  title: e.title,
  place: e.place ?? null,
  kind: e.event_kind ?? "other",
  provenance: provenance(e),
  sourceUrl: e.source_url ?? null,
  editable: isEditableSource(e.source),
  key_date: isGiveMiamiDay(e.title),
  event: e,
});

/** Organization events only, for the 7 days from `start`: every day listed (empty ones too), all-day first, then by time. */
export const eventDays = (items: CalendarEvent[], start: string): EventDay[] =>
  Array.from({ length: 7 }, (_, i) => {
    const date = addDays(start, i);
    const rows = items
      .filter((e) => e.kind === "event" && e.date.slice(0, 10) === date)
      .map(toRow)
      .sort((a, b) => (minutesOf(a.event.time) ?? -1) - (minutesOf(b.event.time) ?? -1));
    return { date, rows };
  });

/** "1 event" / "3 events" / "♥ Give Miami" / "–" for a strip cell. */
export const stripLabel = (day: EventDay): string => {
  if (day.rows.some((r) => r.key_date)) return "♥ Give Miami";
  const n = day.rows.length;
  return n === 0 ? "–" : `${n} event${n === 1 ? "" : "s"}`;
};

/** "THURSDAY, NOV 12" style heading, with "Today · " prefix. */
export const listHeading = (date: string, today: string) => {
  const text = parseWhen(date)
    .toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" })
    .toUpperCase();
  return date === today ? `TODAY · ${text}` : text;
};

/* ---------- The add / edit form ---------- */

export interface EventFormValues {
  title: string;
  date: string;
  allDay: boolean;
  start: string; // HH:MM
  end: string; // HH:MM or ""
  place: string;
  kind: EventKind | "";
  notes: string;
}

export const emptyForm = (date: string): EventFormValues => ({
  title: "",
  date,
  allDay: true,
  start: "09:00",
  end: "",
  place: "",
  kind: "",
  notes: "",
});

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

const realDate = (s: string) => isIsoDate(s) && !Number.isNaN(parseWhen(s).getTime()) && addDays(s, 0) === s;

export const validateEventForm = (v: EventFormValues): Record<string, string> => {
  const errors: Record<string, string> = {};
  if (!v.title.trim()) errors.title = "Give the event a title.";
  if (!realDate(v.date)) errors.date = "Choose a valid date.";
  if (!v.allDay) {
    if (!TIME.test(v.start)) errors.start = "Enter a start time.";
    if (v.end && !TIME.test(v.end)) errors.end = "Enter a valid end time.";
    else if (v.end && TIME.test(v.start) && v.end < v.start) errors.end = "End must be after the start.";
  }
  return errors;
};

export const formToInput = (v: EventFormValues): EventInput => ({
  title: v.title.trim(),
  starts_at: v.allDay ? v.date : `${v.date}T${v.start}`,
  ends_at: !v.allDay && v.end ? `${v.date}T${v.end}` : null,
  place: v.place.trim() || null,
  event_kind: v.kind || null,
  notes: v.notes.trim() || null,
});

/** Prefill the form from a calendar row (+ the full event row when loaded). */
export const formFromEvent = (
  e: CalendarEvent,
  full?: { ends_at?: string | null; notes?: string | null } | null,
): EventFormValues => ({
  title: e.title,
  date: e.date.slice(0, 10),
  allDay: minutesOf(e.time) == null,
  start: minutesOf(e.time) == null ? "09:00" : e.time!.slice(0, 5),
  end: full?.ends_at && full.ends_at.length > 10 ? full.ends_at.slice(11, 16) : "",
  place: e.place ?? "",
  kind: (["fundraising", "stewardship", "community", "other"].includes(e.event_kind ?? "")
    ? e.event_kind
    : "") as EventKind | "",
  notes: full?.notes ?? "",
});

/* ---------- Suggestions: event-related to-dos from real data ---------- */

export interface Suggestion {
  key: string;
  title: string;
  detail: string;
  task: { title: string; kind: "email" | "review"; due: string; why: string };
}

/**
 * To-dos the agent's event work supports: an upcoming event in the week with drafted invites
 * (review them) or an audience (invite them). Nothing is invented: no audience, no drafts, no suggestion.
 * Suggestions are TASKS for the to-do list, never events.
 */
export const buildSuggestions = (events: CrmEvent[], start: string, today: string): Suggestion[] => {
  const end = addDays(start, 6);
  const out: Suggestion[] = [];
  for (const e of events) {
    const date = e.starts_at.slice(0, 10);
    if (date < today || date < start || date > end || e.status === "past") continue;
    const dayBefore = addDays(date, -1);
    const due = dayBefore < today ? today : dayBefore;
    const when = parseWhen(date).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
    const drafts = e.drafts_ready ?? 0;
    const audience = e.audience_count ?? 0;
    if (drafts > 0) {
      out.push({
        key: `review-${e.id}`,
        title: `Review ${drafts} drafted invite${drafts === 1 ? "" : "s"} for ${e.title}`,
        detail: `${e.title} is ${when}. ${drafts} invite${drafts === 1 ? " is" : "s are"} drafted and waiting for approval.`,
        task: {
          title: `Review ${drafts} drafted invite${drafts === 1 ? "" : "s"} for ${e.title}`,
          kind: "review",
          due,
          why: `${e.title} is ${when}; ${drafts} drafted invite${drafts === 1 ? "" : "s"} not yet approved.`,
        },
      });
    } else if (audience > 0) {
      out.push({
        key: `invite-${e.id}`,
        title: `Invite ${audience} ${audience === 1 ? "person" : "people"} to ${e.title}`,
        detail: `${e.title} is ${when}. ${audience} ${audience === 1 ? "person fits" : "people fit"} its audience.`,
        task: {
          title: `Invite ${audience} ${audience === 1 ? "person" : "people"} to ${e.title}`,
          kind: "email",
          due,
          why: `${e.title} is ${when}; ${audience} on the suggested audience.`,
        },
      });
    }
  }
  return out;
};

/** Whole weeks from `today`'s week start to the week holding `date` (negative = earlier); the strip is rolling from today. */
export const weekOffsetFor = (today: string, date: string): number => {
  const utc = (iso: string) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10));
  return Math.floor((utc(date.slice(0, 10)) - utc(today)) / 86400000 / 7);
};
