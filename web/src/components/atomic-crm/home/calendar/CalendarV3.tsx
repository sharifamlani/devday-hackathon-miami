import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Info, Pencil, Plus, Sparkles } from "lucide-react";
import { useNavigate } from "react-router";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { addDays, toIsoDate } from "../../outreach/dates";
import { useEvents, usePlanEventOutreach } from "../../providers/local/crmHooks";
import type { CrmEvent } from "../../providers/local/crmTypes";
import {
  EVENTS_READ_ONLY,
  eventErrorMessage,
  eventId,
  useCalendarEvents,
  useCreateEvent,
  useDeleteEvent,
  useOrgEvents,
  useUndoEvent,
  useUpdateEvent,
  type CalendarEvent,
} from "../../providers/local/events";
import { useTargets } from "../../providers/local/hooks";
import { parseWhen } from "../../providers/local/parseWhen";
import { useCreateTask } from "../../providers/local/tasks";
import { takeAddEventRequest, takeCalendarFocus } from "../../calendar/calendarFocus";
import { weekRange, weekStrip } from "../AgendaList";
import { focusRing } from "../tile";
import { EventForm } from "./EventForm";
import {
  buildSuggestions,
  weekOffsetFor,
  emptyForm,
  eventDays,
  formFromEvent,
  listHeading,
  stripLabel,
  type EventRow,
} from "./eventsModel";
import "./calendar-v3.css";
import { TimeGrid } from "../WeekGrid";

/**
 * Calendar v3: the organization's EVENTS only (tasks live on the to-do list). A rolling 7-day
 * strip, a day-grouped list with full titles, and the agent's event-related suggestions.
 * Used by the Home zoom panel and the /calendar page.
 */
