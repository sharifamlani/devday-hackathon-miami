import { useId, useState } from "react";
import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import {
  useCalendarFeed,
  type CalendarItem,
} from "../providers/local/calendarFeed";
import { addDays } from "../outreach/dates";
import { weekDays } from "./homeData";
import { cn } from "@/lib/utils";
import { tile, focusRing } from "./tile";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";

const weekday = ["M", "T", "W", "T", "F", "S", "S"];
const formatDate = (date: string) =>
  new Date(`${date}T12:00:00`).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
const minutes = (time: string | null): number | null => {
  const match = time?.match(/^(\d{2}):(\d{2})/);
  return match && Number(match[1]) < 24 && Number(match[2]) < 60
    ? Number(match[1]) * 60 + Number(match[2])
    : null;
};
const tone = (event: CalendarItem) =>
  event.kind === "event"
    ? "meeting"
    : event.task_kind === "call"
      ? "call"
      : "campaign";

const kindNames: Record<string, [string, string]> = {
  call: ["call", "calls"],
  review: ["review", "reviews"],
  email: ["email", "emails"],
  prep: ["prep", "preps"],
  event: ["event", "events"],
};

/**
 * A day's untimed items for the "All day" row: one block per kind ("5 calls", "9 reviews"), so a busy
 * day stays readable in a narrow column; a lone item keeps its own title. Order: events, then by size.
 */
export const allDayGroups = (items: CalendarItem[]) => {
  const byKind = new Map<string, CalendarItem[]>();
  for (const item of items) {
    const key = item.kind === "event" ? "event" : item.task_kind ?? "other";
    byKind.set(key, [...(byKind.get(key) ?? []), item]);
  }
  return [...byKind.entries()]
    .sort(([a, x], [b, y]) => (a === "event" ? -1 : b === "event" ? 1 : y.length - x.length))
    .map(([key, group]) => ({
      items: group,
      label:
        group.length === 1
          ? group[0].title
          : `${group.length} ${(kindNames[key] ?? ["item", "items"])[1]}`,
    }));
};

