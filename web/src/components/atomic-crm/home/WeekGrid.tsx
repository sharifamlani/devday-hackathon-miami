import { useEffect, useRef } from "react";
import type { CalendarItem } from "../providers/local/calendarFeed";
import { parseWhen } from "../providers/local/parseWhen";
import { cn } from "@/lib/utils";
import { focusRing } from "./tile";

/** Height of one hour in the grid, px. */
export const HOUR_PX = 30;
/** Events carry only a start time here, so a block shows one hour (as a calendar app does by default). */
const BLOCK_MINUTES = 60;
/** The grid always shows at least 9a–1p, widened to fit every timed event. */
const DEFAULT_START = 9 * 60;
const DEFAULT_END = 13 * 60;

type GridEvent = CalendarItem & { event_kind?: string | null };

export const startMinutes = (time: string | null): number | null => {
  const match = time?.match(/^(\d{2}):(\d{2})/);
  return match && Number(match[1]) < 24 && Number(match[2]) < 60
    ? Number(match[1]) * 60 + Number(match[2])
    : null;
};

/** "fundraising" | "stewardship" | "community" | "other": the same colors as the full calendar. */
export const eventKind = (event: GridEvent) =>
  ["fundraising", "stewardship", "community"].includes(event.event_kind ?? "")
    ? (event.event_kind as string)
    : "other";

/** "9a", "12p", "3p". */
export const hourLabel = (mins: number) => {
  const hour = Math.floor(mins / 60);
  return `${hour % 12 || 12}${hour >= 12 && hour < 24 ? "p" : "a"}`;
};

/** "10:00", "9:30" for a block. */
const shortTime = (mins: number) =>
  `${Math.floor(mins / 60) % 12 || 12}:${String(mins % 60).padStart(2, "0")}`;

/** The hour window that fits every timed event, on whole hours. */
export const hourWindow = (events: GridEvent[]) => {
  const starts = events
    .map((e) => startMinutes(e.time))
    .filter((m): m is number => m != null);
  const start = Math.min(
    DEFAULT_START,
    ...starts.map((m) => Math.floor(m / 60) * 60),
  );
  const end = Math.max(
    DEFAULT_END,
    ...starts.map((m) =>
      Math.min(24 * 60, Math.ceil((m + BLOCK_MINUTES) / 60) * 60),
    ),
  );
  return { start, end };
};

export interface PlacedEvent {
  event: GridEvent;
  start: number;
  /** Side-by-side lanes when blocks overlap, as in a calendar app. */
  lane: number;
  lanes: number;
  /** Events whose blocks overlap share a cluster (the week view shows a cluster as one block). */
  cluster: number;
}

/** One day's timed events in lanes: overlapping blocks share the column width. */
export const placeDay = (events: GridEvent[]): PlacedEvent[] => {
  const timed = events
    .map((event) => ({ event, start: startMinutes(event.time)! }))
    .filter((e) => e.start != null)
    .sort(
      (a, b) => a.start - b.start || a.event.title.localeCompare(b.event.title),
    );
  const placed: PlacedEvent[] = [];
  let cluster: PlacedEvent[] = [];
  let clusterEnd = -1;
  let clusterId = -1;
  const closeCluster = () => {
    const lanes = Math.max(1, ...cluster.map((p) => p.lane + 1));
    for (const p of cluster) p.lanes = lanes;
    cluster = [];
  };
  for (const item of timed) {
    if (item.start >= clusterEnd) {
      closeCluster();
      clusterId += 1;
    }
    const taken = new Set(
      cluster
        .filter((p) => p.start + BLOCK_MINUTES > item.start)
        .map((p) => p.lane),
    );
    let lane = 0;
    while (taken.has(lane)) lane += 1;
    const p = { ...item, lane, lanes: 1, cluster: clusterId };
    cluster.push(p);
    placed.push(p);
    clusterEnd = Math.max(clusterEnd, item.start + BLOCK_MINUTES);
  }
  closeCluster();
  return placed;
};

/** Placed events grouped by cluster, in time order. */
const clusters = (placed: PlacedEvent[]) => {
  const groups: PlacedEvent[][] = [];
  for (const p of placed) {
    const last = groups[groups.length - 1];
    if (last && last[0].cluster === p.cluster) last.push(p);
    else groups.push([p]);
  }
  return groups;
};

const longDate = (date: string) =>
  parseWhen(date).toLocaleDateString("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
  });

const describe = (event: GridEvent, date: string) => {
  const mins = startMinutes(event.time);
  const when =
    mins == null
      ? "all day"
      : `${shortTime(mins)} ${mins >= 720 ? "PM" : "AM"}`;
  return `${event.title}, ${longDate(date)}, ${when}${event.source === "agent" ? ", added by the agent" : ""}`;
};

const nowMinutes = () => {
  const now = new Date();
  return now.getHours() * 60 + now.getMinutes();
};

/** The browser's own date, YYYY-MM-DD: the demo's "today" can be a fixed service date. */
const localDate = () => new Date().toLocaleDateString("en-CA");

/**
 * Hour grid for one or more days (the Home tile's week and day views): an all-day row, hour lines,
 * and colored blocks by event type. Clicking a block opens that day's plan.
 */