export const CalendarV3 = ({ today: todayProp }: { today?: string }) => {
  const targets = useTargets();
  const today = todayProp ?? targets.data?.quarter?.as_of ?? toIsoDate(new Date());
  // The briefing's "Open calendar" sets a focus date (calendarFocus.ts); read once, land on its week.
  const [focus] = useState(() => {
    const d = takeCalendarFocus();
    return d ? toIsoDate(d) : null;
  });
  const [picked, setOffset] = useState<number | null>(null);
  const offset = picked ?? (focus ? weekOffsetFor(today, focus) : 0);
  const start = addDays(today, offset * 7);
  const strip = weekStrip(start);
  const feed = useCalendarEvents(start, addDays(start, 6));
  const days = useMemo(() => eventDays(feed.data ?? [], start), [feed.data, start]);
  const listRef = useRef<HTMLElement>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null); // details row key
  /** null = the week grid; a date = that day's view (calendar-app style, like the Home tile). */
  const [selected, setSelected] = useState<string | null>(null);
  const readOnly = EVENTS_READ_ONLY;
  // The tile's "+" asks for the form (calendarFocus.ts); the read-only sample explains instead.
  const [addRequested] = useState(takeAddEventRequest);
  const [form, setForm] = useState<{ event: CalendarEvent | null } | null>(
    addRequested && !readOnly ? { event: null } : null,
  );
  const [addNote, setAddNote] = useState(addRequested && readOnly);
  const startAdd = () => (readOnly ? setAddNote(true) : setForm({ event: null }));
  const crmEvents = useEvents().data;

  useEffect(() => {
    if (focus && !feed.isPending) {
      const t = window.setTimeout(() => jumpTo(focus), 0);
      return () => window.clearTimeout(t);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus, feed.isPending]);

  const jumpTo = (date: string) => {
    listRef.current
      ?.querySelector<HTMLElement>(`[data-day="${date}"]`)
      ?.scrollIntoView?.({ behavior: "smooth", block: "nearest" });
    setFlash(date);
    window.setTimeout(() => setFlash((d) => (d === date ? null : d)), 1400);
  };

  const monthName = parseWhen(start).toLocaleDateString("en-US", { month: "long" });
  const year = parseWhen(start).getFullYear();

  return (
    <div className="cal3" data-testid="calendar-v3">
      <header className="cal3-head">
        <div>
          <h3 className="cal3-title">Calendar · Events</h3>
          {readOnly && <p className="cal3-note">Read-only sample</p>}
        </div>
        <Button type="button" size="sm" onClick={startAdd}>
          <Plus size={14} aria-hidden="true" /> Add event
        </Button>
      </header>
      {addNote && (
        <p role="status" className="cal3-add-note">
          This is the read-only sample, so events can't be saved here. In your Gatherly, Add event
          saves it to your calendar.
        </p>
      )}
      <div className="cal3-nav">
        <p className="cal3-month">
          {monthName} {year}
        </p>
        <div className="cal3-nav-tools">
          <button type="button" className={cn("cal3-today", focusRing)} onClick={() => { setOffset(0); setSelected(null); }}>
            Today
          </button>
          <button type="button" aria-label="Previous week" className={focusRing} onClick={() => { setOffset(offset - 1); setSelected(null); }}>
            <ChevronLeft size={16} aria-hidden="true" />
          </button>
          {selected && (
            <button type="button" className={cn("cal3-today", focusRing)} onClick={() => setSelected(null)}>
              Week
            </button>
          )}
          <span className="cal3-range" aria-live="polite">{weekRange(start)}</span>
          <button type="button" aria-label="Next week" className={focusRing} onClick={() => { setOffset(offset + 1); setSelected(null); }}>
            <ChevronRight size={16} aria-hidden="true" />
          </button>
        </div>
      </div>
      <ol className="cal3-strip" aria-label="Week">
        {strip.map(({ date, day }, i) => {
          const label = stripLabel(days[i]);
          return (
            <li key={date}>
              <button
                type="button"
                className={cn("cal3-cell", focusRing)}
                aria-label={`${listHeading(date, today)}: ${label === "–" ? "no events" : label}`}
                aria-pressed={selected ? date === selected : undefined}
                onClick={() => {
                  setSelected(date === selected ? null : date);
                  jumpTo(date);
                }}
              >
                <span className="cal3-wd">
                  {parseWhen(date).toLocaleDateString("en-US", { weekday: "short" }).toUpperCase()}
                </span>
                <span className="cal3-day" aria-current={date === today ? "date" : undefined}>
                  {day}
                </span>
                <span className="cal3-count" data-on={label !== "–" || undefined}>{label}</span>
              </button>
            </li>
          );
        })}
      </ol>
      <div className="cal3-grid">
        <TimeGrid
          // The week stays under the strip; a selected day shows its events side by side in its column.
          days={strip.map((d) => d.date)}
          selected={selected}
          today={today}
          events={feed.data ?? []}
          // The selected day's blocks jump to the event in the list below; another day's block selects it.
          onOpenEvent={(date) => (date === selected ? jumpTo(date) : setSelected(date))}
        />
      </div>
      <div className="cal3-body">
        <section className="cal3-list" aria-label="This week's events" ref={listRef}>
          <h4 className="cal3-sub">This week's events</h4>
          {feed.isPending ? (
            <p role="status" className="cal3-empty">Loading events…</p>
          ) : feed.error ? (
            <p role="alert" className="cal3-empty">
              Couldn't load the calendar.{" "}
              <button type="button" className="underline" onClick={() => void feed.refetch()}>Retry</button>
            </p>
          ) : (
            days.map((day) => (
              <div key={day.date} className="cal3-day-group" data-day={day.date} data-flash={flash === day.date || undefined}>
                <h5>
                  {listHeading(day.date, today)}
                  {day.rows.length === 0 && <span className="cal3-none">Nothing scheduled</span>}
                </h5>
                <ul>
                  {day.rows.map((row) => (
                    <EventListRow
                      key={row.key}
                      row={row}
                      expanded={open === row.key}
                      readOnly={readOnly}
                      crm={crmEvents?.find((c) => String(row.ref) === `event:${c.id}`)}
                      onInfo={() => setOpen(open === row.key ? null : row.key)}
                      onEdit={() => setForm({ event: row.event })}
                    />
                  ))}
                </ul>
              </div>
            ))
          )}
        </section>
        <Suggestions start={start} today={today} />
      </div>
      {form && <EventDialog event={form.event} defaultDate={today} onClose={() => setForm(null)} />}
    </div>
  );
};

const EventListRow = ({
  row,
  expanded,
  readOnly,
  crm,
  onInfo,
  onEdit,
}: {
  row: EventRow;
  expanded: boolean;
  readOnly: boolean;
  crm?: CrmEvent;
  onInfo: () => void;
  onEdit: () => void;
}) => (
  <li className="cal3-row">
    <time>{row.time}</time>
    <i className="cal3-dot" data-kind={row.kind} aria-hidden="true" />
    <div className="cal3-what">
      <p className="cal3-name">
        {row.key_date && <span aria-hidden="true">♥ </span>}
        {row.title}
      </p>
      <p className="cal3-meta">
        {row.place && <>{row.place} · </>}
        {row.sourceUrl ? (
          <a href={row.sourceUrl} target="_blank" rel="noreferrer" className="underline">
            {row.provenance} ↗
          </a>
        ) : (
          row.provenance
        )}
      </p>
      {expanded && (
        <dl className="cal3-detail">
          <dt>Date</dt>
          <dd>
            {parseWhen(row.event.date).toLocaleDateString("en-US", {
              weekday: "long",
              month: "long",
              day: "numeric",
            })}
            , {row.time}
          </dd>
          {row.place && (
            <>
              <dt>Place</dt>
              <dd>{row.place}</dd>
            </>
          )}
          <dt>Type</dt>
          <dd>{row.kind}</dd>
          <dt>Source</dt>
          <dd>{row.provenance}</dd>
          {crm && <InviteReview event={crm} readOnly={readOnly} />}
        </dl>
      )}
    </div>
    {row.editable && !readOnly ? (
      <button type="button" className={cn("cal3-icon", focusRing)} aria-label={`Edit ${row.title}`} onClick={onEdit}>
        <Pencil size={14} aria-hidden="true" />
      </button>
    ) : (
      <span />
    )}
    <button
      type="button"
      className={cn("cal3-icon", focusRing)}
      aria-label={`Details for ${row.title}`}
      aria-expanded={expanded}
      onClick={onInfo}
    >
      <Info size={14} aria-hidden="true" />
    </button>
  </li>
);

