import { useMemo, useState } from "react";
import {
  Calendar,
  dateFnsLocalizer,
  type Event as RbcEvent,
} from "react-big-calendar";
import { format, getDay, parse, startOfWeek } from "date-fns";
import { enUS } from "date-fns/locale/en-US";
import {
  CalendarCheck,
  CalendarDays,
  ExternalLink,
  MapPin,
} from "lucide-react";
import "react-big-calendar/lib/css/react-big-calendar.css";

import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

import {
  useContextStatus,
  useEvent,
  useEvents,
} from "../providers/local/crmHooks";
import { useDonors } from "../providers/local/hooks";
import { TABS, TAB_LABELS } from "../providers/local/crmTypes";
import type {
  CrmEvent,
  CrmEventDetail,
  Tab,
} from "../providers/local/crmTypes";
import { computeDayMarks } from "../outreach/calendarMonth";
import { formatDayShort, monthOf, toIsoDate } from "../outreach/dates";
import { DayPlanner } from "../outreach/DayPlanner";
import {
  useOutreachPlan,
  type OutreachPlanItem,
} from "../outreach/outreachPlan";
import { recommendOutreach } from "../outreach/recommend";
import {
  countByTab,
  placeable,
  sortByStart,
  usePlanEventOutreach,
} from "./calendarData";
import {
  FAMILIES,
  FAMILY_COLORS,
  FAMILY_LABELS,
  PLAN_COLORS,
  PLAN_LABEL,
  kindInfo,
  type Family,
} from "./eventKinds";
import {
  campaignEndsFrom,
  eventDays,
  giveMiamiDayFrom,
  mergeAgenda,
  planCalendarEntries,
} from "./planLayer";
import { PlannerCard } from "./PlannerCard";
import "./calendar.css";

// react-big-calendar (MIT) with date-fns, which the app already ships.
// Weeks start on Monday, like the planner grid.
const localizer = dateFnsLocalizer({
  format,
  parse,
  startOfWeek: (date: Date) => startOfWeek(date, { weekStartsOn: 1 }),
  getDay,
  locales: { "en-US": enUS },
});

const when = (iso: string) =>
  new Date(iso).toLocaleString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

interface CalEvent extends RbcEvent {
  id: number | string;
  family: Family | "plan";
  /** Set for the viewer's outreach-plan entries. */
  item?: OutreachPlanItem;
}

const FamilyBadge = ({ family }: { family: Family }) => (
  <span
    className="rounded-full px-2.5 py-0.5 text-[12px] font-medium"
    style={{
      background: FAMILY_COLORS[family].bg,
      color: FAMILY_COLORS[family].fg,
    }}
  >
    {FAMILY_LABELS[family]}
  </span>
);

const chip =
  "inline-flex min-h-11 items-center gap-2 rounded-full border border-border px-4 text-[13px] font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

/**
 * Event calendar: a month grid and an agenda list of the org's upcoming
 * events. Events come from the events agent (useEvents); we never invent any.
 * Alongside them, the viewer's outreach plan (outreach/outreachPlan.ts): pick a
 * day, add donors or campaigns, take the outreach agent's recommendations,
 * mark them done. `onOpenBatch` lets the host open its chat panel on a batch
 * id; without it the batch id is shown in the side panel.
 */
