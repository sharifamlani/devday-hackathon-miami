import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { DATA_MODE, PUBLIC_READ_ONLY } from "./config";
import { call, qs } from "./endpoint";
import { ApiError } from "./httpClient";
import { undo } from "./tasks";

/*
 * Organization events (Calendar v3): the ONE module that talks to the events
 * contract. Staff and the agent add events (no source link needed); website
 * events are read-only. A contract change is a change in this file.
 */

export type EventKind = "fundraising" | "stewardship" | "community" | "other";
export const EVENT_KINDS: { value: EventKind; label: string }[] = [
  { value: "fundraising", label: "Fundraising" },
  { value: "stewardship", label: "Stewardship" },
  { value: "community", label: "Community" },
  { value: "other", label: "Other" },
];

/** Sources a person can edit; website / news / search events belong to the events agent. */
export const EDITABLE_SOURCES = ["staff", "agent"] as const;
export const isEditableSource = (source: string | null | undefined) =>
  source === "staff" || source === "agent";

/** A row of GET /calendar?kind=event. */
export interface CalendarEvent {
  date: string; // YYYY-MM-DD
  time: string | null; // HH:MM, null = all day
  title: string;
  kind: "event";
  source: string | null;
  ref: string | number | null; // "event:3"
  place?: string | null;
  event_kind?: string | null;
  source_url?: string | null;
  status?: string | null;
}

/** A row of GET /events (with notes). */
export interface OrgEvent {
  id: number;
  title: string;
  starts_at: string;
  ends_at?: string | null;
  place?: string | null;
  event_kind?: string | null;
  source?: string | null;
  source_url?: string | null;
  notes?: string | null;
  status?: string | null;
}

export interface EventInput {
  title: string;
  /** "YYYY-MM-DD" (all day) or "YYYY-MM-DDTHH:MM". */
  starts_at: string;
  ends_at?: string | null;
  place?: string | null;
  event_kind?: EventKind | null;
  notes?: string | null;
}

export type EventWrite = OrgEvent & { undo_token?: string | null };

export const eventId = (ref: string | number | null | undefined): number | null => {
  const match = /^(?:event:)?(\d+)$/.exec(String(ref ?? ""));
  return match ? Number(match[1]) : null;
};

export const eventKeys = {
  feed: (from?: string, to?: string) => ["donor-desk", "calendar", "events", from ?? "", to ?? ""] as const,
  list: ["donor-desk", "events", "org"] as const,
};

/* ---------- API ---------- */

export const getCalendarEvents = (from?: string, to?: string) =>
  call<CalendarEvent[]>("The calendar", "GET", `/calendar${qs({ from, to, kind: "event" })}`, {
    snapshotValue: [],
    snapshot: (s) =>
      (s.calendar as (CalendarEvent | { kind: string })[] | undefined)?.filter(
        (item): item is CalendarEvent =>
          item.kind === "event" &&
          (!from || (item as CalendarEvent).date >= from) &&
          (!to || (item as CalendarEvent).date <= to),
      ),
  });

export const getOrgEvents = () =>
  call<OrgEvent[]>("Events", "GET", "/events", {
    snapshotValue: [],
    snapshot: (s) => s.events as OrgEvent[] | undefined,
  });

export const createEvent = (input: EventInput) =>
  call<EventWrite>("Adding an event", "POST", "/events", { body: input });

export const updateEvent = (id: number, patch: Partial<EventInput>) =>
  call<EventWrite>("Updating the event", "PATCH", `/events/${id}`, { body: patch });

export const deleteEvent = (id: number) =>
  call<{ deleted?: boolean; undo_token?: string | null }>("Deleting the event", "DELETE", `/events/${id}`);

/* ---------- Errors ---------- */

export const WEBSITE_EVENT_MESSAGE = "This event comes from your website and can’t be edited here.";

/** FastAPI 422 body: detail is a string or [{loc, msg}]. Returns {field: message}. */
export const fieldErrors = (error: unknown): Record<string, string> => {
  if (!(error instanceof ApiError) || error.status !== 422) return {};
  const detail = (error.body as { detail?: unknown } | null)?.detail;
  if (typeof detail === "string") return { form: detail };
  if (!Array.isArray(detail)) return { form: "Check the event details." };
  const out: Record<string, string> = {};
  for (const d of detail as { loc?: unknown[]; msg?: string }[]) {
    const field = String(d.loc?.[d.loc.length - 1] ?? "form");
    out[field === "starts_at" || field === "date" || field === "time" ? "date" : field] ??= d.msg ?? "Invalid";
  }
  return out;
};

/** One human sentence for any failed write. */
export const eventErrorMessage = (error: unknown): string => {
  if (error instanceof ApiError && error.status === 403) return WEBSITE_EVENT_MESSAGE;
  const fields = fieldErrors(error);
  if (Object.keys(fields).length) return Object.values(fields)[0];
  return error instanceof Error ? error.message : "Something went wrong.";
};

/* ---------- Hooks ---------- */

/** Organization events only (never tasks) for a date range. */
export const useCalendarEvents = (from?: string, to?: string) =>
  useQuery({ queryKey: eventKeys.feed(from, to), queryFn: () => getCalendarEvents(from, to) });

/** Full event rows (notes); loaded when an edit form opens. */
export const useOrgEvents = (enabled = true) =>
  useQuery({ queryKey: eventKeys.list, queryFn: getOrgEvents, enabled });

/** Events show on the calendar, the Home tile, the event list and the home counts. */
const useRefreshEvents = () => {
  const queryClient = useQueryClient();
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ["donor-desk", "calendar"] }),
      queryClient.invalidateQueries({ queryKey: ["donor-desk", "events"] }),
      queryClient.invalidateQueries({ queryKey: ["donor-desk", "home-summary"] }),
    ]);
};

export const useCreateEvent = () => {
  const refresh = useRefreshEvents();
  return useMutation({ mutationFn: createEvent, onSuccess: refresh });
};

export const useUpdateEvent = () => {
  const refresh = useRefreshEvents();
  return useMutation({
    mutationFn: ({ id, ...patch }: Partial<EventInput> & { id: number }) => updateEvent(id, patch),
    onSuccess: refresh,
  });
};

export const useDeleteEvent = () => {
  const refresh = useRefreshEvents();
  return useMutation({ mutationFn: deleteEvent, onSuccess: refresh });
};

/** POST /undo/{token}, then refresh every event view. */
export const useUndoEvent = () => {
  const refresh = useRefreshEvents();
  return useMutation({ mutationFn: (token: string) => undo(token), onSuccess: refresh });
};

/** The snapshot (Vercel) build and the public preview (public mode) are read-only: hide Add / Edit. */
export const EVENTS_READ_ONLY = DATA_MODE === "snapshot" || PUBLIC_READ_ONLY;