/** Add / edit dialog wired to the mutations; saves and deletes offer Undo. */
const EventDialog = ({
  event,
  defaultDate,
  onClose,
}: {
  event: CalendarEvent | null;
  defaultDate: string;
  onClose: () => void;
}) => {
  const create = useCreateEvent();
  const update = useUpdateEvent();
  const remove = useDeleteEvent();
  const undo = useUndoEvent();
  const id = event ? eventId(event.ref) : null;
  const full = useOrgEvents(Boolean(event)).data?.find((e) => e.id === id) ?? null;
  const initial = useMemo(
    () => (event ? formFromEvent(event, full) : emptyForm(defaultDate)),
    [event, full, defaultDate],
  );
  const offerUndo = (message: string, token?: string | null) =>
    toast(message, {
      action: token
        ? {
            label: "Undo",
            onClick: () => undo.mutate(token, { onError: (e) => toast.error(eventErrorMessage(e)) }),
          }
        : undefined,
    });
  return (
    <EventForm
      open
      editing={Boolean(event)}
      initial={initial}
      onClose={onClose}
      onSave={async (input) => {
        if (event && id != null) {
          const r = await update.mutateAsync({ id, ...input });
          offerUndo("Event updated", r.undo_token);
        } else {
          const r = await create.mutateAsync(input);
          offerUndo(`Added "${input.title}"`, r.undo_token);
        }
      }}
      onDelete={
        event && id != null
          ? async () => {
              const r = await remove.mutateAsync(id);
              offerUndo("Event deleted", r.undo_token);
            }
          : undefined
      }
    />
  );
};

/** Suggested by the agent: event-related to-dos from the events agent's real data. */
const Suggestions = ({ start, today }: { start: string; today: string }) => {
  const events = useEvents();
  const createTask = useCreateTask();
  const [added, setAdded] = useState<Set<string>>(new Set());
  const suggestions = useMemo(
    () => buildSuggestions(events.data ?? [], start, today),
    [events.data, start, today],
  );
  return (
    <aside className="cal3-suggest" aria-label="Suggested by the agent">
      <h4 className="cal3-sub">
        <Sparkles size={12} aria-hidden="true" /> Suggested by the agent
      </h4>
      {suggestions.length === 0 ? (
        <p className="cal3-empty">{events.isPending ? "Loading…" : "No suggestions this week"}</p>
      ) : (
        <ul>
          {suggestions.map((s) => {
            const done = added.has(s.key);
            return (
              <li key={s.key} className="cal3-sug">
                <p className="cal3-name">{s.title}</p>
                <p className="cal3-meta">{s.detail}</p>
                {!EVENTS_READ_ONLY && (
                <button
                  type="button"
                  className={cn("cal3-add", focusRing)}
                  disabled={done || createTask.isPending}
                  onClick={() =>
                    createTask.mutate(s.task, {
                      onSuccess: () => setAdded((set) => new Set(set).add(s.key)),
                      onError: (e) => toast.error(e instanceof Error ? e.message : "Couldn't add the to-do."),
                    })
                  }
                >
                  {done ? "Added to to-do ✓" : "Add to to-do"}
                </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </aside>
  );
};

/** Review invites -> plan the event's outreach batch -> Open batch (/campaigns/<id>). */
const InviteReview = ({ event, readOnly }: { event: CrmEvent; readOnly: boolean }) => {
  const plan = usePlanEventOutreach();
  const navigate = useNavigate();
  const batchId = plan.data?.batch_id ?? event.batch_id;
  const drafts = event.drafts_ready ?? 0;
  if (!batchId && !drafts && !(event.audience_count ?? 0)) return null;
  return (
    <>
      <dt>Invites</dt>
      <dd>
        {batchId ? (
          <button type="button" className={cn("cal3-add", focusRing)} onClick={() => navigate(`/campaigns/${batchId}`)}>
            Open batch
          </button>
        ) : readOnly ? (
          <span>{drafts} drafted</span>
        ) : (
          <button type="button" className={cn("cal3-add", focusRing)} disabled={plan.isPending} onClick={() => plan.mutate(event.id)}>
            {plan.isPending ? "Planning…" : "Review invites"}
          </button>
        )}
        {plan.isError && (
          <span role="alert" className="block text-destructive">{(plan.error as Error).message}</span>
        )}
      </dd>
    </>
  );
};