export const CalendarPage = ({
  onOpenBatch,
}: {
  onOpenBatch?: (batchId: string) => void;
}) => {
  const { data, isPending, error } = useEvents();
  const status = useContextStatus();
  const donors = useDonors();
  const plan = useOutreachPlan();
  const today = toIsoDate(new Date());
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [planDate, setPlanDate] = useState<string | null>(null);
  const [date, setDate] = useState<Date | null>(null);

  const [hidden, setHidden] = useState<Family[]>([]);
  const [showPlan, setShowPlan] = useState(true);
  const allEvents = useMemo(() => sortByStart(placeable(data ?? [])), [data]);
  const events = useMemo(
    () => allEvents.filter((e) => !hidden.includes(kindInfo(e).family)),
    [allEvents, hidden],
  );
  const calEvents: CalEvent[] = useMemo(
    () => [
      ...events.map((e) => ({
        id: e.id,
        family: kindInfo(e).family,
        title: e.title,
        start: new Date(e.starts_at),
        end: e.ends_at ? new Date(e.ends_at) : new Date(e.starts_at),
        allDay: !e.ends_at,
      })),
      ...(showPlan
        ? planCalendarEntries(plan.items).map((entry) => ({
            ...entry,
            family: "plan" as const,
          }))
        : []),
    ],
    [events, plan.items, showPlan],
  );
  // Open on the month of the next event, not an empty current month.
  const firstEvent = allEvents[0] ? new Date(allEvents[0].starts_at) : null;
  const shownDate = date ?? firstEvent ?? new Date();
  const shownMonth = monthOf(toIsoDate(shownDate));

  const gmd = giveMiamiDayFrom(allEvents, today);
  const marks = useMemo(
    () =>
      computeDayMarks({
        plan: showPlan ? plan.items : [],
        events: eventDays(events),
        campaignEnds: campaignEndsFrom(allEvents),
        giveMiamiDay: gmd,
      }),
    [plan.items, showPlan, events, allEvents, gmd],
  );
  const recommendations = useMemo(
    () =>
      recommendOutreach(donors.data ?? [], {
        today,
        plan: plan.items,
        giveMiamiDay: gmd,
        limit: 12,
      }),
    [donors.data, today, plan.items, gmd],
  );
  const dayNotes = (day: string) => [
    ...(day === gmd ? ["Give Miami Day"] : []),
    ...allEvents
      .filter((e) => e.starts_at.slice(0, 10) === day)
      .map((e) => e.title),
  ];

  return (
    <section aria-labelledby="calendar-title" className="space-y-5 pb-8">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1
            id="calendar-title"
            className="text-2xl font-semibold tracking-[-0.8px] sm:text-3xl"
          >
            Calendar
          </h1>
          <p className="text-sm text-muted-foreground">
            The Foundation’s events and your outreach plan, side by side.
          </p>
        </div>
        {status.data?.label ? (
          <p className="rounded-full bg-quiet px-3 py-1.5 text-[13px] text-quiet-foreground">
            {status.data.label}
          </p>
        ) : null}
      </div>

      {isPending ? (
        <p role="status" className="text-sm text-muted-foreground">
          Loading events…
        </p>
      ) : error ? (
        <p role="alert" className="text-sm text-alert-foreground">
          Could not load events.
        </p>
      ) : allEvents.length === 0 ? (
        <div
          className="rounded-[24px] bg-card p-8 text-center shadow-sm"
          data-testid="calendar-empty"
        >
          <CalendarDays
            className="mx-auto mb-2 size-6 text-muted-foreground"
            aria-hidden
          />
          <p className="font-medium">
            No upcoming events found yet. Run context refresh.
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            You can still plan outreach by day below.
          </p>
        </div>
      ) : null}

      {!isPending && !error ? (
        <>
          <div
            role="group"
            aria-label="Filter by event type"
            className="flex flex-wrap gap-2"
          >
            {allEvents.length > 0 &&
              FAMILIES.map((f) => {
                const on = !hidden.includes(f);
                return (
                  <button
                    key={f}
                    type="button"
                    aria-pressed={on}
                    onClick={() =>
                      setHidden((h) =>
                        on ? [...h, f] : h.filter((x) => x !== f),
                      )
                    }
                    className={cn(chip, !on && "bg-card text-muted-foreground")}
                    style={
                      on
                        ? {
                            background: FAMILY_COLORS[f].bg,
                            color: FAMILY_COLORS[f].fg,
                            borderColor: "transparent",
                          }
                        : undefined
                    }
                  >
                    <span
                      aria-hidden="true"
                      className="size-2 rounded-full border border-current"
                      style={on ? { background: "currentColor" } : undefined}
                    />
                    {FAMILY_LABELS[f]}
                  </button>
                );
              })}
            <button
              type="button"
              aria-pressed={showPlan}
              onClick={() => setShowPlan((on) => !on)}
              className={cn(chip, !showPlan && "bg-card text-muted-foreground")}
              style={
                showPlan
                  ? {
                      background: PLAN_COLORS.bg,
                      color: PLAN_COLORS.fg,
                      borderColor: "transparent",
                    }
                  : undefined
              }
            >
              <CalendarCheck className="size-4" aria-hidden="true" />
              {PLAN_LABEL}
            </button>
          </div>
          <div className="grid gap-6 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
            <div
              className="donor-calendar rounded-[24px] bg-card p-4 shadow-sm sm:p-5"
              style={{ height: 620 }}
            >
              <Calendar<CalEvent>
                localizer={localizer}
                events={calEvents}
                views={["month"]}
                defaultView="month"
                date={shownDate}
                onNavigate={setDate}
                onSelectEvent={(e) =>
                  e.item
                    ? setPlanDate(e.item.date)
                    : setSelectedId(e.id as number)
                }
                selectable
                onSelectSlot={(slot) => setPlanDate(toIsoDate(slot.start))}
                eventPropGetter={(e) => ({
                  className: cn(
                    e.family === "plan" && "donor-calendar-plan",
                    e.item?.done && "is-done",
                  ),
                  style:
                    e.family === "plan"
                      ? { background: PLAN_COLORS.bg, color: PLAN_COLORS.fg }
                      : {
                          background: FAMILY_COLORS[e.family].bg,
                          color: FAMILY_COLORS[e.family].fg,
                        },
                })}
                popup
              />
            </div>
            <div className="flex min-w-0 flex-col gap-6">
              <PlannerCard
                month={shownMonth}
                onMonthChange={(m) => setDate(new Date(m.year, m.month, 1))}
                marks={marks}
                today={today}
                selected={planDate}
                onSelectDay={setPlanDate}
                recommendations={recommendations.slice(0, 4)}
                recommendationsError={donors.isError}
                onPlan={(rec) =>
                  plan.add({
                    date: rec.date,
                    donor_id: rec.donor_id,
                    campaign_id: rec.campaign_id,
                    label: rec.label,
                    note: rec.reason,
                    source: "agent",
                  })
                }
              />
              <AgendaList
                events={events}
                planItems={showPlan ? plan.items : []}
                today={today}
                onSelect={setSelectedId}
                onOpenDay={setPlanDate}
                onToggleDone={(item, done) => plan.update(item.id, { done })}
              />
            </div>
          </div>
        </>
      ) : null}

      <EventPanel
        eventId={selectedId}
        onClose={() => setSelectedId(null)}
        onOpenBatch={onOpenBatch}
      />
      <DayPlanner
        date={planDate}
        onClose={() => setPlanDate(null)}
        donors={(donors.data ?? [])
          .map((d) => ({ id: d.id, name: d.full_name }))
          .sort((a, b) => a.name.localeCompare(b.name))}
        recommendations={recommendations}
        dayNotes={planDate ? dayNotes(planDate) : []}
      />
    </section>
  );
};

