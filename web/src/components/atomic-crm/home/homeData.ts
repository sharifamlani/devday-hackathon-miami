import type { DonorSummary, TargetsByPeriod } from "../providers/local/types";
import type { AskAnswer, AskIntentKind } from "../providers/local/ask";
import type {
  Artifact,
  CalendarItem as ApiCalendarItem,
} from "../providers/local/calendarFeed";
import { attentionTag } from "../providers/local/homeFeed";
import type { Task } from "../providers/local/tasks";
import type { ArtifactOwners } from "./artifactOwners";
import { campaignHref } from "../ask/askChips";
import { formatUsd } from "../contacts/donorFormat";
import { DATA_MODE } from "../providers/local/config";
import { computeDayMarks, type DayMarks } from "../outreach/calendarMonth";
import { addDays, giveMiamiDayFor, mondayIndex } from "../outreach/dates";

/**
 * Pure helpers behind the home board. Every figure is read from the donor
 * service (GET /home/summary, /tasks, /people/attention, /calendar,
 * /artifacts, /targets); nothing here invents a number or a person.
 */

/**
 * Days a fundraising window closes, for the calendar's "ends" mark: the month
 * and quarter goal periods from GET /targets.
 */
export const goalEnds = (targets: TargetsByPeriod | undefined) =>
  (["month", "quarter"] as const).flatMap((period) => {
    const target = targets?.[period];
    return target ? [{ date: target.end, label: `${target.label} goal` }] : [];
  });

/** Give Miami Day from the service when it reports one, else this year's (or next year's) date. */
export const giveMiamiDay = (
  targets: TargetsByPeriod | undefined,
  today: string,
): string => {
  const reported =
    targets?.quarter?.give_miami_day?.date ??
    targets?.month?.give_miami_day?.date;
  if (reported) return reported.slice(0, 10);
  const year = Number(today.slice(0, 4));
  const thisYear = giveMiamiDayFor(year);
  return thisYear >= today ? thisYear : giveMiamiDayFor(year + 1);
};

const compactUsd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  notation: "compact",
  maximumFractionDigits: 1,
});

export const formatCompactUsd = (amount: number | null | undefined) =>
  amount == null ? "—" : compactUsd.format(amount).toLowerCase();

export const greeting = (hour: number) =>
  hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";

/** "Sam Rivera" → "Sam"; null when there is no usable name. */
export const firstName = (fullName: string | null | undefined) => {
  const first = fullName?.trim().split(/\s+/)[0];
  return first ? first : null;
};

export const initials = (name: string) =>
  name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0] ?? "")
    .join("")
    .toUpperCase();

/** "2026-10-22" → "Oct 22", read as UTC so no timezone shifts the day. */
export const formatMonthDay = (iso: string | null | undefined) =>
  iso
    ? new Date(`${iso.slice(0, 10)}T00:00:00Z`).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        timeZone: "UTC",
      })
    : "—";

/** "Oct 1 – Dec 31" for a goal period. */
export const formatRange = (start: string, end: string) =>
  `${formatMonthDay(start)} – ${formatMonthDay(end)}`;

const capitalize = (text: string) =>
  text ? text[0].toUpperCase() + text.slice(1) : text;

/* ---------- Donor tags (CRM tile) ---------- */

export type TagTone = "alert" | "warn" | "good" | "quiet";

export interface DonorTag {
  label: string;
  tone: TagTone;
}

type TagDonor = Pick<DonorSummary, "status" | "gift_count">;

/**
 * A short status tag from score.py's status. There is no payment-failure or
 * thank-you feed yet, so "Card failed" and "Thanked" are not shown.
 */
export const donorTag = (donor: TagDonor): DonorTag => {
  if (donor.status === "lapsing") return { label: "Late", tone: "alert" };
  if (donor.status === "lapsed") return { label: "Lapsed", tone: "quiet" };
  if (donor.status === "no_gifts") return { label: "Not yet", tone: "quiet" };
  if (donor.gift_count === 1) return { label: "New", tone: "good" };
  if (donor.status === "due") return { label: "Due", tone: "warn" };
  return { label: "On track", tone: "good" };
};

