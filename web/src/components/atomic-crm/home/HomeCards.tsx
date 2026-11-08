import { useId, useState, type ReactNode } from "react";
import {
  ArrowRight,
  AudioLines,
  ChevronDown,
  Clock,
  FileText,
  Folder,
  Plus,
  Search,
} from "lucide-react";
import { Link } from "react-router";

import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type {
  CampaignSummary,
  DonationTarget,
  DonorSummary,
} from "../providers/local/types";
import type { DayMarks } from "../outreach/calendarMonth";
import { describeMarks } from "../outreach/calendarMonth";
import { formatDayLong, formatDayShort } from "../outreach/dates";
import type { CallNote } from "../voice/callNotes";
import {
  donorMeta,
  donorTag,
  formatCompactUsd,
  formatMonthDay,
  initials,
  type AgendaLine,
  type HomeTask,
} from "./homeData";
import { focusRing, tagTone, tile, tileTitle } from "./tile";

const TileHead = ({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children?: ReactNode;
}) => (
  <div className="mb-3 flex items-center justify-between gap-2">
    <h2 id={id} className={tileTitle}>
      {title}
    </h2>
    {children}
  </div>
);

const roundIcon = cn(
  "grid size-8 shrink-0 place-items-center rounded-full border border-border hover:bg-accent",
  focusRing,
);

/* ---------- Q4 progress ---------- */

const ARC = Math.PI * 44; // semicircle, r = 44

export const Q4ProgressTile = ({
  target,
  isPending,
}: {
  target: DonationTarget | undefined;
  isPending: boolean;
}) => {
  const headingId = useId();
  const gradientId = `q4-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const percent = target?.percent ?? null;
  const filled =
    percent == null ? 0 : Math.min(Math.max(percent, 0), 100) / 100;
  return (
    <section aria-labelledby={headingId} className={cn(tile, "p-4")}>
      <TileHead
        id={headingId}
        title={target ? `${target.label} outreach` : "Quarter progress"}
      />
      {isPending ? (
        <Skeleton className="h-16 w-full rounded-xl" />
      ) : !target ? (
        <p className="text-sm text-muted-foreground">
          Goals aren’t in this data yet.
        </p>
      ) : (
        <div className="home-quarter-summary">
          <div className="home-quarter-gauge">
            <svg
              className="home-quarter-arc"
              viewBox="0 0 104 60"
              aria-hidden="true"
            >
              <defs>
                <linearGradient id={gradientId} x1="0" x2="1" y1="0" y2="0">
                  <stop offset="0%" style={{ stopColor: "var(--brand)" }} />
                  <stop
                    offset="100%"
                    style={{
                      stopColor:
                        "color-mix(in oklab, var(--brand), var(--chart-2) 55%)",
                    }}
                  />
                </linearGradient>
              </defs>
              <path
                d="M 8 52 A 44 44 0 0 1 96 52"
                fill="none"
                strokeWidth="10"
                strokeLinecap="round"
                className="stroke-quiet"
              />
              {filled > 0 && (
                <path
                  d="M 8 52 A 44 44 0 0 1 96 52"
                  fill="none"
                  strokeWidth="10"
                  strokeLinecap="round"
                  stroke={`url(#${gradientId})`}
                  strokeDasharray={`${ARC * filled} ${ARC}`}
                />
              )}
            </svg>
            <span className="home-quarter-percent">
              {percent == null ? "—" : `${Math.round(percent)}%`}
            </span>
          </div>
          <dl className="grid min-w-0 gap-1 text-sm">
            <div>
              <dt className="text-xs text-muted-foreground">Raised</dt>
              <dd className="font-semibold tabular-nums">
                {formatCompactUsd(target.raised)}
                {target.goal != null && ` / ${formatCompactUsd(target.goal)}`}
              </dd>
            </div>
          </dl>
          <p className="sr-only">
            {percent == null
              ? "No goal set."
              : `${Math.round(percent)} percent of the ${target.label} goal.`}
          </p>
        </div>
      )}
    </section>
  );
};

/* ---------- Today at a glance ---------- */