const AgendaList = ({
  events,
  planItems,
  today,
  onSelect,
  onOpenDay,
  onToggleDone,
}: {
  events: CrmEvent[];
  planItems: OutreachPlanItem[];
  today: string;
  onSelect: (id: number) => void;
  onOpenDay: (date: string) => void;
  onToggleDone: (item: OutreachPlanItem, done: boolean) => void;
}) => {
  const entries = mergeAgenda(events, planItems, today);
  return (
    <div>
      <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
        Upcoming
      </h2>
      {entries.length === 0 ? (
        <p className="rounded-[24px] bg-card p-4 text-sm text-muted-foreground">
          Nothing coming up yet. Pick a day to plan outreach.
        </p>
      ) : (
        <ul className="space-y-3">
          {entries.map((entry) =>
            entry.kind === "event" ? (
              <AgendaItem
                key={`event-${entry.event.id}`}
                event={entry.event}
                onSelect={onSelect}
              />
            ) : (
              <PlanAgendaItem
                key={entry.item.id}
                item={entry.item}
                onOpenDay={onOpenDay}
                onToggleDone={onToggleDone}
              />
            ),
          )}
        </ul>
      )}
    </div>
  );
};

const PlanAgendaItem = ({
  item,
  onOpenDay,
  onToggleDone,
}: {
  item: OutreachPlanItem;
  onOpenDay: (date: string) => void;
  onToggleDone: (item: OutreachPlanItem, done: boolean) => void;
}) => (
  <li className="flex items-start gap-3 rounded-[24px] bg-card p-4 shadow-sm">
    <input
      type="checkbox"
      checked={item.done}
      onChange={(event) => onToggleDone(item, event.target.checked)}
      aria-label={`Mark ${item.label} done`}
      className="mt-1 size-5 shrink-0 accent-primary"
    />
    <div className="min-w-0 flex-1">
      <p className="text-[13px] text-muted-foreground">
        {formatDayShort(item.date)}
      </p>
      <button
        type="button"
        onClick={() => onOpenDay(item.date)}
        className={cn(
          "mt-0.5 text-left text-base font-semibold hover:underline focus-visible:underline",
          item.done && "line-through",
        )}
      >
        {item.campaign_id != null ? "Review " : "Contact "}
        {item.label}
        <span className="sr-only">
          : open the plan for {formatDayShort(item.date)}
        </span>
      </button>
      {item.note ? (
        <p className="mt-0.5 text-[13px] text-muted-foreground">{item.note}</p>
      ) : null}
      <div className="mt-2 flex flex-wrap items-center gap-2 text-[13px]">
        <span
          className="rounded-full px-2.5 py-0.5 text-[12px] font-medium"
          style={{ background: PLAN_COLORS.bg, color: PLAN_COLORS.fg }}
        >
          {PLAN_LABEL}
        </span>
        {item.source === "agent" ? (
          <span className="text-muted-foreground">
            suggested by the outreach agent
          </span>
        ) : null}
        {item.done ? <span className="font-medium">Done</span> : null}
      </div>
    </div>
  </li>
);

