import { zoomClick } from "./workspaceView";
import { useId, useState, type ReactNode } from "react";
import {
  AudioLines,
  ChevronDown,
  Clock,
  FileText,
  Folder,
  Info,
  Plus,
  Search,
} from "lucide-react";
import { Link } from "react-router";

import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type { AttentionPerson } from "../providers/local/homeSummary";
import type { DonationTarget } from "../providers/local/types";
import type { DayMarks } from "../outreach/calendarMonth";
import { describeMarks } from "../outreach/calendarMonth";
import { formatDayLong, formatDayShort } from "../outreach/dates";
import {
  crmTag,
  formatCompactUsd,
  formatMonthDay,
  initials,
  type AgendaLine,
  artifactTarget,
  type ArtifactRow,
  type HomeTask,
} from "./homeData";
import { useArtifactOwners } from "./artifactOwners";
import { CollapseToggle, TileBody } from "./TileCollapse";
import { useTileCollapsed } from "./collapseState";
import { focusRing, tagTone, tile, tileTitle } from "./tile";

/** What the panels without a snapshot source say instead of a false "all caught up". */
export const LIVE_ONLY = "Live data appears when the service is connected.";

/** Keyboard hint beside a tile heading (see useWorkspaceHotkeys). */
const KeyHint = ({ keys }: { keys: string }) => (
  <kbd
    aria-hidden="true"
    className="hidden font-sans text-[11px] font-normal text-muted-foreground md:inline"
  >
    {keys}
  </kbd>
);

interface TileCollapseProps {
  collapsed: boolean;
  onToggle: () => void;
  bodyId: string;
  label: string;
  /** One line shown in place of the tile's tools while folded, e.g. "19 today". */
  summary?: string;
}

const TileHead = ({
  id,
  title,
  hint,
  collapse,
  children,
}: {
  id: string;
  title: ReactNode;
  hint?: string;
  collapse?: TileCollapseProps;
  children?: ReactNode;
}) => (
  <div className="mb-3 flex items-center justify-between gap-2">
    <div className="flex min-w-0 items-center gap-1">
      {collapse && (
        <CollapseToggle
          collapsed={collapse.collapsed}
          onToggle={collapse.onToggle}
          bodyId={collapse.bodyId}
          label={collapse.label}
        />
      )}
      <h2
        id={id}
        className={cn(tileTitle, hint && "flex items-baseline gap-2")}
      >
        {title}
        {hint && <KeyHint keys={hint} />}
      </h2>
    </div>
    {collapse?.collapsed
      ? collapse.summary && (
          <span className="motion-fade-in min-w-0 truncate text-xs text-muted-foreground">
            {collapse.summary}
          </span>
        )
      : children}
  </div>
);

const roundIcon = cn(
  "grid size-8 shrink-0 place-items-center rounded-full border border-border hover:bg-accent",
  focusRing,
);

/** A tile's name is its open button: underline on hover, ring on keyboard focus. */
const headingLink = cn(
  "-mx-1 inline-flex items-center rounded-sm px-1 hover:underline hover:underline-offset-4 hover:decoration-2",
  focusRing,
);

/* ---------- Impact & story ---------- */

/** Compact card under Q4: the whole card opens the Impact panel. */
export const ImpactTile = ({ factCount }: { factCount: number }) => {
  const headingId = useId();
  return (
    <section
      data-tour="impact"
      data-zoom-source="impact"
      aria-labelledby={headingId}
      className={cn(tile, "relative p-4")}
    >
      <h2 id={headingId} className={cn(tileTitle, "flex items-baseline gap-2")}>
        <Link
          to="/?workspace=impact"
          onClick={zoomClick("impact")}
          title="Open Impact & story"
          className={cn(
            "rounded-sm hover:underline hover:underline-offset-4 hover:decoration-2 after:absolute after:inset-0 after:rounded-2xl",
            focusRing,
          )}
        >
          Impact &amp; story
        </Link>
        <KeyHint keys="Ctrl+I" />
      </h2>
      <p className="mt-1 truncate text-[13px] text-muted-foreground">
        {factCount > 0
          ? `${factCount} sourced ${factCount === 1 ? "fact" : "facts"} · Copy for a grant report`
          : "Read your website to collect stories"}
      </p>
    </section>
  );
};

/* ---------- Q4 progress ---------- */

const ARC = Math.PI * 44; // semicircle, r = 44