/** Seven-day service feed. Missing times stay in the all-day row; none are invented. */
export const WeekCalendarTile = ({
  today,
  onOpenDay,
}: {
  today: string;
  onOpenDay: (date: string) => void;
}) => {
  const headingId = useId();
  const [offset, setOffset] = useState(0);
  const [selected, setSelected] = useState<CalendarItem[]>([]);
  const days = weekDays(addDays(today, offset * 7));
  const feed = useCalendarFeed(days[0], days[6]);
  const events = (feed.data ?? []).filter((event) => !event.done);
  const timed = events.filter((event) => minutes(event.time) != null);
  const allDay = events.filter((event) => minutes(event.time) == null);
  const start = Math.min(
    9 * 60,
    ...timed.map((event) => Math.floor(minutes(event.time)! / 60) * 60),
  );
  const end = Math.max(
    13 * 60,
    ...timed.map((event) =>
      Math.min(24 * 60, (Math.floor(minutes(event.time)! / 60) + 1) * 60),
    ),
  );
  const step = Math.max(60, Math.ceil((end - start) / 240) * 60);
  const period = step * 4;
  const month = new Date(`${days[0]}T12:00:00`).toLocaleDateString("en-US", {
    month: "long",
  });
  const eventButton = (
    event: CalendarItem,
    index: number,
    timedEvent: boolean,
    group: CalendarItem[] = [event],
    label?: string,
  ) => (
    <button
      key={`${event.ref ?? event.title}-${index}`}
      type="button"
      className={`home-calendar-event ${tone(event)}`}
      title={`${group.map((item) => item.title).join("; ")} · ${formatDate(event.date.slice(0, 10))}${event.time ? ` · ${event.time}` : " · All day"}`}
      aria-label={`${group.length > 1 ? `${label ?? `${group.length} events`}: ` : ""}${group.map((item) => item.title).join("; ")}, ${formatDate(event.date.slice(0, 10))}, ${event.time ?? "all day"}`}
      onClick={() => setSelected(group)}
      style={
        timedEvent
          ? {
              top: `${Math.min(((minutes(event.time)! - start) / period) * 136, 106)}px`,
              height: 30,
            }
          : undefined
      }
    >
      {timedEvent && <time>{event.time?.slice(0, 5)}</time>}
      <span>{label ?? (group.length > 1 ? `${group.length} events` : event.title)}</span>
    </button>
  );
  return (
    <section className={cn(tile, "home-calendar")} aria-labelledby={headingId}>
      <div className="home-calendar-heading">
        <div>
          <h2 id={headingId}>{month}</h2>
          <p className="text-xs text-muted-foreground" aria-live="polite">
            {Number(days[0].slice(8))}–{Number(days[6].slice(8))}{" "}
            {new Date(`${days[6]}T12:00:00`).toLocaleDateString("en-US", {
              month: "short",
            })}
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
            aria-label="Add to calendar"
            className={cn("home-calendar-add", focusRing)}
            onClick={() => onOpenDay(days[0])}
          >
            <Plus size={15} aria-hidden="true" />
          </button>
        </div>
      </div>
      <div className="home-week-days">
        <span />
        {days.map((day, i) => (
          <div key={day}>
            <span>{weekday[i]}</span>
            <button
              type="button"
              aria-current={day === today ? "date" : undefined}
              aria-label={`Plan ${formatDate(day)}`}
              onClick={() => onOpenDay(day)}
            >
              {Number(day.slice(8))}
            </button>
          </div>
        ))}
      </div>
      {feed.isPending ? (
        <p role="status" className="home-calendar-status">
          Loading calendar…
        </p>
      ) : feed.error ? (
        <p role="alert" className="home-calendar-status">
          Couldn’t load this week.{" "}
          <button type="button" onClick={() => void feed.refetch()}>
            Retry
          </button>
        </p>
      ) : (
        <>
          {allDay.length > 0 && (
            <div className="home-week-all-day">
              <span>All day</span>
              {days.map((day) => (
                <div key={day}>
                  {allDayGroups(allDay.filter((event) => event.date.slice(0, 10) === day)).map((g, i) =>
                    eventButton(g.items[0], i, false, g.items, g.label),
                  )}
                </div>
              ))}
            </div>
          )}
          <div className="home-week-hours">
            {[0, 1, 2, 3].map((i) => {
              const hour = Math.round((start + (i * period) / 4) / 60);
              return (
                <span
                  className="home-week-hour"
                  style={{ top: i * 34 }}
                  key={i}
                >
                  {hour % 12 || 12}
                  {hour >= 12 ? "p" : "a"}
                </span>
              );
            })}
            {days.map((day) => {
              // In a narrow week column, nearby events share a block and an accessible details list.
              const groups: { items: CalendarItem[]; bottom: number }[] = [];
              timed
                .filter((event) => event.date.slice(0, 10) === day)
                .sort((a, b) => minutes(a.time)! - minutes(b.time)!)
                .forEach((event) => {
                  const top = Math.min(
                    ((minutes(event.time)! - start) / period) * 136,
                    106,
                  );
                  const last = groups[groups.length - 1];
                  if (last && top < last.bottom) {
                    last.items.push(event);
                    last.bottom = Math.max(last.bottom, top + 30);
                  } else groups.push({ items: [event], bottom: top + 30 });
                });
              return (
                <div className="home-week-column" key={day}>
                  {groups.map((group, i) =>
                    eventButton(group.items[0], i, true, group.items),
                  )}
                </div>
              );
            })}
          </div>
          {!events.length && (
            <p className="sr-only">No events or tasks this week.</p>
          )}
        </>
      )}
      <Dialog
        open={selected.length > 0}
        onOpenChange={(open) => {
          if (!open) setSelected([]);
        }}
      >
        <DialogContent>
          <DialogTitle>
            {selected.length > 1 ? "Calendar events" : selected[0]?.title}
          </DialogTitle>
          <DialogDescription>
            {selected[0] && formatDate(selected[0].date.slice(0, 10))}
          </DialogDescription>
          <ul className="grid gap-3">
            {selected.map((event, i) => (
              <li key={`${event.ref}-${i}`}>
                <p className="font-medium">{event.title}</p>
                <time className="text-xs text-muted-foreground">
                  {event.time ?? "All day"}
                </time>
              </li>
            ))}
          </ul>
          <button
            type="button"
            className="justify-self-start rounded-full bg-brand px-4 py-2 text-brand-foreground"
            onClick={() => {
              if (selected[0]) onOpenDay(selected[0].date.slice(0, 10));
              setSelected([]);
            }}
          >
            Open day plan
          </button>
        </DialogContent>
      </Dialog>
    </section>
  );
};