const Bubble = ({
  value,
  caption,
  to,
  tone,
}: {
  value: string;
  caption: string;
  to?: string;
  tone?: "alert" | "warn";
}) => {
  const body = (
    <>
      <span
        className={cn(
          "block text-[22px] leading-tight font-bold tabular-nums",
          tone === "alert" && "text-alert-foreground",
          tone === "warn" && "text-warn-foreground",
        )}
      >
        {value}
      </span>
      <span className="block text-xs text-muted-foreground">{caption}</span>
    </>
  );
  const shell = cn(
    "block min-h-[76px] rounded-[14px] px-3 py-2.5",
    tone === "alert" ? "bg-alert" : tone === "warn" ? "bg-warn" : "bg-surface",
  );
  return to ? (
    <Link to={to} className={cn(shell, "hover:brightness-[0.97]", focusRing)}>
      {body}
    </Link>
  ) : (
    <div className={shell}>{body}</div>
  );
};

export const GlanceTile = ({
  today,
  atRisk,
  duplicates,
  tasks,
  gmdDays,
  isPending,
}: {
  today: string;
  atRisk: number | null;
  duplicates: number | null;
  tasks: number;
  gmdDays: number;
  isPending: boolean;
}) => {
  const headingId = useId();
  const show = (n: number | null) => (isPending || n == null ? "—" : String(n));
  return (
    <section
      data-tour="glance"
      aria-labelledby={headingId}
      aria-busy={isPending}
      className={cn(tile, "p-4")}
    >
      <TileHead id={headingId} title="Today at a glance">
        <span className="text-xs text-muted-foreground">
          {formatDayShort(today)}
        </span>
      </TileHead>
      <ul className="grid grid-cols-2 gap-2">
        <li>
          <Bubble
            value={show(atRisk)}
            caption={atRisk === 1 ? "gift at risk" : "gifts at risk"}
            to="/inbox?view=attention"
            tone="alert"
          />
        </li>
        <li>
          <Bubble
            value={show(duplicates)}
            caption={
              duplicates === 1 ? "possible duplicate" : "possible duplicates"
            }
            to="/inbox"
            tone="warn"
          />
        </li>
        <li>
          <Bubble
            value={isPending ? "—" : String(tasks)}
            caption={tasks === 1 ? "task today" : "tasks today"}
          />
        </li>
        <li>
          <Bubble
            value={gmdDays === 0 ? "Today" : String(gmdDays)}
            caption={
              gmdDays === 0
                ? "is Give Miami Day"
                : `${gmdDays === 1 ? "day" : "days"} to Give Miami Day`
            }
          />
        </li>
      </ul>
    </section>
  );
};

/* ---------- CRM ---------- */