export const Q4ProgressTile = ({
  target,
  goal,
  goalIsSample = false,
  isPending,
}: {
  target: DonationTarget | undefined;
  /** The quarter goal: one the person set, else the service's (labeled sample). Null when there is none. */
  goal: number | null;
  /** True when `goal` is the service's sample goal, so the tile says so. */
  goalIsSample?: boolean;
  isPending: boolean;
}) => {
  const headingId = useId();
  const gradientId = `q4-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const percent =
    target && goal != null && goal > 0
      ? Math.round((target.raised / goal) * 1000) / 10
      : null;
  const filled =
    percent == null ? 0 : Math.min(Math.max(percent, 0), 100) / 100;
  const bodyId = useId();
  const [collapsed, toggle] = useTileCollapsed("q4");
  const summary = target
    ? [
        percent == null ? null : `${Math.round(percent)}%`,
        formatCompactUsd(target.raised),
        // Folded, the "Sample goal" note is hidden: the summary keeps the qualification.
        percent != null && goalIsSample ? "sample goal" : null,
      ]
        .filter(Boolean)
        .join(" · ")
    : undefined;
  return (
    <section
      aria-labelledby={headingId}
      data-collapsed={collapsed || undefined}
      className={cn(tile, "p-4")}
    >
      <TileHead
        id={headingId}
        collapse={{
          collapsed,
          onToggle: toggle,
          bodyId,
          label: "quarter progress",
          summary,
        }}
        title={
          <Link
            to="/?workspace=impact"
            onClick={zoomClick("impact")}
            title="Open Impact & story"
            aria-label="Open Impact & story"
            className={headingLink}
          >
            {target ? `${target.label} outreach` : "Quarter progress"}
          </Link>
        }
      />
      <TileBody id={bodyId} collapsed={collapsed}>
        {isPending ? (
          <Skeleton className="h-16 w-full rounded-xl" />
        ) : !target ? (
          <p className="text-sm text-muted-foreground">
            Upload your files to see this quarter’s giving.
          </p>
        ) : (
          <div className="home-quarter-summary">
            <div className="home-quarter-gauge">
              <svg
                className="home-quarter-arc"
                viewBox="0 0 104 68"
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
                  d="M 8 56 A 44 44 0 0 1 96 56"
                  fill="none"
                  strokeWidth="10"
                  strokeLinecap="round"
                  className="stroke-quiet"
                />
                {filled > 0 && (
                  <path
                    d="M 8 56 A 44 44 0 0 1 96 56"
                    fill="none"
                    strokeWidth="10"
                    strokeLinecap="round"
                    stroke={`url(#${gradientId})`}
                    strokeDasharray={`${ARC * filled} ${ARC}`}
                  />
                )}
                <text
                  className="home-quarter-percent"
                  x="52"
                  y="58"
                  textAnchor="middle"
                >
                  {percent == null ? "—" : `${Math.round(percent)}%`}
                </text>
              </svg>
            </div>
            <dl className="grid min-w-0 gap-1 text-sm">
              <div>
                <dt className="text-xs text-muted-foreground">
                  Raised{goal != null && ` of ${formatCompactUsd(goal)}`}
                </dt>
                <dd className="font-semibold tabular-nums">
                  {formatCompactUsd(target.raised)}
                  {goal != null && goalIsSample && (
                    <span className="block text-[10px] font-normal text-muted-foreground">
                      Sample goal
                    </span>
                  )}
                </dd>
              </div>
            </dl>
            <p className="sr-only">
              {percent == null
                ? "No quarter goal set."
                : `${Math.round(percent)} percent of the ${goalIsSample ? "sample " : ""}${target.label} goal.`}
            </p>
          </div>
        )}
      </TileBody>
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
  nextEvent,
  isPending,
}: {
  today: string;
  atRisk: number | null;
  duplicates: number | null;
  tasks: number | null;
  /** The next big event from GET /home/summary; null when there is none. */
  nextEvent: { title: string; days: number } | null;
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
      <ul className="home-glance-grid grid grid-cols-2 gap-2">
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
            value={show(tasks)}
            caption={tasks === 1 ? "task today" : "tasks today"}
          />
        </li>
        <li>
          <Bubble
            value={
              isPending || !nextEvent
                ? "—"
                : nextEvent.days === 0
                  ? "Today"
                  : String(nextEvent.days)
            }
            caption={
              !nextEvent
                ? "no upcoming event"
                : nextEvent.days === 0
                  ? `is ${nextEvent.title}`
                  : `${nextEvent.days === 1 ? "day" : "days"} to ${nextEvent.title}`
            }
          />
        </li>
      </ul>
    </section>
  );
};

