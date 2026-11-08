import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { ChevronLeft, ChevronRight, Heart } from "lucide-react";

import { cn } from "@/lib/utils";
import {
  addDays,
  addMonths,
  formatMonthTitle,
  fromIsoDate,
  mondayIndex,
  monthOf,
  toIsoDate,
  type MonthRef,
} from "./dates";
import { describeDay, monthWeeks, type DayMarks } from "./calendarMonth";

const inMonth = (iso: string, month: MonthRef) => {
  const ref = monthOf(iso);
  return ref.year === month.year && ref.month === month.month;
};

/** Same day-of-month in another month, clamped to its last day. */
const shiftMonth = (iso: string, delta: number) => {
  const date = fromIsoDate(iso);
  const target = new Date(date.getFullYear(), date.getMonth() + delta, 1);
  const lastDay = new Date(
    target.getFullYear(),
    target.getMonth() + 1,
    0,
  ).getDate();
  target.setDate(Math.min(date.getDate(), lastDay));
  return toIsoDate(target);
};

const WEEKDAYS = [
  ["Mon", "Monday"],
  ["Tue", "Tuesday"],
  ["Wed", "Wednesday"],
  ["Thu", "Thursday"],
  ["Fri", "Friday"],
  ["Sat", "Saturday"],
  ["Sun", "Sunday"],
] as const;

/** The dots under a day number. Shapes differ too, so colour is never the only cue. */
const DayDots = ({
  marks,
  selected,
}: {
  marks: DayMarks | undefined;
  selected: boolean;
}) => {
  if (!marks) return <span className="h-1.5" aria-hidden="true" />;
  return (
    <span className="flex h-1.5 items-center gap-[3px]" aria-hidden="true">
      {marks.planned > 0 && (
        <span className="size-1.5 rounded-full border border-current" />
      )}
      {marks.done > 0 && (
        <span
          className={cn(
            "size-1.5 rounded-full",
            selected ? "bg-brand-foreground" : "bg-brand",
          )}
        />
      )}
      {marks.campaignEnds.length > 0 && (
        <span className="size-1.5 rotate-45 bg-chart-3" />
      )}
      {marks.events.length > 0 && (
        <span className="h-1.5 w-2.5 rounded-full bg-chart-4" />
      )}
    </span>
  );
};

export interface MonthGridProps {
  month: MonthRef;
  onMonthChange: (month: MonthRef) => void;
  marks: Map<string, DayMarks>;
  today: string;
  selected?: string | null;
  onSelectDay: (date: string) => void;
  /** Visible heading above the grid (e.g. "Your outreach days"). */
  title: string;
  /** Extra controls next to the month switcher. */
  actions?: ReactNode;
  className?: string;
}

/**
 * Accessible month grid (Mon-Sun) shared by the home calendar card and the
 * calendar page's planner. Keyboard: arrows move by day/week, Home/End go to
 * the start/end of the week, PageUp/PageDown change month, Enter or Space
 * picks the day. Only the focused day is in the tab order (roving tabindex).
 * Colours come from the surrounding card (text-current), so it works on the
 * dark calendar card and on a light card.
 */
