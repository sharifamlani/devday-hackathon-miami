import { useId, useState } from "react";
import { CalendarPlus, Sparkles } from "lucide-react";

import type { DayMarks } from "../outreach/calendarMonth";
import { formatDayShort, type MonthRef } from "../outreach/dates";
import { AGENT_LABEL } from "../outreach/DayPlanner";
import { MonthGrid, MonthLegend } from "../outreach/MonthGrid";
import type { Recommendation } from "../outreach/recommend";

/**
 * The dark "plan outreach" card beside the month view: a keyboard-navigable
 * month grid (pick a day to open its plan) and the outreach agent's next few
 * recommendations, each one click from the plan.
 */
export const PlannerCard = ({
  month,
  onMonthChange,
  marks,
  today,
  selected,
  onSelectDay,
  recommendations,
  recommendationsError,
  onPlan,
}: {
  month: MonthRef;
  onMonthChange: (month: MonthRef) => void;
  marks: Map<string, DayMarks>;
  today: string;
  selected: string | null;
  onSelectDay: (date: string) => void;
  recommendations: Recommendation[];
  recommendationsError: boolean;
  onPlan: (rec: Recommendation) => boolean;
}) => {
  const recHeading = useId();
  const [status, setStatus] = useState("");
  return (
    <section
      aria-label="Plan outreach"
      className="flex flex-col gap-5 rounded-[24px] bg-primary p-5 text-primary-foreground sm:p-6 dark:bg-card dark:text-card-foreground"
    >
      <MonthGrid
        title="Plan outreach by day"
        month={month}
        onMonthChange={onMonthChange}
        marks={marks}
        today={today}
        selected={selected}
        onSelectDay={onSelectDay}
      />
      <MonthLegend
        kinds={[
          "today",
          "planned",
          "done",
          "events",
          "campaignEnds",
          "giveMiamiDay",
        ]}
      />

      <div className="flex flex-col gap-3 border-t border-current/15 pt-4">
        <div>
          <h2
            id={recHeading}
            className="flex items-center gap-1.5 text-base font-semibold"
          >
            <Sparkles className="size-4" aria-hidden="true" />
            Recommended outreach
          </h2>
          <p className="text-xs opacity-80">{AGENT_LABEL}</p>
        </div>
        <p role="status" aria-live="polite" className="sr-only">
          {status}
        </p>
        {recommendationsError ? (
          <p className="text-sm opacity-80">
            Donor data isn’t available here, so there are no recommendations.
          </p>
        ) : recommendations.length === 0 ? (
          <p className="text-sm opacity-80">
            Everyone who needs a call is already on your plan.
          </p>
        ) : (
          <ul aria-labelledby={recHeading} className="flex flex-col gap-2">
            {recommendations.map((rec) => (
              <li
                key={rec.key}
                className="flex flex-col gap-2 rounded-2xl bg-current/10 p-3"
              >
                <div>
                  <p className="text-sm font-semibold">{rec.label}</p>
                  <p className="text-xs opacity-80">{rec.reason}</p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    const added = onPlan(rec);
                    setStatus(
                      added
                        ? `Planned ${rec.label} for ${formatDayShort(rec.date)}.`
                        : `${rec.label} is already planned for ${formatDayShort(rec.date)}.`,
                    );
                  }}
                  className="inline-flex min-h-11 w-fit items-center gap-2 rounded-full bg-brand px-4 text-sm font-medium text-brand-foreground hover:bg-brand/85 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                >
                  <CalendarPlus className="size-4" aria-hidden="true" />
                  Plan for {formatDayShort(rec.date)}
                  <span className="sr-only">: {rec.label}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
};
