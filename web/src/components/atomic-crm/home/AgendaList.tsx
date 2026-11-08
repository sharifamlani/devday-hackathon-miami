import { useId, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { Link } from "react-router";
import { zoomClick } from "./workspaceView";
import { requestAddEvent } from "../calendar/calendarFocus";
import type { CalendarItem } from "../providers/local/calendarFeed";
import { useCalendarEvents } from "../providers/local/events";
import { addDays } from "../outreach/dates";
import { parseWhen } from "../providers/local/parseWhen";
import { cn } from "@/lib/utils";
import { tile, focusRing } from "./tile";

const LIST_DAYS = 14;

export interface AgendaRow {
  key: string;
  /** "9:00 AM", or "All day". */
  time: string;
  label: string;
  byAgent: boolean;
}
export interface AgendaDay {
  date: string;
  rows: AgendaRow[];
}
export interface StripDay {
  date: string;
  /** Weekday initial from the date itself, never a fixed M..S header. */
  letter: string;
  day: number;
}

const minutes = (time: string | null): number | null => {
  const match = time?.match(/^(\d{2}):(\d{2})/);
  return match && Number(match[1]) < 24 && Number(match[2]) < 60
    ? Number(match[1]) * 60 + Number(match[2])
    : null;
};

/** Minutes since midnight -> "9:00 AM". */
export const clock = (mins: number) =>
  `${Math.floor(mins / 60) % 12 || 12}:${String(mins % 60).padStart(2, "0")} ${mins >= 720 ? "PM" : "AM"}`;

/** Seven consecutive days starting at `start` (the week strip). */
export const weekStrip = (start: string): StripDay[] =>
  Array.from({ length: 7 }, (_, i) => {
    const date = addDays(start, i);
    return {
      date,
      letter: parseWhen(date).toLocaleDateString("en-US", {
        weekday: "narrow",
      }),
      day: Number(date.slice(8, 10)),
    };
  });

/** "Nov 8 – 14", or "Nov 29 – Dec 5" across a month end. */
export const weekRange = (start: string) => {
  const end = addDays(start, 6);
  const month = (d: string) =>
    parseWhen(d).toLocaleDateString("en-US", { month: "short" });
  return `${month(start)} ${Number(start.slice(8, 10))} – ${
    month(start) === month(end) ? "" : `${month(end)} `
  }${Number(end.slice(8, 10))}`;
};

/** "Today · Sunday, Nov 8" / "Tuesday, Nov 10". */
export const dayHeading = (date: string, today: string) => {
  const text = parseWhen(date).toLocaleDateString("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
  });
  return date === today ? `Today · ${text}` : text;
};

/**
 * Organization events from `start` for `days` days, grouped by day (soonest first, empty days omitted).
 * Within a day: "All day" rows first, then timed rows by time. Today is always listed
 * when it is in range, empty or not.
 */
export const agendaDays = (
  items: CalendarItem[],
  start: string,
  today: string,
  days = LIST_DAYS,
): AgendaDay[] => {
  const end = addDays(start, days - 1);
  const byDate = new Map<string, CalendarItem[]>();
  for (const item of items) {
    const date = item.date.slice(0, 10);
    if (item.kind !== "event" || item.done || date < start || date > end) continue;
    byDate.set(date, [...(byDate.get(date) ?? []), item]);
  }
  const row = (i: CalendarItem, n: number): AgendaRow => ({
    key: `${i.ref ?? i.title}-${n}`,
    time: minutes(i.time) == null ? "All day" : clock(minutes(i.time)!),
    label: i.title,
    byAgent: i.source === "agent",
  });
  if (today >= start && today <= end && !byDate.has(today))
    byDate.set(today, []);
  return [...byDate.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, list]) => ({
      date,
      rows: [
        ...list
          .filter((i) => minutes(i.time) == null && i.kind === "event")
          .map(row),
        ...list
          .filter((i) => minutes(i.time) != null)
          .sort((a, b) => minutes(a.time)! - minutes(b.time)!)
          .map(row),
      ],
    }));
};

/**
 * The overview's calendar: a month heading, a seven-day strip from today (a dot marks days with
 * items), then a list through time. Not a grid: no hour slots. The arrows move both by a week.
 */