/** One line under a donor's name: "Monthly · $50" or "First gift Oct 22". */
export const donorMeta = (
  donor: Pick<
    DonorSummary,
    "usual_cadence" | "last_gift_amount" | "last_gift_date" | "gift_count"
  >,
) => {
  if (donor.gift_count === 1 && donor.last_gift_date)
    return `First gift ${formatMonthDay(donor.last_gift_date)}`;
  if (donor.gift_count === 0) return "No gifts yet";
  return [
    donor.usual_cadence ? capitalize(donor.usual_cadence) : null,
    donor.last_gift_amount != null ? formatUsd(donor.last_gift_amount) : null,
  ]
    .filter(Boolean)
    .join(" · ");
};

/**
 * The pop-up search: every word must appear in the name, email or
 * organization (case-insensitive). Empty query: the highest scores first.
 */
export const searchDonors = <
  T extends Pick<DonorSummary, "full_name" | "email" | "org_name" | "score">,
>(
  donors: T[],
  query: string,
  limit = 8,
): T[] => {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const hits = words.length
    ? donors.filter((d) => {
        const hay = [d.full_name, d.email, d.org_name]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        return words.every((w) => hay.includes(w));
      })
    : donors;
  return [...hits].sort((a, b) => b.score - a.score).slice(0, limit);
};

/* ---------- Tasks to do today ---------- */

export interface HomeTask {
  key: string;
  /** The tasks-table id: Mark done is PATCH /tasks/{id}. */
  id: number;
  /** "call" | "email" | "review" | "prep" (the generator's kinds). */
  kind: string;
  title: string;
  why: string | null;
  donorId: number | null;
  /** "Lifetime $600", "Last gift $50 · 2026-11-03": straight from the task. */
  chips: string[];
  source: string | null;
}

/** GET /tasks?due=today → the open tasks, in the order the service sent them. */
export const tasksFromApi = (tasks: Task[] | undefined): HomeTask[] =>
  (tasks ?? [])
    .filter((task) => !task.done)
    .map((task) => ({
      key: `task-${task.id}`,
      id: task.id,
      kind: task.kind,
      title: task.title,
      why: task.why,
      donorId: task.person_id,
      chips: task.chips ?? [],
      source: task.source,
    }));

const KIND_LABEL: Record<string, string> = {
  call: "Call",
  email: "Email",
  review: "Review",
  prep: "Prep",
};

/** "TASK 1 OF 5 · CALL": the kind as the card names it. */
export const kindLabel = (kind: string) =>
  KIND_LABEL[kind] ?? capitalize(kind.replace(/_/g, " "));

const INTENT: Record<string, AskIntentKind> = {
  call: "re_engage",
  email: "thank_you",
};

/**
 * Where "Draft email" goes: a one-donor campaign draft for a task about a
 * person. Review and prep tasks have no email, so null (the card then asks
 * the agent).
 */
export const draftEmailHref = (
  task: Pick<HomeTask, "kind" | "donorId">,
): string | null =>
  task.donorId != null && (task.kind === "call" || task.kind === "email")
    ? campaignHref([task.donorId], {
        kind: INTENT[task.kind],
        channel_hint: "email",
      })
    : null;

/* ---------- CRM tile ---------- */

/**
 * GET /people/attention sends badge "failed" (the alert kind); the hook's
 * attentionTag only knows "card_failed", so name that one here.
 */
export const crmTag = (badge: string): DonorTag =>
  badge === "failed"
    ? { label: "Card failed", tone: "alert" }
    : attentionTag(badge);

/** A /calendar row; the service also sends `done` on task rows (not in the hook's type yet). */
export type CalendarItem = ApiCalendarItem & { done?: boolean };

