import { useId, useState } from "react";
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
import { CollapseToggle, TileBody } from "./TileCollapse";
import { useTileCollapsed } from "./collapseState";
import { TimeGrid } from "./WeekGrid";

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
    if (item.kind !== "event" || item.done || date < start || date > end)
      continue;
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
 * The overview's calendar, in a calendar app's style: a month heading, the week's dates, then an hour
 * grid with colored blocks by event type (an all-day row above it). Tapping a date opens that day's
 * view; "Week" goes back. The arrows move by a week, or by a day in the day view.
 */
export const AgendaList = ({
  today,
  onOpenDay,
}: {
  today: string;
  onOpenDay: (date: string) => void;
}) => {
  const headingId = useId();
  const bodyId = useId();
  const [collapsed, toggle] = useTileCollapsed("calendar");
  const [offset, setOffset] = useState(0);
  /** null = the week; a date = that day's view. */
  const [day, setDay] = useState<string | null>(null);
  const start = addDays(today, offset * 7);
  const strip = weekStrip(start);
  const feed = useCalendarEvents(start, addDays(start, LIST_DAYS - 1));
  const days = agendaDays(feed.data ?? [], start, today);
  // In the day view the arrows move by a day and the week follows along.
  const stepDay = (by: number) => {
    if (!day) return;
    const next = addDays(day, by);
    setDay(next);
    const weekStart = addDays(today, offset * 7);
    if (next < weekStart) setOffset((v) => v - 1);
    else if (next > addDays(weekStart, 6)) setOffset((v) => v + 1);
  };
  // Folded, the tile's subtitle names the next thing on the calendar.
  const nextUp = days.flatMap((d) => d.rows)[0]?.label;
  const weekBusy = days.some(
    (d) => d.rows.length > 0 && strip.some((s) => s.date === d.date),
  );
  const month = parseWhen(start).toLocaleDateString("en-US", {
    month: "long",
  });
  return (
    <section
      data-zoom-source="calendar"
      data-collapsed={collapsed || undefined}
      className={cn(tile, "home-agenda")}
      aria-labelledby={headingId}
    >
      <div className="home-calendar-heading">
        <div className="flex min-w-0 items-start gap-1">
          <CollapseToggle
            collapsed={collapsed}
            onToggle={toggle}
            bodyId={bodyId}
            label="calendar"
          />
          <div className="min-w-0">
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
                className={cn(
                  "ml-2 hidden align-baseline font-sans text-[11px] font-normal text-muted-foreground",
                  // The day view's Week button needs the room.
                  !day && "md:inline",
                )}
              >
                Alt+C
              </kbd>
            </h2>
            <p className="text-xs text-muted-foreground" aria-live="polite">
              {collapsed && nextUp
                ? `Next: ${nextUp}`
                : day
                  ? dayHeading(day, today)
                  : weekRange(start)}
            </p>
          </div>
        </div>
        {!collapsed && (
          <div className="home-calendar-tools">
            {day && (
              <button
                type="button"
                className={cn("home-cal-back", focusRing)}
                onClick={() => setDay(null)}
              >
                Week
              </button>
            )}
            <button
              type="button"
              aria-label={day ? "Previous day" : "Previous week"}
              className={focusRing}
              onClick={() =>
                day ? stepDay(-1) : setOffset((value) => value - 1)
              }
            >
              <ChevronLeft size={14} aria-hidden="true" />
            </button>
            <button
              type="button"
              aria-label={day ? "Next day" : "Next week"}
              className={focusRing}
              onClick={() =>
                day ? stepDay(1) : setOffset((value) => value + 1)
              }
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
        )}
      </div>
      <TileBody id={bodyId} collapsed={collapsed}>
        <ol
          className="home-agenda-strip home-cal-strip"
          aria-label="Week"
          data-day-view={day ? "" : undefined}
        >
          {strip.map(({ date, letter, day: n }) => (
            <li key={date}>
              <span aria-hidden="true">{letter}</span>
              <button
                type="button"
                aria-current={date === today ? "date" : undefined}
                aria-pressed={day ? date === day : undefined}
                aria-label={`${dayHeading(date, today)}: open the day`}
                className={focusRing}
                onClick={() => setDay(date === day ? null : date)}
              >
                {n}
              </button>
            </li>
          ))}
        </ol>
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
        ) : (
          <div key={day ?? "week"} className="motion-fade-in">
            <TimeGrid
              days={day ? [day] : strip.map((d) => d.date)}
              today={today}
              events={feed.data ?? []}
              onOpenEvent={onOpenDay}
              detailed={!!day}
            />
            {day && (
              <button
                type="button"
                className={cn("home-cal-plan", focusRing)}
                onClick={() => onOpenDay(day)}
              >
                Open day plan
              </button>
            )}
            {!weekBusy && !day && (
              <p className="mt-2 text-xs text-muted-foreground">
                Nothing scheduled this week.
              </p>
            )}
          </div>
        )}
      </TileBody>
    </section>
  );
};