const AgendaItem = ({
  event,
  onSelect,
}: {
  event: CrmEvent;
  onSelect: (id: number) => void;
}) => {
  const detail = useEvent(event.id);
  const counts = detail.data ? countByTab(detail.data.recipients) : null;
  return (
    <li className="rounded-[24px] bg-card p-4 shadow-sm">
      <p className="text-[13px] text-muted-foreground">
        {when(event.starts_at)}
      </p>
      <button
        type="button"
        onClick={() => onSelect(event.id)}
        className="mt-0.5 text-left text-base font-semibold hover:underline focus-visible:underline"
      >
        {event.title}
      </button>
      {event.place ? (
        <p className="mt-0.5 flex items-center gap-1 text-[13px] text-muted-foreground">
          <MapPin className="size-3.5" aria-hidden /> {event.place}
        </p>
      ) : null}
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px]">
        <FamilyBadge family={kindInfo(event).family} />
        <AudienceChips counts={counts} total={event.audience_count} />
        {event.drafts_ready != null ? (
          <span className="font-medium">{event.drafts_ready} drafts ready</span>
        ) : null}
        <SourceLink url={event.source_url} />
      </div>
    </li>
  );
};

const AudienceChips = ({
  counts,
  total,
}: {
  counts: Record<Tab, number> | null;
  total: number | null;
}) => {
  if (counts && TABS.some((t) => counts[t] > 0)) {
    return (
      <span className="flex flex-wrap gap-1.5">
        {TABS.filter((t) => counts[t] > 0).map((t) => (
          <span
            key={t}
            className="rounded-full bg-brand-soft px-2 py-0.5 text-[12px] font-medium text-brand-soft-foreground"
          >
            {counts[t]} {TAB_LABELS[t]}
          </span>
        ))}
      </span>
    );
  }
  return total != null ? <span>{total} in audience</span> : null;
};

const SourceLink = ({ url }: { url: string | null }) =>
  url ? (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      aria-label="Source"
      className="inline-flex items-center gap-1 underline underline-offset-2"
    >
      src <ExternalLink className="size-3" aria-hidden />
    </a>
  ) : (
    <span className="text-muted-foreground">no source</span>
  );