/* ---------- Week calendar ---------- */

/** Monday to Sunday of the week holding `today`, as YYYY-MM-DD. */
export const weekDays = (today: string): string[] => {
  const monday = addDays(today, -mondayIndex(today));
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
};

/**
 * Day marks from GET /calendar: an open task is a planned dot, a done task a
 * done mark, an event is an event; goal period ends and Give Miami Day come
 * from /targets.
 */
export const calendarMarks = ({
  items,
  campaignEnds,
  giveMiamiDay: gmd,
}: {
  items: CalendarItem[];
  campaignEnds: { date: string; label: string }[];
  giveMiamiDay: string | null;
}): Map<string, DayMarks> => {
  const marks = computeDayMarks({
    campaignEnds,
    events: items
      .filter((item) => item.kind === "event")
      .map((item) => ({ date: item.date, label: item.title })),
    giveMiamiDay: gmd,
  });
  for (const item of items) {
    if (item.kind !== "task") continue;
    const date = item.date.slice(0, 10);
    const entry = marks.get(date) ?? {
      planned: 0,
      done: 0,
      campaignEnds: [],
      events: [],
      giveMiamiDay: false,
    };
    if (item.done) entry.done += 1;
    else entry.planned += 1;
    marks.set(date, entry);
  }
  return marks;
};

export interface AgendaLine {
  date: string;
  label: string;
}

/**
 * "Coming up" under the week: events from /calendar, tasks due after today
 * (today's are in the tasks list) and the next big event from
 * /home/summary. Soonest first.
 */
export const agendaFromCalendar = ({
  today,
  items,
  nextEvent,
  limit = 3,
}: {
  today: string;
  items: CalendarItem[];
  nextEvent: { title: string; date: string } | null | undefined;
  limit?: number;
}): AgendaLine[] => {
  const lines: AgendaLine[] = items
    .filter(
      (item) =>
        !item.done &&
        item.date >= today &&
        (item.kind === "event" || item.date > today),
    )
    .map((item) => ({
      date: item.date.slice(0, 10),
      label:
        item.source === "agent" ? `${item.title} (added by agent)` : item.title,
    }));
  if (nextEvent && nextEvent.date >= today) {
    const date = nextEvent.date.slice(0, 10);
    if (!lines.some((l) => l.date === date && l.label === nextEvent.title))
      lines.push({ date, label: nextEvent.title });
  }
  return lines.sort((a, b) => a.date.localeCompare(b.date)).slice(0, limit);
};

/* ---------- Artifacts ---------- */

export interface ArtifactRow {
  key: string;
  kind: string;
  title: string;
  date: string;
  ref: string | number | null;
  /** In-app route when the artifact has a page of its own. */
  to: string | null;
}

/**
 * Where an artifact opens. The service sends kind "draft" for campaigns too,
 * told apart by ref ("campaign:3", "draft:98", "call_note:<id>"); a bare
 * numeric ref on kind "campaign" is the older shape. Drafts and call notes
 * open their donor's profile: the row's donor_id when the service sends it,
 * else the owners lookup; without either they have no target.
 */
export const artifactTarget = (
  a: { kind: string; ref: string | number | null; donor_id?: number | null },
  owners: ArtifactOwners = { drafts: {}, notes: {} },
): string | null => {
  if (a.ref == null) return null;
  const ref = String(a.ref);
  if (a.kind === "campaign" && /^[0-9]+$/.test(ref)) return `/campaigns/${ref}`;
  const cut = ref.indexOf(":");
  const prefix = ref.slice(0, cut);
  const id = ref.slice(cut + 1);
  if (cut < 0 || !id) return null;
  if (prefix === "campaign" && /^[0-9]+$/.test(id)) return `/campaigns/${id}`;
  // The service names the donor (local mode); the owners lookup covers older APIs and the snapshot.
  const donor =
    prefix === "draft"
      ? (a.donor_id ?? owners.drafts[id])
      : prefix === "call_note"
        ? (a.donor_id ?? owners.notes[id])
        : undefined;
  return donor != null ? `/contacts/${donor}/show` : null;
};

