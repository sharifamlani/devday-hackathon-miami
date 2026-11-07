import { useMemo, useState } from "react";
import {
  Calendar,
  dateFnsLocalizer,
  type Event as RbcEvent,
} from "react-big-calendar";
import { format, getDay, parse, startOfWeek } from "date-fns";
import { enUS } from "date-fns/locale/en-US";
import { CalendarDays, ExternalLink, MapPin } from "lucide-react";
import "react-big-calendar/lib/css/react-big-calendar.css";

import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

import {
  useContextStatus,
  useEvent,
  useEvents,
} from "../providers/local/crmHooks";
import { TABS, TAB_LABELS } from "../providers/local/crmTypes";
import type {
  CrmEvent,
  CrmEventDetail,
  Tab,
} from "../providers/local/crmTypes";
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
  kindInfo,
  type Family,
} from "./eventKinds";
import "./calendar.css";

// react-big-calendar (MIT) with date-fns, which the app already ships.
const localizer = dateFnsLocalizer({
  format,
  parse,
  startOfWeek,
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
  id: number;
  family: Family;
}

const FamilyBadge = ({ family }: { family: Family }) => (
  <span
    className="rounded-full px-2 py-0.5 text-[12px] font-medium"
    style={{
      background: FAMILY_COLORS[family].bg,
      color: FAMILY_COLORS[family].fg,
    }}
  >
    {FAMILY_LABELS[family]}
  </span>
);

/**
 * Event calendar: a month grid and an agenda list of the org's upcoming
 * events. Events come from the events agent (useEvents); we never invent any.
 * `onOpenBatch` lets the host open its chat panel on a batch id; without it
 * the batch id is shown in the side panel.
 */
export const CalendarPage = ({
  onOpenBatch,
}: {
  onOpenBatch?: (batchId: string) => void;
}) => {
  const { data, isPending, error } = useEvents();
  const status = useContextStatus();
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [date, setDate] = useState<Date | null>(null);

  const [hidden, setHidden] = useState<Family[]>([]);
  const allEvents = useMemo(() => sortByStart(placeable(data ?? [])), [data]);
  const events = useMemo(
    () => allEvents.filter((e) => !hidden.includes(kindInfo(e).family)),
    [allEvents, hidden],
  );
  const calEvents: CalEvent[] = useMemo(
    () =>
      events.map((e) => ({
        id: e.id,
        family: kindInfo(e).family,
        title: e.title,
        start: new Date(e.starts_at),
        end: e.ends_at ? new Date(e.ends_at) : new Date(e.starts_at),
        allDay: !e.ends_at,
      })),
    [events],
  );
  // Open on the month of the next event, not an empty current month.
  const shownDate = date ?? calEvents[0]?.start ?? new Date();

  return (
    <section aria-labelledby="calendar-title" className="space-y-5 pb-8">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1
          id="calendar-title"
          className="text-2xl font-semibold tracking-tight"
        >
          Calendar
        </h1>
        {status.data?.label ? (
          <p className="text-[13px] text-muted-foreground">
            {status.data.label}
          </p>
        ) : null}
      </div>

      {isPending ? (
        <p role="status" className="text-sm text-muted-foreground">
          Loading events…
        </p>
      ) : error ? (
        <p role="alert" className="text-sm text-destructive">
          Could not load events.
        </p>
      ) : allEvents.length === 0 ? (
        <div
          className="rounded-2xl bg-card p-8 text-center"
          data-testid="calendar-empty"
        >
          <CalendarDays
            className="mx-auto mb-2 size-6 text-muted-foreground"
            aria-hidden
          />
          <p className="font-medium">
            No upcoming events found yet. Run context refresh.
          </p>
        </div>
      ) : (
        <>
        <div role="group" aria-label="Filter by event type" className="flex flex-wrap gap-2">
          {FAMILIES.map((f) => {
            const on = !hidden.includes(f);
            return (
              <button
                key={f}
                type="button"
                aria-pressed={on}
                onClick={() =>
                  setHidden((h) => (on ? [...h, f] : h.filter((x) => x !== f)))
                }
                className="rounded-full border px-3 py-1 text-[13px] font-medium transition-opacity focus-visible:outline-2"
                style={{
                  background: on ? FAMILY_COLORS[f].bg : "transparent",
                  color: on ? FAMILY_COLORS[f].fg : "inherit",
                  opacity: on ? 1 : 0.6,
                }}
              >
                {FAMILY_LABELS[f]}
              </button>
            );
          })}
        </div>
        <div className="grid gap-6 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          <div
            className="donor-calendar rounded-2xl bg-card p-4"
            style={{ height: 560 }}
          >
            <Calendar<CalEvent>
              localizer={localizer}
              events={calEvents}
              views={["month"]}
              defaultView="month"
              date={shownDate}
              onNavigate={setDate}
              onSelectEvent={(e) => setSelectedId(e.id)}
              eventPropGetter={(e) => ({
                style: {
                  background: FAMILY_COLORS[e.family].bg,
                  color: FAMILY_COLORS[e.family].fg,
                },
              })}
              popup
            />
          </div>
          <AgendaList events={events} onSelect={setSelectedId} />
        </div>
        </>
      )}

      <EventPanel
        eventId={selectedId}
        onClose={() => setSelectedId(null)}
        onOpenBatch={onOpenBatch}
      />
    </section>
  );
};

const AgendaList = ({
  events,
  onSelect,
}: {
  events: CrmEvent[];
  onSelect: (id: number) => void;
}) => (
  <div>
    <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
      Upcoming
    </h2>
    <ul className="space-y-3">
      {events.map((e) => (
        <AgendaItem key={e.id} event={e} onSelect={onSelect} />
      ))}
    </ul>
  </div>
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
    <li className="rounded-2xl bg-card p-4">
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
            <blockquote className="whitespace-pre-wrap rounded-xl bg-muted p-3">
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
          >
            {plan.isPending ? "Planning…" : "Review"}
          </Button>
          <div aria-live="polite" className="mt-2">
            {plan.isError ? (
              <p role="alert" className="text-destructive">
                {(plan.error as Error).message}
              </p>
            ) : null}
            {plan.data && batchId ? (
              onOpenBatch ? (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => onOpenBatch(batchId)}
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
