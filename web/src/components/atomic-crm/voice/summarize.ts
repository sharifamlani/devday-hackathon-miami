import { summarizeCall } from "../providers/local/calls";
import type { NoteDestination, TranscriptLine } from "./callNotes";

/**
 * Call summaries. `summarizeTranscript` builds one in the browser with plain
 * rules (no model call): same transcript and date in, same summary out.
 * `buildSummary` is what the pane calls; it can try a model first and fall
 * back to the rules.
 */
export interface CallSummary {
  summary: string[];
  nextSteps: string[];
}

export interface SummaryInput {
  transcript: TranscriptLine[];
  /** The donor on the call, if known. */
  donorName: string | null;
  /** Your own notes from the My notes tab. */
  notes: string;
  /** The call date; anchors spoken dates like "the 21st". */
  today: Date;
  /** Note title and donor id, sent to the service's model summarizer. */
  title?: string;
  donorId?: string | number | null;
}

const MONTHS = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
];

const MONTH_SHORT = MONTHS.map((m) => m.slice(0, 3));
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** "Nov 21" */
export const formatShortDate = (date: Date) => {
  const month = MONTH_SHORT[date.getMonth()];
  return `${month[0].toUpperCase()}${month.slice(1)} ${date.getDate()}`;
};

/** "Sat, Nov 21" */
export const formatDayDate = (date: Date) =>
  `${WEEKDAYS[date.getDay()]}, ${formatShortDate(date)}`;

const isValidDay = (year: number, month: number, day: number) => {
  const d = new Date(year, month, day);
  return d.getMonth() === month && d.getDate() === day;
};

const MONTH_PATTERN = new RegExp(
  `\\b(${MONTHS.join("|")}|${MONTH_SHORT.join("|")})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b`,
);

/**
 * Finds a date in speech: "November 21", "Nov 21st", "the 21st". A date
 * that already passed this year is next year's; a day without a month is
 * the next such day on or after `today`.
 */
export const findSpokenDate = (text: string, today: Date): Date | null => {
  const lower = text.toLowerCase();
  const base = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const withMonth = lower.match(MONTH_PATTERN);
  if (withMonth) {
    const name = withMonth[1];
    const month =
      MONTHS.indexOf(name) >= 0
        ? MONTHS.indexOf(name)
        : MONTH_SHORT.indexOf(name);
    const day = Number(withMonth[2]);
    let year = base.getFullYear();
    if (!isValidDay(year, month, day)) return null;
    if (new Date(year, month, day) < base) year += 1;
    return new Date(year, month, day);
  }
  const dayOnly = lower.match(/\bthe\s+(\d{1,2})(?:st|nd|rd|th)\b/);
  if (dayOnly) {
    const day = Number(dayOnly[1]);
    // Up to a year ahead, the first month that has this day.
    for (let step = 0; step < 13; step += 1) {
      const year =
        base.getFullYear() + Math.floor((base.getMonth() + step) / 12);
      const month = (base.getMonth() + step) % 12;
      if (!isValidDay(year, month, day)) continue;
      const candidate = new Date(year, month, day);
      if (candidate >= base) return candidate;
    }
  }
  return null;
};

const EVENT_PATTERN =
  /\bthe\s+((?:[a-z]+\s+){0,2}(?:cleanup|clean-up|gala|event|tour|lunch|luncheon|breakfast|dinner|walk|run|meeting|open house|fundraiser))\b/i;

const has = (lines: TranscriptLine[], pattern: RegExp) =>
  lines.some((line) => pattern.test(line.text));