export const CrmTile = ({
  donors,
  isPending,
  error,
  onFind,
  onOpenDonor,
}: {
  donors: DonorSummary[];
  isPending: boolean;
  error: Error | null;
  onFind: () => void;
  onOpenDonor: (id: number) => void;
}) => {
  const headingId = useId();
  return (
    <section
      data-tour="crm"
      aria-labelledby={headingId}
      className={cn(tile, "flex min-h-0 flex-col p-4 @min-[1081px]:flex-1")}
    >
      <TileHead id={headingId} title="CRM">
        <Link
          to="/contacts"
          className={cn(
            "inline-flex min-h-8 items-center gap-1 rounded-sm text-[13px] underline underline-offset-3 hover:decoration-2",
            focusRing,
          )}
        >
          Open database
          <ArrowRight className="size-3.5" aria-hidden="true" />
        </Link>
      </TileHead>
      <button
        type="button"
        onClick={onFind}
        aria-haspopup="dialog"
        className={cn(
          "flex min-h-11 w-full items-center gap-2 rounded-full border border-border bg-card px-3 text-left text-sm text-muted-foreground hover:bg-accent",
          focusRing,
        )}
      >
        <Search className="size-4" aria-hidden="true" />
        Find a donor
      </button>
      <h3 className="sr-only">Donors needing attention</h3>
      {error ? (
        <p role="alert" className="mt-3 text-sm text-alert-foreground">
          We couldn’t load donors: {error.message}
        </p>
      ) : isPending ? (
        <div className="mt-3 flex flex-col gap-2" aria-label="Loading donors">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-10 w-full rounded-xl" />
          ))}
        </div>
      ) : donors.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">
          No donors need attention right now.
        </p>
      ) : (
        <ul className="mt-2 -mx-1 min-h-0 flex-1 overflow-y-auto">
          {donors.map((donor) => {
            const tag = donorTag(donor);
            return (
              <li key={donor.id}>
                <button
                  type="button"
                  onClick={() => onOpenDonor(donor.id)}
                  className={cn(
                    "flex min-h-11 w-full items-center gap-2.5 rounded-[10px] px-1 py-2 text-left hover:bg-surface",
                    focusRing,
                  )}
                >
                  <span
                    aria-hidden="true"
                    className="grid size-8 shrink-0 place-items-center rounded-full bg-quiet text-[11px] font-bold text-quiet-foreground"
                  >
                    {initials(donor.full_name)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold">
                      {donor.full_name}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {donorMeta(donor)}
                    </span>
                  </span>
                  <span
                    className={cn(
                      "shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap",
                      tagTone[tag.tone],
                    )}
                  >
                    {tag.label}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
};

/* ---------- Week calendar ---------- */

const WEEKDAY = ["M", "T", "W", "T", "F", "S", "S"];

export const WeekTile = ({
  today,
  days,
  marks,
  agenda,
  onOpenDay,
}: {
  today: string;
  days: string[];
  marks: Map<string, DayMarks>;
  agenda: AgendaLine[];
  onOpenDay: (date: string) => void;
}) => {
  const headingId = useId();
  const month = new Date(`${today}T00:00:00`).toLocaleDateString("en-US", {
    month: "long",
  });
  return (
    <section aria-labelledby={headingId} className={cn(tile, "p-4")}>
      <TileHead id={headingId} title={month}>
        <button
          type="button"
          onClick={() => onOpenDay(today)}
          aria-label="Plan today"
          title="Plan today"
          className={roundIcon}
        >
          <Plus className="size-4" aria-hidden="true" />
        </button>
      </TileHead>
      <ol className="grid grid-cols-7 gap-1 text-center" aria-label="This week">
        {days.map((date, i) => {
          const mark = marks.get(date);
          const planned = Math.min(mark?.planned ?? 0, 2);
          const flagged =
            !!mark &&
            (mark.giveMiamiDay ||
              mark.campaignEnds.length > 0 ||
              mark.events.length > 0);
          const isToday = date === today;
          const words = describeMarks(mark);
          return (
            <li key={date}>
              <span
                aria-hidden="true"
                className="block text-[11px] text-muted-foreground"
              >
                {WEEKDAY[i]}
              </span>
              <button
                type="button"
                onClick={() => onOpenDay(date)}
                aria-current={isToday ? "date" : undefined}
                aria-label={[formatDayLong(date), ...words].join(". ")}
                className={cn(
                  "mt-1 flex min-h-11 w-full flex-col items-center justify-center rounded-xl text-sm font-semibold hover:bg-accent",
                  isToday &&
                    "bg-primary text-primary-foreground hover:bg-primary/90",
                  focusRing,
                )}
              >
                {Number(date.slice(8, 10))}
                <span aria-hidden="true" className="mt-0.5 flex h-1 gap-0.5">
                  {Array.from({ length: planned }, (_, k) => (
                    <i
                      key={k}
                      className={cn(
                        "size-1 rounded-full",
                        isToday ? "bg-brand" : "bg-brand-soft-foreground",
                      )}
                    />
                  ))}
                  {flagged && (
                    <i
                      className={cn(
                        "size-1 rounded-full",
                        isToday ? "bg-chart-3" : "bg-alert-foreground",
                      )}
                    />
                  )}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
      {agenda.length > 0 && (
        <ul className="mt-3 grid gap-1.5" aria-label="Coming up">
          {agenda.map((line) => (
            <li
              key={`${line.date}-${line.label}`}
              className="flex gap-2 text-[13px]"
            >
              <time
                dateTime={line.date}
                className="w-[52px] shrink-0 text-muted-foreground"
              >
                {formatDayShort(line.date).replace(/,.*/, "")}{" "}
                {Number(line.date.slice(8, 10))}
              </time>
              <span className="min-w-0 truncate" title={line.label}>
                {line.label}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
};

/* ---------- Tasks to do today ---------- */

export const TasksTile = ({
  tasks,
  selectedKey,
  onSelect,
  onPlan,
  isPending,
}: {
  tasks: HomeTask[];
  selectedKey: string | null;
  onSelect: (key: string) => void;
  onPlan: () => void;
  isPending: boolean;
}) => {
  const headingId = useId();
  const listId = useId();
  const [closed, setClosed] = useState<ReadonlySet<string>>(
    () => new Set(["records", "campaigns"]),
  );
  const groups = [
    {
      id: "outreach",
      title: "Donor outreach",
      items: tasks.filter(
        (t) => t.kind === "donor" && !/duplicate|record/i.test(t.title),
      ),
    },
    {
      id: "records",
      title: "Donor records",
      items: tasks.filter(
        (t) => t.kind === "donor" && /duplicate|record/i.test(t.title),
      ),
    },
    {
      id: "campaigns",
      title: "Campaigns",
      items: tasks.filter((t) => t.kind === "campaign"),
    },
  ];
  return (
    <section
      data-tour="tasks"
      aria-labelledby={headingId}
      className={cn(tile, "home-projects")}
    >
      <TileHead id={headingId} title="Tasks">
        <span className="ml-auto text-xs text-muted-foreground">
          {tasks.length}
        </span>
        <button
          type="button"
          onClick={onPlan}
          aria-label="Add a task to today’s plan"
          title="Add task"
          className={roundIcon}
        >
          <Plus className="size-4" aria-hidden="true" />
        </button>
      </TileHead>
      {isPending ? (
        <Skeleton className="h-20 rounded-lg" />
      ) : tasks.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Nothing left for today. Nice work.
        </p>
      ) : (
        <ul className="home-project-list" aria-label="Task projects">
          {groups
            .filter((g) => g.items.length > 0)
            .map((group) => {
              const expanded = !closed.has(group.id);
              const panelId = `${listId}-${group.id}`;
              return (
                <li key={group.id}>
                  <button
                    type="button"
                    className={cn("home-project-toggle", focusRing)}
                    aria-expanded={expanded}
                    aria-controls={panelId}
                    onClick={() =>
                      setClosed((previous) => {
                        const next = new Set(previous);
                        if (next.has(group.id)) next.delete(group.id);
                        else next.add(group.id);
                        return next;
                      })
                    }
                  >
                    <ChevronDown
                      className={cn(
                        "size-3 shrink-0",
                        !expanded && "-rotate-90",
                      )}
                      aria-hidden="true"
                    />
                    <Folder className="size-3.5 shrink-0" aria-hidden="true" />
                    <span className="flex-1 text-left">{group.title}</span>
                    <span>{group.items.length}</span>
                  </button>
                  <ul
                    id={panelId}
                    hidden={!expanded}
                    className="home-project-threads"
                  >
                    {group.items.map((task) => (
                      <li key={task.key}>
                        <button
                          type="button"
                          aria-pressed={task.key === selectedKey}
                          aria-label={`${task.title}: ${task.why}`}
                          title={`${task.title} — ${task.why}`}
                          className={cn("home-project-thread", focusRing)}
                          onClick={() => onSelect(task.key)}
                        >
                          <Clock
                            className="size-3.5 shrink-0 text-muted-foreground"
                            aria-hidden="true"
                          />
                          <span className="truncate">{task.title}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </li>
              );
            })}
        </ul>
      )}
    </section>
  );
};

/* ---------- Artifacts ---------- */

export const ArtifactsTile = ({
  notes,
  campaigns,
}: {
  notes: CallNote[];
  campaigns: CampaignSummary[];
}) => {
  const headingId = useId();
  const drafts = [...campaigns]
    .filter((c) => c.counts.draft > 0)
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
  const rows = [
    ...notes.map((note) => ({
      key: `note-${note.id}`,
      at: note.createdAt,
      icon: AudioLines,
      label: note.title || "Call notes",
      to: null as string | null,
    })),
    ...drafts.map((c) => ({
      key: `campaign-${c.id}`,
      at: c.created_at,
      icon: FileText,
      label: `${c.name} drafts (${c.counts.draft})`,
      to: `/campaigns/${c.id}`,
    })),
  ]
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, 5);
  return (
    <section aria-labelledby={headingId} className={cn(tile, "p-4")}>
      <TileHead id={headingId} title="Files & drafts" />
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Call notes and drafts show up here.
        </p>
      ) : (
        <ul className="grid gap-0.5">
          {rows.map((row) => {
            const Icon = row.icon;
            const inner = (
              <>
                <Icon
                  className="size-4 shrink-0 text-muted-foreground"
                  aria-hidden="true"
                />
                <span className="min-w-0 flex-1 truncate">{row.label}</span>
                <time
                  dateTime={row.at}
                  className="shrink-0 text-xs text-muted-foreground"
                >
                  {formatMonthDay(row.at)}
                </time>
              </>
            );
            const shell =
              "flex min-h-9 items-center gap-2 rounded-lg px-1 py-1.5 text-[13px]";
            return (
              <li key={row.key}>
                {row.to ? (
                  <Link
                    to={row.to}
                    className={cn(shell, "hover:bg-surface", focusRing)}
                  >
                    {inner}
                  </Link>
                ) : (
                  <div className={shell}>{inner}</div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
};
