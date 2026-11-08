import { useId, useState, type FormEvent } from "react";
import { CalendarPlus, Sparkles, Trash2 } from "lucide-react";

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { formatDayLong, formatDayShort } from "./dates";
import { itemsOn, type OutreachPlanItem } from "./outreachPlan";
import { useOutreachPlan } from "./usePlan";
import type { Recommendation } from "./recommend";

export interface PlannerOption {
  id: number;
  name: string;
}

export const AGENT_LABEL =
  "Recommended by the outreach agent (rules over your data)";

const pill =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-full px-4 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-60";

/**
 * Side sheet for one day of the outreach plan: what is planned (mark done,
 * note, remove), add a donor or campaign by hand, and the agent's
 * recommendations to add with one click. Shared by the home calendar card and
 * the calendar page. Plan storage: outreachPlan.ts (this browser, per viewer).
 */
export const DayPlanner = ({
  date,
  onClose,
  donors,
  campaigns = [],
  recommendations = [],
  dayNotes = [],
}: {
  date: string | null;
  onClose: () => void;
  donors: PlannerOption[];
  campaigns?: PlannerOption[];
  recommendations?: Recommendation[];
  /** Read-only facts about the day, e.g. "Give Miami Day", event titles. */
  dayNotes?: string[];
}) => (
  <Sheet open={date != null} onOpenChange={(open) => !open && onClose()}>
    <SheetContent
      side="right"
      className="w-full overflow-y-auto bg-surface sm:max-w-md"
    >
      {date && (
        <DayPlannerBody
          date={date}
          donors={donors}
          campaigns={campaigns}
          recommendations={recommendations}
          dayNotes={dayNotes}
        />
      )}
    </SheetContent>
  </Sheet>
);