export const TimeGrid = ({
  days,
  today,
  events,
  onOpenEvent,
  detailed = false,
}: {
  days: string[];
  today: string;
  events: GridEvent[];
  onOpenEvent: (date: string) => void;
  /** Day view: full titles and times. */
  detailed?: boolean;
}) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const byDay = (day: string) =>
    events.filter((e) => e.date.slice(0, 10) === day && !e.done);
  const inRange = events.filter(
    (e) => days.includes(e.date.slice(0, 10)) && !e.done,
  );
  const { start, end } = hourWindow(inRange);
  const hours = Array.from(
    { length: (end - start) / 60 },
    (_, i) => start + i * 60,
  );
  const allDay = days.map((day) =>
    byDay(day).filter((e) => startMinutes(e.time) == null),
  );
  const firstTimed = Math.min(
    ...inRange.map((e) => startMinutes(e.time) ?? Infinity),
  );
  const now = nowMinutes();
  const showNow =
    today === localDate() && days.includes(today) && now >= start && now <= end;
  const range = days.join(",");
  // A block's top, pulled up so a late-night block ends at the bottom edge instead of past it.
  const blockTop = (mins: number, length = BLOCK_MINUTES) =>
    ((Math.min(mins, end - length) - start) / 60) * HOUR_PX + 1;

  // Open on the first event (or 9a), not at midnight.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const anchor = Number.isFinite(firstTimed)
      ? Math.floor(firstTimed / 60) * 60
      : DEFAULT_START;
    el.scrollTop = ((anchor - start) / 60) * HOUR_PX;
    // Only when the viewed days or the window change, never on an unrelated re-render.
  }, [firstTimed, start, range]);

  const block = (event: GridEvent, date: string, key: string) => (
    <button
      key={key}
      type="button"
      data-kind={eventKind(event)}
      className={cn("home-cal-event", focusRing)}
      aria-label={describe(event, date)}
      title={describe(event, date)}
      onClick={() => onOpenEvent(date)}
    >
      {detailed && startMinutes(event.time) != null && (
        <time>{shortTime(startMinutes(event.time)!)}</time>
      )}
      <span>{event.title}</span>
    </button>
  );

  return (
    <div className="home-cal-grid" data-detailed={detailed || undefined}>
      {allDay.some((list) => list.length > 0) && (
        <div
          className="home-cal-allday"
          style={{ "--cal-days": days.length } as React.CSSProperties}
        >
          <span className="home-cal-gutter">all-day</span>
          {days.map((day, i) => (
            <div key={day}>
              {allDay[i].map((event, n) =>
                block(event, day, `${event.ref ?? event.title}-${n}`),
              )}
            </div>
          ))}
        </div>
      )}
      <div ref={scrollRef} className="home-cal-scroll">
        <div
          className="home-cal-hours"
          style={
            {
              "--cal-days": days.length,
              height: hours.length * HOUR_PX,
            } as React.CSSProperties
          }
        >
          {hours.map((mins, i) => (
            <span
              key={mins}
              className="home-cal-hour"
              style={{ top: i * HOUR_PX }}
            >
              {hourLabel(mins)}
            </span>
          ))}
          {days.map((day, col) => (
            <div
              key={day}
              className="home-cal-column"
              data-today={day === today || undefined}
              style={{ gridColumn: col + 2 }}
            >
              {detailed
                ? placeDay(byDay(day)).map((p, n) => (
                    <div
                      key={`${p.event.ref ?? p.event.title}-${n}`}
                      className="home-cal-slot"
                      style={{
                        top: blockTop(p.start),
                        height: (BLOCK_MINUTES / 60) * HOUR_PX - 2,
                        // Day view: overlapping blocks side by side.
                        left: `calc(${(p.lane / p.lanes) * 100}% + 1px)`,
                        width: `calc(${100 / p.lanes}% - 2px)`,
                      }}
                    >
                      {block(p.event, day, "b")}
                    </div>
                  ))
                : clusters(placeDay(byDay(day))).map((group, n) => (
                    // Week view: columns are narrow, so overlapping events share one block ("2 events");
                    // tapping it opens the day view, where each has its own block.
                    <div
                      key={`${group[0].event.ref ?? group[0].event.title}-${n}`}
                      className="home-cal-slot"
                      style={{
                        top: blockTop(
                          group[0].start,
                          Math.min(
                            group[group.length - 1].start +
                              BLOCK_MINUTES -
                              group[0].start,
                            end - start,
                          ),
                        ),
                        height:
                          (Math.min(
                            group[group.length - 1].start +
                              BLOCK_MINUTES -
                              group[0].start,
                            end - start,
                          ) /
                            60) *
                            HOUR_PX -
                          2,
                        left: 1,
                        right: 1,
                      }}
                    >
                      {group.length === 1 ? (
                        block(group[0].event, day, "b")
                      ) : (
                        <button
                          type="button"
                          data-kind={eventKind(group[0].event)}
                          className={cn("home-cal-event", focusRing)}
                          aria-label={`${group.length} events: ${group.map((p) => describe(p.event, day)).join("; ")}`}
                          title={group.map((p) => p.event.title).join("\n")}
                          onClick={() => onOpenEvent(day)}
                        >
                          {group.map((p, i) => (
                            <span key={i}>{p.event.title}</span>
                          ))}
                        </button>
                      )}
                    </div>
                  ))}
              {showNow && day === today && (
                <i
                  aria-hidden="true"
                  className="home-cal-now"
                  style={{ top: ((now - start) / 60) * HOUR_PX }}
                />
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