/* ---------- CRM ---------- */

export const CrmTile = ({
  people,
  hasData,
  live = true,
  isPending,
  error,
  onFind,
  onOpenDonor,
}: {
  /** GET /people/attention rows. */
  people: AttentionPerson[];
  /** False while the database is empty (nothing uploaded yet). */
  hasData: boolean;
  /** False in the read-only snapshot build, where these panels have no live source. */
  live?: boolean;
  isPending: boolean;
  error: Error | null;
  onFind: () => void;
  onOpenDonor: (id: number) => void;
}) => {
  const headingId = useId();
  const bodyId = useId();
  const [collapsed, toggle] = useTileCollapsed("crm");
  return (
    <section
      data-tour="crm"
      data-zoom-source="crm"
      aria-labelledby={headingId}
      data-collapsed={collapsed || undefined}
      className={cn(tile, "flex min-h-0 flex-col p-4 @min-[1081px]:flex-1")}
    >
      <TileHead
        id={headingId}
        hint="Alt+M"
        collapse={{
          collapsed,
          onToggle: toggle,
          bodyId,
          label: "CRM",
          summary: people.length
            ? `${people.length} need${people.length === 1 ? "s" : ""} a look`
            : undefined,
        }}
        title={
          <Link
            to="/contacts"
            onClick={zoomClick("crm")}
            title="Open CRM"
            aria-label="Open CRM"
            className={headingLink}
          >
            CRM
          </Link>
        }
      />
      <TileBody id={bodyId} collapsed={collapsed} className="flex-1">
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
        ) : people.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">
            {!live
              ? LIVE_ONLY
              : hasData
                ? "No donors need attention right now."
                : "Upload your files to see your donors here."}
          </p>
        ) : (
          <ul className="mt-2 -mx-1 min-h-0 flex-1 overflow-y-auto">
            {people.map((person) => {
              const tag = crmTag(person.badge);
              return (
                <li key={person.id}>
                  <button
                    type="button"
                    onClick={() => onOpenDonor(person.id)}
                    className={cn(
                      "flex min-h-11 w-full items-center gap-2.5 rounded-[10px] px-1 py-2 text-left hover:bg-surface",
                      focusRing,
                    )}
                  >
                    <span
                      aria-hidden="true"
                      className="grid size-8 shrink-0 place-items-center rounded-full bg-quiet text-[11px] font-bold text-quiet-foreground"
                    >
                      {person.initials || initials(person.name)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold">
                        {person.name}
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {person.line}
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
      </TileBody>
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
  hasData,
  live = true,
  selectedKey,
  onSelect,
  onInfo,
  agentLive = false,
  onPlan,
  isPending,
}: {
  tasks: HomeTask[];
  /** False while the database is empty (nothing uploaded yet). */
  hasData: boolean;
  /** False in the read-only snapshot build. */
  live?: boolean;
  selectedKey: string | null;
  /** A row click: hands the task to the home agent when it's live, else opens the details. */
  onSelect: (key: string) => void;
  /** The small ⓘ: the task-details dialog. */
  onInfo?: (key: string) => void;
  /** True when a row click goes to the agent (changes the row's label). */
  agentLive?: boolean;
  onPlan: () => void;
  isPending: boolean;
}) => {
  const headingId = useId();
  const listId = useId();
  const bodyId = useId();
  const [collapsed, toggle] = useTileCollapsed("tasks");
  const [closed, setClosed] = useState<ReadonlySet<string>>(() => new Set());
  const groups = [
    {
      id: "outreach",
      title: "Donor outreach",
      items: tasks.filter((t) => t.kind === "call" || t.kind === "email"),
    },
    {
      id: "records",
      title: "Donor records",
      items: tasks.filter((t) => t.kind === "review"),
    },
    {
      id: "prep",
      title: "Preparation",
      items: tasks.filter((t) => !["call", "email", "review"].includes(t.kind)),
    },
  ];
  return (
    <section
      data-tour="tasks"
      data-zoom-source="tasks"
      aria-labelledby={headingId}
      data-collapsed={collapsed || undefined}
      className={cn(tile, "home-projects")}
    >
      <TileHead
        id={headingId}
        hint="Alt+T"
        collapse={{
          collapsed,
          onToggle: toggle,
          bodyId,
          label: "Tasks",
          summary: tasks.length ? `${tasks.length} today` : undefined,
        }}
        title={
          <Link
            to="/?workspace=tasks"
            onClick={zoomClick("tasks")}
            title="Open all tasks"
            aria-label="Open all tasks"
            className={headingLink}
          >
            Tasks
          </Link>
        }
      >
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
      <TileBody id={bodyId} collapsed={collapsed}>
        {isPending ? (
          <Skeleton className="h-20 rounded-lg" />
        ) : tasks.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {!live
              ? LIVE_ONLY
              : hasData
                ? "Nothing left for today. Nice work."
                : "Upload your files to see tasks."}
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
                      <Folder
                        className="size-3.5 shrink-0"
                        aria-hidden="true"
                      />
                      <span className="flex-1 text-left">{group.title}</span>
                      <span>{group.items.length}</span>
                    </button>
                    <ul
                      id={panelId}
                      hidden={!expanded}
                      className="home-project-threads"
                    >
                      {group.items.map((task) => (
                        <li
                          key={task.key}
                          className="flex items-center gap-0.5"
                        >
                          <button
                            type="button"
                            aria-pressed={task.key === selectedKey}
                            aria-label={`${agentLive ? "Work on with the agent: " : ""}${task.title}${task.why ? `: ${task.why}` : ""}`}
                            title={
                              agentLive
                                ? `Hand to the agent — ${task.title}`
                                : task.why
                                  ? `${task.title} — ${task.why}`
                                  : task.title
                            }
                            className={cn(
                              "home-project-thread min-w-0 flex-1",
                              focusRing,
                            )}
                            onClick={() => onSelect(task.key)}
                          >
                            <Clock
                              className="size-3.5 shrink-0 text-muted-foreground"
                              aria-hidden="true"
                            />
                            <span className="truncate">{task.title}</span>
                          </button>
                          {onInfo && (
                            <button
                              type="button"
                              aria-label={`Task details: ${task.title}`}
                              title="Task details"
                              onClick={() => onInfo(task.key)}
                              className={cn(
                                "grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-surface hover:text-foreground",
                                focusRing,
                              )}
                            >
                              <Info className="size-3.5" aria-hidden="true" />
                            </button>
                          )}
                        </li>
                      ))}
                    </ul>
                  </li>
                );
              })}
          </ul>
        )}
      </TileBody>
    </section>
  );
};