/** GET /artifacts → the newest few rows; each opens the page that shows it. */
export const artifactRows = (
  artifacts: Artifact[] | undefined,
  limit = 5,
  owners?: ArtifactOwners,
): ArtifactRow[] =>
  [...(artifacts ?? [])]
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, limit)
    .map((a, i) => ({
      key: `${a.kind}-${a.ref ?? i}`,
      kind: a.kind,
      title: a.title,
      date: a.date,
      ref: a.ref,
      to: artifactTarget(a, owners),
    }));

/* ---------- Agent thread ---------- */

/**
 * The thread keeps each answered question once: a re-run of the same
 * question (a chip edit in the Ask pane) replaces the last entry.
 */
export const appendAnswer = (
  history: AskAnswer[],
  answer: AskAnswer | null,
  max = 20,
): AskAnswer[] => {
  if (!answer) return history;
  const last = history[history.length - 1];
  if (last === answer) return history;
  const base =
    last && last.question === answer.question ? history.slice(0, -1) : history;
  return [...base, answer].slice(-max);
};

export interface AnswerSummary {
  headline: string;
  detail: string | null;
  rows: { id: number; name: string; detail: string }[];
  more: number;
}

const GREETING =
  /^\s*(hi|hello|hey|howdy|yo|good\s+(morning|afternoon|evening))\b[\s!?.,]*$/i;

/** What the public preview can answer, with the demo data behind each example. */
const PREVIEW_EXAMPLES = [
  "• “Who’s late on a usual gift?”: 5 givers, starting with Rafael Quintero and Hye-jin Park",
  "• “Plan next week”: who to call before Give Miami Day Early Giving (Nov 14) and the 5K (Nov 15)",
  "• “Who needs outreach because they’ve gone quiet?”",
  "• “Monthly donors whose last gift is late”",
].join("\n");

const PREVIEW_FULL_VERSION =
  "The full version also merges the 9 duplicate records, drafts emails, researches foundations and places recorded calls.";

/** Public preview only: a concrete reply instead of "could not read that". */
export const snapshotFallback = (question: string): string =>
  GREETING.test(question)
    ? `Hi! Yes, this is the public preview, so I can’t change records here, but I can show you a lot from The Miami Foundation’s sample donors. Try asking:\n${PREVIEW_EXAMPLES}\n\n${PREVIEW_FULL_VERSION}`
    : `This preview can’t answer that one, but here’s what it can do with the sample donors:\n${PREVIEW_EXAMPLES}\n\n${PREVIEW_FULL_VERSION}`;

/** A compact reading of an Ask answer for the home thread. */
export const answerSummary = (
  answer: AskAnswer,
  max = 3,
  mode: string = DATA_MODE,
): AnswerSummary => {
  if (!answer.understood)
    return {
      headline:
        answer.detail ??
        (mode === "snapshot"
          ? snapshotFallback(answer.question)
          : "I couldn’t read that as a donor question. Try one of the suggestions."),
      detail: null,
      rows: [],
      more: 0,
    };
  const count = answer.donors.length;
  const rows = answer.donors.slice(0, max).map((d) => {
    const amount =
      d.ask && d.ask.period_total > 0 ? d.ask.period_total : d.total_given;
    const date = d.ask?.last_gift_date ?? d.last_gift_date;
    return {
      id: d.id,
      name: d.full_name,
      detail: [formatUsd(amount), date ? formatMonthDay(date) : null]
        .filter(Boolean)
        .join(" · "),
    };
  });
  return {
    headline:
      count === 0
        ? "No donors match."
        : `${count} ${count === 1 ? "donor matches" : "donors match"}.`,
    detail: answer.interpretation || null,
    rows,
    more: Math.max(count - rows.length, 0),
  };
};