export const AgendaList = ({
  today,
  onOpenDay,
}: {
  today: string;
  onOpenDay: (date: string) => void;
}) => {
  const headingId = useId();
  const [offset, setOffset] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const start = addDays(today, offset * 7);
  const strip = weekStrip(start);
  const feed = useCalendarEvents(start, addDays(start, LIST_DAYS - 1));
  const days = agendaDays(feed.data ?? [], start, today);
  const hasItems = new Set(
    days.filter((d) => d.rows.length).map((d) => d.date),
  );
  const month = parseWhen(start).toLocaleDateString("en-US", {
    month: "long",
  });
  const jumpTo = (date: string) => {
    const list = listRef.current;
    const heading = list?.querySelector<HTMLElement>(`[data-day="${date}"]`);
    if (list && heading)
      list.scrollTo({
        top: heading.offsetTop - list.offsetTop,
        behavior: "smooth",
      });
  };
  return (
    <section
      data-zoom-source="calendar"
      className={cn(tile, "home-agenda")}
      aria-labelledby={headingId}
    >
      <div className="home-calendar-heading">
        <div>
          <h2 id={headingId}>
            <Link
              to="/calendar"
              onClick={zoomClick("calendar")}
              className={cn(
                "-mx-1 rounded-sm px-1 hover:underline hover:underline-offset-4 hover:decoration-2",
                focusRing,
              )}
              title="Open full calendar"
              aria-label="Open full calendar"
            >
              {month}
            </Link>
            <kbd
              aria-hidden="true"
              className="ml-2 hidden align-baseline font-sans text-[11px] font-normal text-muted-foreground md:inline"
            >
              Alt+C
            </kbd>
          </h2>
          <p className="text-xs text-muted-foreground" aria-live="polite">
            {weekRange(start)}
          </p>
        </div>
        <div className="home-calendar-tools">
          <button
            type="button"
            aria-label="Previous week"
            className={focusRing}
            onClick={() => setOffset((value) => value - 1)}
          >
            <ChevronLeft size={14} aria-hidden="true" />
          </button>
          <button
            type="button"
            aria-label="Next week"
            className={focusRing}
            onClick={() => setOffset((value) => value + 1)}
          >
            <ChevronRight size={14} aria-hidden="true" />
          </button>
          <button
            type="button"
            aria-label="Add event"
            title="Add event"
            className={cn("home-calendar-add", focusRing)}
            onClick={(e) => {
              requestAddEvent();
              zoomClick("calendar")(e);
            }}
          >
            <Plus size={15} aria-hidden="true" />
          </button>
        </div>
      </div>
      <ol className="home-agenda-strip" aria-label="Week">
        {strip.map(({ date, letter, day }) => (
          <li key={date}>
            <span aria-hidden="true">{letter}</span>
            <button
              type="button"
              aria-current={date === today ? "date" : undefined}
              aria-label={dayHeading(date, today)}
              className={focusRing}
              onClick={() => jumpTo(date)}
            >
              {day}
            </button>
            <i aria-hidden="true" data-on={hasItems.has(date) || undefined} />
          </li>
        ))}
      </ol>
      <div ref={listRef} className="home-agenda-list">
        {feed.isPending ? (
          <p role="status" className="text-xs text-muted-foreground">
            Loading calendar…
          </p>
        ) : feed.error ? (
          <p role="alert" className="text-xs text-muted-foreground">
            Couldn’t load the calendar.{" "}
            <button type="button" onClick={() => void feed.refetch()}>
              Retry
            </button>
          </p>
        ) : days.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            Nothing scheduled in the next two weeks.
          </p>
        ) : (
          days.map((day) => (
            <div key={day.date} className="home-agenda-day" data-day={day.date}>
              <h3>
                {dayHeading(day.date, today)}
                {day.rows.length === 0 && " — nothing scheduled"}
              </h3>
              <ul>
                {day.rows.map((row) => (
                  <li key={row.key}>
                    <button
                      type="button"
                      className={cn("home-agenda-row", focusRing)}
                      title={`${row.label}${row.byAgent ? " (added by agent)" : ""}`}
                      onClick={() => onOpenDay(day.date)}
                    >
                      <time>{row.time}</time>
                      <span>{row.label}</span>
                      {row.byAgent && (
                        <i role="img" aria-label="added by agent">
                          🤖
                        </i>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))
        )}
      </div>
    </section>
  );
};