export const MonthGrid = ({
  month,
  onMonthChange,
  marks,
  today,
  selected = null,
  onSelectDay,
  title,
  actions,
  className,
}: MonthGridProps) => {
  const titleId = useId();
  const monthId = useId();
  const [focusDate, setFocusDate] = useState<string>(() =>
    selected && inMonth(selected, month)
      ? selected
      : inMonth(today, month)
        ? today
        : toIsoDate(new Date(month.year, month.month, 1)),
  );
  const shouldFocus = useRef(false);
  const gridRef = useRef<HTMLTableElement>(null);

  // Keep the roving focus inside the month being shown.
  const activeDate = inMonth(focusDate, month)
    ? focusDate
    : selected && inMonth(selected, month)
      ? selected
      : inMonth(today, month)
        ? today
        : toIsoDate(new Date(month.year, month.month, 1));

  useEffect(() => {
    if (!shouldFocus.current) return;
    shouldFocus.current = false;
    gridRef.current
      ?.querySelector<HTMLButtonElement>(`[data-date="${activeDate}"]`)
      ?.focus();
  }, [activeDate]);

  const moveTo = (date: string) => {
    shouldFocus.current = true;
    setFocusDate(date);
    if (!inMonth(date, month)) onMonthChange(monthOf(date));
  };

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, date: string) => {
    const offset = mondayIndex(date);
    const next: Record<string, () => string> = {
      ArrowLeft: () => addDays(date, -1),
      ArrowRight: () => addDays(date, 1),
      ArrowUp: () => addDays(date, -7),
      ArrowDown: () => addDays(date, 7),
      Home: () => addDays(date, -offset),
      End: () => addDays(date, 6 - offset),
      PageUp: () => shiftMonth(date, -1),
      PageDown: () => shiftMonth(date, 1),
    };
    const target = next[event.key];
    if (!target) return;
    event.preventDefault();
    moveTo(target());
  };

  const changeMonth = (delta: number) => {
    const nextMonth = addMonths(month, delta);
    setFocusDate(toIsoDate(new Date(nextMonth.year, nextMonth.month, 1)));
    onMonthChange(nextMonth);
  };

  const weeks = monthWeeks(month.year, month.month);
  const monthTitle = formatMonthTitle(month);

  return (
    <div className={cn("flex flex-col gap-4", className)}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id={titleId} className="text-lg font-semibold tracking-[-0.3px]">
          {title}
        </h2>
        <div className="flex items-center gap-1">
          {actions}
          <button
            type="button"
            onClick={() => changeMonth(-1)}
            aria-label={`Previous month, ${formatMonthTitle(addMonths(month, -1))}`}
            className="grid size-11 place-items-center rounded-full hover:bg-current/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            <ChevronLeft className="size-4" aria-hidden="true" />
          </button>
          <p
            id={monthId}
            aria-live="polite"
            className="min-w-[7.5rem] text-center text-sm font-medium"
          >
            {monthTitle}
          </p>
          <button
            type="button"
            onClick={() => changeMonth(1)}
            aria-label={`Next month, ${formatMonthTitle(addMonths(month, 1))}`}
            className="grid size-11 place-items-center rounded-full hover:bg-current/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            <ChevronRight className="size-4" aria-hidden="true" />
          </button>
        </div>
      </div>

      <table
        ref={gridRef}
        role="grid"
        aria-labelledby={`${titleId} ${monthId}`}
        className="w-full table-fixed border-separate border-spacing-0.5"
      >
        <thead>
          <tr>
            {WEEKDAYS.map(([short, long]) => (
              <th
                key={long}
                scope="col"
                abbr={long}
                className="pb-1 text-center text-[11px] font-semibold tracking-wide opacity-75"
              >
                {short.slice(0, 1)}
                <span className="sr-only">{short.slice(1)}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {weeks.map((week) => (
            <tr key={week[0].date}>
              {week.map((cell) => {
                const dayMarks = marks.get(cell.date);
                const isSelected = selected === cell.date;
                const isToday = today === cell.date;
                return (
                  <td
                    key={cell.date}
                    role="gridcell"
                    aria-selected={isSelected}
                    className="p-0 text-center"
                  >
                    <button
                      type="button"
                      data-date={cell.date}
                      tabIndex={cell.date === activeDate ? 0 : -1}
                      aria-label={describeDay(cell.date, dayMarks, today)}
                      aria-current={isToday ? "date" : undefined}
                      onClick={() => {
                        setFocusDate(cell.date);
                        if (!cell.inMonth) onMonthChange(monthOf(cell.date));
                        onSelectDay(cell.date);
                      }}
                      onKeyDown={(event) => onKeyDown(event, cell.date)}
                      className={cn(
                        "relative mx-auto flex min-h-11 w-full max-w-12 flex-col items-center justify-center gap-0.5 rounded-full text-sm tabular-nums transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring",
                        !cell.inMonth && "opacity-55",
                        isSelected
                          ? "bg-brand font-semibold text-brand-foreground"
                          : "hover:bg-current/10",
                        isToday &&
                          !isSelected &&
                          "font-bold ring-1 ring-current ring-inset",
                        dayMarks?.giveMiamiDay &&
                          !isSelected &&
                          "ring-2 ring-brand ring-inset",
                      )}
                    >
                      <span aria-hidden="true">{cell.day}</span>
                      <DayDots marks={dayMarks} selected={isSelected} />
                      {dayMarks?.giveMiamiDay && (
                        <Heart
                          className="absolute top-0.5 right-1 size-2.5 fill-current"
                          aria-hidden="true"
                        />
                      )}
                    </button>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

/** Key for the dots; pass only the kinds the grid can show. */
export const MonthLegend = ({
  kinds = ["today", "planned", "done", "campaignEnds", "giveMiamiDay"],
  className,
}: {
  kinds?: (
    "today" | "planned" | "done" | "campaignEnds" | "events" | "giveMiamiDay"
  )[];
  className?: string;
}) => {
  const items = {
    today: {
      label: "Today",
      mark: (
        <span className="size-3 rounded-full ring-1 ring-current ring-inset" />
      ),
    },
    planned: {
      label: "Planned outreach",
      mark: <span className="size-2 rounded-full border border-current" />,
    },
    done: {
      label: "Done",
      mark: <span className="size-2 rounded-full bg-brand" />,
    },
    campaignEnds: {
      label: "Campaign or goal ends",
      mark: <span className="size-2 rotate-45 bg-chart-3" />,
    },
    events: {
      label: "Event",
      mark: <span className="h-2 w-3 rounded-full bg-chart-4" />,
    },
    giveMiamiDay: {
      label: "Give Miami Day",
      mark: <Heart className="size-3 fill-current" />,
    },
  } as const;
  return (
    <ul
      aria-label="Calendar key"
      className={cn("flex flex-wrap gap-x-4 gap-y-1.5 text-xs", className)}
    >
      {kinds.map((kind) => (
        <li key={kind} className="flex items-center gap-1.5">
          <span aria-hidden="true" className="grid size-3 place-items-center">
            {items[kind].mark}
          </span>
          {items[kind].label}
        </li>
      ))}
    </ul>
  );
};