/** Key points and suggested next steps, by rules. Pure. */
export const summarizeTranscript = ({
  transcript,
  donorName,
  today,
}: Pick<SummaryInput, "transcript" | "donorName" | "today">): CallSummary => {
  const first = donorName?.trim().split(/\s+/)[0] || null;
  const who = first ?? "The donor";
  const them = transcript.filter((line) => line.speaker === "them");
  // A mic transcript has no speaker labels yet: read every line.
  const theirs = them.length ? them : transcript;
  const summary: string[] = [];
  const nextSteps: string[] = [];

  const cardTrouble = has(
    transcript,
    /\b(new card|card (?:expired|changed|failed|declined)|didn't go through|did not go through|payment failed)\b/i,
  );
  if (cardTrouble) {
    const update = has(transcript, /\bupdate\b/i);
    const link = has(transcript, /\blink\b/i);
    summary.push(
      update && link
        ? `${who}'s card changed; they'll update it from a secure link.`
        : update
          ? `${who}'s card changed and needs updating.`
          : `${who}'s last card gift didn't go through.`,
    );
    nextSteps.push("Send card-update link");
  }

  const amount = theirs
    .map((line) =>
      line.text.match(/\$(\d[\d,]*)\s*(?:a|per|each)\s*(month|year)\b/i),
    )
    .find(Boolean);
  const since = transcript
    .map((line) => line.text.match(/\bsince\s+((?:19|20)\d{2})\b/i))
    .find(Boolean);
  if (amount) {
    const keep = has(theirs, /\b(keep|still|continue)\b/i);
    const tail = since ? `, as they have since ${since[1]}` : "";
    summary.push(
      `${keep ? "Wants to keep giving" : "Gives"} $${amount[1]} a ${amount[2].toLowerCase()}${tail}.`,
    );
  } else if (since) {
    summary.push(`Has given since ${since[1]}.`);
  }

  for (const line of theirs) {
    const event = line.text.match(EVENT_PATTERN);
    if (!event) continue;
    const date = findSpokenDate(line.text, today);
    const what = `the ${event[1].toLowerCase()}`;
    summary.push(
      date
        ? `Signed up for ${what} on ${formatDayDate(date)}.`
        : `Interested in ${what}.`,
    );
    if (date) nextSteps.push(`Add ${formatShortDate(date)} to calendar`);
    break;
  }

  if (summary.length === 0) {
    summary.push(
      transcript.length === 0
        ? "Nothing was transcribed."
        : first
          ? `Talked with ${first}; no gift or event details came up.`
          : "No gift or event details came up.",
    );
  }
  if (nextSteps.length === 0 && transcript.length > 0) {
    nextSteps.push("Plan a follow-up");
  }
  return { summary, nextSteps };
};

/**
 * The one summary entry point for the pane. With the live service it asks
 * the model (POST /calls/summarize, guarded against invented amounts and
 * dates); on the static snapshot, offline or on any error it falls back to
 * the rules summary from `summarizeTranscript`.
 */
export async function buildSummary(
  input: SummaryInput,
): Promise<CallSummary & { source: "model" | "rules" }> {
  const result = await summarizeCall({
    title: input.title ?? "",
    transcript: input.transcript,
    notes: input.notes,
    donorId: input.donorId ?? null,
    fallback: () => summarizeTranscript(input),
  });
  return {
    summary: result.summary,
    nextSteps: result.nextSteps,
    source: result.source,
  };
}

/** Which icon a next step gets. */
export const nextStepKind = (label: string): "send" | "calendar" | "other" =>
  /\bcalendar\b/i.test(label)
    ? "calendar"
    : /\b(send|text|email|link|draft)\b/i.test(label)
      ? "send"
      : "other";

/** What a next-step button puts in the Ask prompt. */
export const nextStepPrompt = (label: string, donorName: string | null) =>
  donorName
    ? `After my call with ${donorName}: ${label}. Help me do this.`
    : `After my call: ${label}. Help me do this.`;

/** "Saved to Rosa Delgado, Give Miami Day and added to your Donor Desk context." */
export const savedConfirmation = (destinations: NoteDestination[]) =>
  destinations.length
    ? `Saved to ${destinations.map((d) => d.label).join(", ")} and added to your Donor Desk context.`
    : "Added to your Donor Desk context. Pick a donor, group or project to file it.";

/** "Call with Rosa Delgado" or "Call notes · Nov 7". */
export const defaultNoteTitle = (donorName: string | null, date: Date) =>
  donorName
    ? `Call with ${donorName}`
    : `Call notes · ${formatShortDate(date)}`;

/** Seconds to "m:ss" (or "h:mm:ss" past an hour). */
export const formatElapsed = (totalSeconds: number) => {
  const s = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(s / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  const seconds = String(s % 60).padStart(2, "0");
  return hours
    ? `${hours}:${String(minutes).padStart(2, "0")}:${seconds}`
    : `${minutes}:${seconds}`;
};