const DayPlannerBody = ({
  date,
  donors,
  campaigns,
  recommendations,
  dayNotes,
}: {
  date: string;
  donors: PlannerOption[];
  campaigns: PlannerOption[];
  recommendations: Recommendation[];
  dayNotes: string[];
}) => {
  const plan = useOutreachPlan();
  const [status, setStatus] = useState("");
  const dayItems = itemsOn(plan.items, date);
  const forDay = recommendations.filter((rec) => rec.date === date);
  const others = recommendations.filter((rec) => rec.date !== date).slice(0, 4);
  const plannedHeading = useId();
  const recHeading = useId();

  const addRecommendation = (rec: Recommendation) => {
    const added = plan.add({
      date,
      donor_id: rec.donor_id,
      campaign_id: rec.campaign_id,
      label: rec.label,
      note: rec.reason,
      source: "agent",
    });
    setStatus(
      added
        ? `Added ${rec.label} to ${formatDayShort(date)}.`
        : `${rec.label} is already planned for ${formatDayShort(date)}.`,
    );
  };

  return (
    <>
      <SheetHeader className="pr-12">
        <SheetTitle className="text-lg">Outreach plan</SheetTitle>
        <SheetDescription>{formatDayLong(date)}</SheetDescription>
      </SheetHeader>
      <div className="flex flex-col gap-6 px-4 pb-8">
        {dayNotes.length > 0 && (
          <ul className="flex flex-wrap gap-2" aria-label="On this day">
            {dayNotes.map((note) => (
              <li
                key={note}
                className="rounded-full bg-brand-soft px-3 py-1 text-xs font-medium text-brand-soft-foreground"
              >
                {note}
              </li>
            ))}
          </ul>
        )}

        <p role="status" aria-live="polite" className="sr-only">
          {status}
        </p>
        {!plan.saved && (
          <p
            role="alert"
            className="rounded-2xl bg-alert p-3 text-sm text-alert-foreground"
          >
            This browser would not save the plan. It stays only while this tab
            is open.
          </p>
        )}

        <section
          aria-labelledby={plannedHeading}
          className="flex flex-col gap-3"
        >
          <h3 id={plannedHeading} className="text-sm font-semibold">
            Planned{" "}
            <span className="font-normal text-muted-foreground">
              ({dayItems.length})
            </span>
          </h3>
          {dayItems.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nothing planned for this day yet.
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {dayItems.map((item) => (
                <PlanRow
                  key={item.id}
                  item={item}
                  onToggle={(done) => {
                    plan.update(item.id, { done });
                    setStatus(
                      `${item.label} marked ${done ? "done" : "not done"}.`,
                    );
                  }}
                  onNote={(note) => plan.update(item.id, { note })}
                  onRemove={() => {
                    plan.remove(item.id);
                    setStatus(
                      `Removed ${item.label} from ${formatDayShort(date)}.`,
                    );
                  }}
                />
              ))}
            </ul>
          )}
        </section>

        <AddToDay
          date={date}
          donors={donors}
          campaigns={campaigns}
          onAdded={setStatus}
        />

        {(forDay.length > 0 || others.length > 0) && (
          <section aria-labelledby={recHeading} className="flex flex-col gap-3">
            <div>
              <h3
                id={recHeading}
                className="flex items-center gap-1.5 text-sm font-semibold"
              >
                <Sparkles className="size-4" aria-hidden="true" />
                Suggestions
              </h3>
              <p className="text-xs text-muted-foreground">{AGENT_LABEL}</p>
            </div>
            <ul className="flex flex-col gap-2">
              {[...forDay, ...others].map((rec) => (
                <li key={rec.key} className="rounded-2xl bg-card p-3">
                  <p className="text-sm font-medium">{rec.label}</p>
                  <p className="text-xs text-muted-foreground">{rec.reason}</p>
                  <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                    <span className="text-xs text-muted-foreground">
                      {rec.date === date
                        ? "Suggested for this day"
                        : `Suggested for ${formatDayShort(rec.date)}`}
                    </span>
                    <button
                      type="button"
                      onClick={() => addRecommendation(rec)}
                      className={cn(
                        pill,
                        "bg-primary text-primary-foreground hover:bg-primary/85",
                      )}
                    >
                      <CalendarPlus className="size-4" aria-hidden="true" />
                      Plan for {formatDayShort(date)}
                      <span className="sr-only">: {rec.label}</span>
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}

        <p className="text-xs text-muted-foreground">
          The plan is saved in this browser for you only. Nothing is sent to
          donors from here.
        </p>
      </div>
    </>
  );
};

const PlanRow = ({
  item,
  onToggle,
  onNote,
  onRemove,
}: {
  item: OutreachPlanItem;
  onToggle: (done: boolean) => void;
  onNote: (note: string) => void;
  onRemove: () => void;
}) => {
  const checkId = useId();
  const noteId = useId();
  const [note, setNote] = useState(item.note);
  return (
    <li className={cn("rounded-2xl bg-card p-3", item.done && "opacity-80")}>
      <div className="flex items-start gap-3">
        <input
          id={checkId}
          type="checkbox"
          checked={item.done}
          onChange={(event) => onToggle(event.target.checked)}
          className="mt-0.5 size-5 shrink-0 accent-primary"
        />
        <label htmlFor={checkId} className="min-w-0 flex-1">
          <span
            className={cn(
              "block text-sm font-medium",
              item.done && "line-through",
            )}
          >
            {item.label}
          </span>
          <span className="block text-xs text-muted-foreground">
            {item.detail ?? (item.campaign_id != null ? "Campaign" : "Donor")}
            {item.source === "agent"
              ? " · suggested by the outreach agent"
              : ""}
            {item.done ? " · done" : ""}
          </span>
        </label>
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Remove ${item.label}`}
          className="grid size-11 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
        >
          <Trash2 className="size-4" aria-hidden="true" />
        </button>
      </div>
      <label htmlFor={noteId} className="sr-only">
        Note for {item.label}
      </label>
      <textarea
        id={noteId}
        value={note}
        rows={2}
        placeholder="Add a note"
        onChange={(event) => setNote(event.target.value)}
        onBlur={() => note !== item.note && onNote(note.trim())}
        className="mt-2 w-full resize-y rounded-xl border border-border bg-surface px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-2 focus-visible:outline-ring"
      />
    </li>
  );
};

const AddToDay = ({
  date,
  donors,
  campaigns,
  onAdded,
}: {
  date: string;
  donors: PlannerOption[];
  campaigns: PlannerOption[];
  onAdded: (message: string) => void;
}) => {
  const plan = useOutreachPlan();
  const selectId = useId();
  const noteId = useId();
  const errorId = useId();
  const [choice, setChoice] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    const [kind, rawId] = choice.split(":");
    const id = Number(rawId);
    const option = (kind === "campaign" ? campaigns : donors).find(
      (entry) => entry.id === id,
    );
    if (!option) {
      setError("Choose a donor or campaign to plan.");
      return;
    }
    const added = plan.add({
      date,
      donor_id: kind === "donor" ? id : null,
      campaign_id: kind === "campaign" ? id : null,
      label: option.name,
      note,
    });
    if (!added) {
      setError(`${option.name} is already planned for this day.`);
      return;
    }
    setError(null);
    setChoice("");
    setNote("");
    onAdded(`Added ${option.name} to ${formatDayShort(date)}.`);
  };

  return (
    <form
      onSubmit={onSubmit}
      className="flex flex-col gap-3 rounded-2xl bg-card p-4"
    >
      <h3 className="text-sm font-semibold">Add to this day</h3>
      <div className="flex flex-col gap-1">
        <label htmlFor={selectId} className="text-xs font-medium">
          Donor or campaign
        </label>
        <select
          id={selectId}
          value={choice}
          onChange={(event) => {
            setChoice(event.target.value);
            setError(null);
          }}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          className="min-h-11 rounded-xl border border-border bg-surface px-3 text-sm focus-visible:outline-2 focus-visible:outline-ring"
        >
          <option value="">Choose…</option>
          {donors.length > 0 && (
            <optgroup label="Donors">
              {donors.map((donor) => (
                <option key={donor.id} value={`donor:${donor.id}`}>
                  {donor.name}
                </option>
              ))}
            </optgroup>
          )}
          {campaigns.length > 0 && (
            <optgroup label="Campaigns">
              {campaigns.map((campaign) => (
                <option key={campaign.id} value={`campaign:${campaign.id}`}>
                  {campaign.name}
                </option>
              ))}
            </optgroup>
          )}
        </select>
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor={noteId} className="text-xs font-medium">
          Note (optional)
        </label>
        <input
          id={noteId}
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder="e.g. Thank her for the October gift"
          className="min-h-11 rounded-xl border border-border bg-surface px-3 text-sm placeholder:text-muted-foreground focus-visible:outline-2 focus-visible:outline-ring"
        />
      </div>
      {error && (
        <p id={errorId} role="alert" className="text-sm text-alert-foreground">
          {error}
        </p>
      )}
      <button
        type="submit"
        className={cn(
          pill,
          "w-fit bg-primary text-primary-foreground hover:bg-primary/85",
        )}
      >
        <CalendarPlus className="size-4" aria-hidden="true" />
        Add to {formatDayShort(date)}
      </button>
    </form>
  );
};