/* ---------- Artifacts ---------- */

const ARTIFACT_ICON: Record<string, typeof FileText> = {
  call_note: AudioLines,
};

export const ArtifactsTile = ({ rows }: { rows: ArtifactRow[] }) => {
  const headingId = useId();
  const owners = useArtifactOwners(rows);
  const bodyId = useId();
  const [collapsed, toggle] = useTileCollapsed("files");
  return (
    <section
      aria-labelledby={headingId}
      data-collapsed={collapsed || undefined}
      className={cn(tile, "p-4")}
    >
      <TileHead
        id={headingId}
        title="Files & drafts"
        collapse={{
          collapsed,
          onToggle: toggle,
          bodyId,
          label: "Files & drafts",
          summary: rows.length ? String(rows.length) : undefined,
        }}
      />
      <TileBody id={bodyId} collapsed={collapsed}>
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Call notes and drafts show up here.
          </p>
        ) : (
          <ul className="grid gap-0.5">
            {rows.map((r) => {
              const row = { ...r, to: r.to ?? artifactTarget(r, owners) };
              const Icon = ARTIFACT_ICON[row.kind] ?? FileText;
              const inner = (
                <>
                  <Icon
                    className="size-4 shrink-0 text-muted-foreground"
                    aria-hidden="true"
                  />
                  <span className="min-w-0 flex-1 truncate">{row.title}</span>
                  <time
                    dateTime={row.date}
                    className="shrink-0 text-xs text-muted-foreground"
                  >
                    {formatMonthDay(row.date)}
                  </time>
                </>
              );
              const shell =
                "flex min-h-9 items-center gap-2 rounded-lg px-1 py-1.5 text-[13px]";
              return (
                <li key={row.key} className="min-w-0">
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
      </TileBody>
    </section>
  );
};