const EventPanel = ({
  eventId,
  onClose,
  onOpenBatch,
}: {
  eventId: number | null;
  onClose: () => void;
  onOpenBatch?: (batchId: string) => void;
}) => {
  const { data, isPending } = useEvent(eventId);
  const plan = usePlanEventOutreach();
  return (
    <Sheet
      open={eventId != null}
      onOpenChange={(open) => {
        if (!open) {
          plan.reset();
          onClose();
        }
      }}
    >
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-md">
        {isPending || !data ? (
          <SheetHeader>
            <SheetTitle>Event</SheetTitle>
            <SheetDescription>Loading…</SheetDescription>
          </SheetHeader>
        ) : (
          <PanelBody event={data} plan={plan} onOpenBatch={onOpenBatch} />
        )}
      </SheetContent>
    </Sheet>
  );
};

const PanelBody = ({
  event,
  plan,
  onOpenBatch,
}: {
  event: CrmEventDetail;
  plan: ReturnType<typeof usePlanEventOutreach>;
  onOpenBatch?: (batchId: string) => void;
}) => {
  const counts = countByTab(event.recipients);
  const sample = event.drafts[0];
  const batchId = plan.data?.batchId ?? null;
  return (
    <>
      <SheetHeader>
        <SheetTitle className="text-lg">{event.title}</SheetTitle>
        <SheetDescription>
          {when(event.starts_at)}
          {event.place ? ` · ${event.place}` : ""}
        </SheetDescription>
      </SheetHeader>
      <div className="space-y-5 px-4 pb-6 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          <FamilyBadge family={kindInfo(event).family} />
          {kindInfo(event).lead ? (
            <span className="text-[13px] text-muted-foreground">
              Lead time: {kindInfo(event).lead} (suggested, editable)
            </span>
          ) : null}
        </div>
        <section aria-labelledby="aud-h">
          <h3 id="aud-h" className="mb-1 font-semibold">
            Audience
          </h3>
          <ul className="space-y-1">
            {TABS.map((t) => (
              <li key={t} className="flex justify-between">
                <span>{TAB_LABELS[t]}</span>
                <span className="font-medium">{counts[t]}</span>
              </li>
            ))}
          </ul>
        </section>

        <section aria-labelledby="inv-h">
          <h3 id="inv-h" className="mb-1 font-semibold">
            Sample invite ({event.drafts.length} drafts ready)
          </h3>
          {sample ? (
            <blockquote className="whitespace-pre-wrap rounded-2xl bg-surface p-3">
              {sample.subject ? (
                <strong className="block">{sample.subject}</strong>
              ) : null}
              {sample.body}
              {sample.name ? (
                <footer className="mt-2 text-[12px] text-muted-foreground">
                  To {sample.name}
                </footer>
              ) : null}
            </blockquote>
          ) : (
            <p className="text-muted-foreground">No drafts yet.</p>
          )}
        </section>

        <section aria-labelledby="src-h">
          <h3 id="src-h" className="mb-1 font-semibold">
            Source
          </h3>
          <SourceLink url={event.source_url} />
          {event.source ? (
            <span className="ml-2 text-muted-foreground">{event.source}</span>
          ) : null}
        </section>

        <div>
          <Button
            type="button"
            onClick={() => plan.mutate(event.id)}
            disabled={plan.isPending}
            className="min-h-11 rounded-full px-5"
          >
            {plan.isPending ? "Planning…" : "Review"}
          </Button>
          <div aria-live="polite" className="mt-2">
            {plan.isError ? (
              <p role="alert" className="text-alert-foreground">
                {(plan.error as Error).message}
              </p>
            ) : null}
            {plan.data && batchId ? (
              onOpenBatch ? (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => onOpenBatch(batchId)}
                  className="min-h-11 rounded-full px-5"
                >
                  Open batch {batchId}
                </Button>
              ) : (
                <p>
                  Batch ready: <code>{batchId}</code>
                </p>
              )
            ) : null}
            {plan.data && !batchId ? (
              <p>Outreach planned, but no batch id was returned.</p>
            ) : null}
          </div>
        </div>
      </div>
    </>
  );
};
