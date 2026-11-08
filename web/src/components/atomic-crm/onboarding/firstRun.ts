/**
 * Pure helpers for the three first-run steps (plan.md §21.2.2): which dropped
 * files go to POST /ingest, what ingest found, and how the context agent's
 * run reads on screen. No React, no fetch: unit-tested in node.
 */
import type {
  ContextRun,
  ContextRunSource,
  IngestResult,
} from "../providers/local/types";
import type {
  ContextSummary,
  FilesSummary,
  OrgLinks,
  SocialPlatform,
} from "./onboardingState";
import { SOCIAL_LABELS, SOCIAL_PLATFORMS } from "./onboardingState";

/* ---------- Step 1: files ---------- */

export const ACCEPTED_EXTENSIONS = ["xlsx", "docx", "md", "csv"] as const;
/** For the file picker's accept attribute. */
export const ACCEPT_ATTRIBUTE = ACCEPTED_EXTENSIONS.map((e) => `.${e}`).join(
  ",",
);
/** POST /ingest refuses anything bigger (service/ingest_router.py). */
export const MAX_FILE_BYTES = 10_000_000;
/** The example files live in the repo, so people can drag the whole folder's files in. */
export const SAMPLE_FOLDER = "data/sample_inputs/";

export interface SkippedFile {
  name: string;
  reason: string;
}

const extensionOf = (name: string) =>
  name.includes(".") ? (name.split(".").pop() ?? "").toLowerCase() : "";

/** Why a file stays out of the import, or null when ingest should read it. */
export const skipReason = (file: { name: string; size: number }) => {
  const name = file.name;
  // data/sample_inputs/_README.md: "Do not pass it to an importer".
  if (/answer[_-]?key/i.test(name))
    return "The answer key is for checking results, so it isn't imported.";
  if (/^_?readme\b/i.test(name))
    return "This describes the example files; it isn't data.";
  if (name.startsWith(".")) return "Hidden system file.";
  if (!(ACCEPTED_EXTENSIONS as readonly string[]).includes(extensionOf(name)))
    return "Donor Desk reads .xlsx, .docx, .md and .csv files.";
  if (file.size > MAX_FILE_BYTES) return "Over 10 MB.";
  if (file.size === 0) return "This file is empty.";
  return null;
};

/**
 * Adds newly dropped files to the ones already chosen: same-name files are
 * replaced by the newer drop, and every refused file says why.
 */
export const addFiles = <F extends { name: string; size: number }>(
  current: F[],
  incoming: F[],
): { files: F[]; skipped: SkippedFile[] } => {
  const byName = new Map(current.map((f) => [f.name, f]));
  const skipped: SkippedFile[] = [];
  for (const file of incoming) {
    const reason = skipReason(file);
    if (reason) skipped.push({ name: file.name, reason });
    else byName.set(file.name, file);
  }
  return { files: [...byName.values()], skipped };
};

const plural = (n: number, one: string, many: string) =>
  `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;

/** What POST /ingest reported, in the onboarding's terms. */
export const ingestSummary = (
  result: IngestResult,
  fileCount: number,
): FilesSummary => {
  // The service says people_added; the shared parser only maps donors*.
  const raw =
    result.raw && typeof result.raw === "object"
      ? (result.raw as Record<string, unknown>)
      : {};
  const people =
    result.donors ??
    (typeof raw.people_added === "number" ? raw.people_added : null);
  return {
    people,
    gifts: result.gifts,
    duplicates: result.duplicates,
    files: fileCount,
  };
};

/**
 * What step 1's main button does. A saved import (persisted, so it survives
 * "Finish later" and reloads) or people already in Donor Desk let you
 * continue without uploading again; chosen files are imported first.
 */
export const filesStepAction = ({
  pending,
  imported,
  existing,
}: {
  pending: number;
  imported: FilesSummary | null;
  existing: number;
}): "import" | "continue" | "need_files" =>
  pending > 0 ? "import" : imported || existing > 0 ? "continue" : "need_files";

/** "68 people · 113 gifts · 6 possible duplicates found" */
export const filesLine = (summary: FilesSummary) => {
  const parts = [
    summary.people != null ? plural(summary.people, "person", "people") : null,
    summary.gifts != null ? plural(summary.gifts, "gift", "gifts") : null,
    summary.duplicates
      ? plural(summary.duplicates, "possible duplicate", "possible duplicates")
      : null,
  ].filter(Boolean);
  return parts.length
    ? `${parts.join(" · ")} found`
    : `${plural(summary.files, "file", "files")} imported`;
};

/** A message people can act on; the browser's "Failed to fetch" means the service is down. */
export const plainError = (cause: unknown, fallback: string) => {
  if (!(cause instanceof Error) || !cause.message) return fallback;
  if (
    cause.name === "TypeError" ||
    /failed to fetch|networkerror|load failed/i.test(cause.message)
  )
    return "We couldn't reach the Donor Desk service. Check that it's running, then try again.";
  return cause.message;
};

/* ---------- Step 3: the context agent ---------- */

export type TasksResult =
  | { state: "made"; created: number }
  | { state: "skipped"; reason: string }
  | { state: "failed"; reason: string };

export type ContextPhase =
  | { phase: "reading" }
  | { phase: "tasks"; run: ContextRun }
  | { phase: "done"; run: ContextRun; tasks: TasksResult }
  | { phase: "error"; run: ContextRun | null; message: string };

export type ContextEvent =
  | { type: "retry" }
  | { type: "run_ok"; run: ContextRun }
  | { type: "run_failed"; message: string }
  | { type: "tasks"; result: TasksResult };

const READ_SOURCES = ["website", "news"];

/**
 * done: at least one source was read (some may have failed) · saved: the live
 * read failed and the service served this site's saved context · failed:
 * nothing could be read.
 */
export const contextOutcome = (run: ContextRun): ContextSummary["outcome"] => {
  if (run.served_from === "fallback")
    return run.facts.length ? "saved" : "failed";
  const read = run.sources.filter((s) => READ_SOURCES.includes(s.source));
  if (read.some((s) => s.state === "done")) return "done";
  return run.facts.length && run.status === "done" ? "done" : "failed";
};

/** A plain reason when nothing could be read. */
export const contextFailure = (run: ContextRun) => {
  const why =
    run.sources.find((s) => s.source === "website" && s.state !== "done")
      ?.detail ?? run.detail;
  return why
    ? `We couldn't read your website (${why.replace(/^error:\s*/i, "")}).`
    : "We couldn't read your website.";
};

export const contextReducer = (
  state: ContextPhase,
  event: ContextEvent,
): ContextPhase => {
  switch (event.type) {
    case "retry":
      return { phase: "reading" };
    case "run_ok":
      if (state.phase !== "reading") return state;
      return contextOutcome(event.run) === "failed"
        ? { phase: "error", run: event.run, message: contextFailure(event.run) }
        : { phase: "tasks", run: event.run };
    case "run_failed":
      if (state.phase !== "reading") return state;
      return { phase: "error", run: null, message: event.message };
    case "tasks":
      // Tasks never block the dashboard: a failure is shown, then we land.
      if (state.phase !== "tasks") return state;
      return { phase: "done", run: state.run, tasks: event.result };
  }
};

export interface SourceRow {
  key: string;
  label: string;
  /** working: in progress · done: read · problem: couldn't read · quiet: not read */
  tone: "working" | "done" | "problem" | "quiet";
  text: string;
}

const items = (n: number) => plural(n, "item", "items");

const rowFromRun = (source: ContextRunSource, run: ContextRun): SourceRow => {
  const base = { key: source.source, label: source.label };
  switch (source.state) {
    case "done":
      return {
        ...base,
        tone: "done",
        text:
          run.served_from === "cache"
            ? `${items(source.fact_count)} (saved earlier)`
            : items(source.fact_count),
      };
    case "saved_not_connected":
      return { ...base, tone: "quiet", text: "Link saved" };
    case "not_provided":
      return { ...base, tone: "quiet", text: "Not added" };
    case "blocked":
      return { ...base, tone: "problem", text: "The site blocked reading" };
    default:
      return {
        ...base,
        tone: "problem",
        text:
          run.served_from === "fallback" && run.facts.length
            ? "Live read failed; using saved context"
            : "Couldn't read",
      };
  }
};

const SOCIAL_KEYS: SocialPlatform[] = [...SOCIAL_PLATFORMS];

/** The rows while the agent reads: website and news in progress, links saved or not added. */
export const pendingRows = (links: OrgLinks): SourceRow[] => [
  { key: "website", label: "Website", tone: "working", text: "Reading…" },
  { key: "news", label: "News", tone: "working", text: "Searching…" },
  ...SOCIAL_KEYS.map((platform): SourceRow => ({
    key: platform,
    label: SOCIAL_LABELS[platform],
    tone: "quiet",
    text: links[platform] ? "Link saved" : "Not added",
  })),
];

const NOT_READ = { tone: "quiet", text: "Not read" } as const;

/**
 * Per-source rows for the progress list, from the run once it's back.
 * `stopped`: the call failed before any run came back, so nothing spins.
 */
export const sourceRows = (
  links: OrgLinks,
  run: ContextRun | null,
  stopped = false,
): SourceRow[] => {
  if (!run)
    return pendingRows(links).map((row) =>
      stopped && row.tone === "working" ? { ...row, ...NOT_READ } : row,
    );
  const fromRun = new Map(run.sources.map((s) => [s.source, s]));
  return pendingRows(links).map((pending) => {
    const source = fromRun.get(pending.key);
    if (source) return rowFromRun(source, run);
    if (pending.tone !== "working") return pending;
    // A source the run didn't report: its saved items if any, never left spinning.
    const saved = run.facts.filter((f) => f.source === pending.key).length;
    return saved
      ? { ...pending, tone: "done", text: `${items(saved)} (saved earlier)` }
      : { ...pending, ...NOT_READ };
  });
};

export const tasksRow = (phase: ContextPhase): SourceRow | null => {
  const base = { key: "tasks", label: "Today's tasks" };
  if (phase.phase === "tasks")
    return { ...base, tone: "working", text: "Making your list…" };
  if (phase.phase !== "done") return null;
  const { tasks } = phase;
  if (tasks.state === "made")
    return {
      ...base,
      tone: "done",
      text: tasks.created
        ? `${plural(tasks.created, "new task", "new tasks")}`
        : "Up to date",
    };
  return {
    ...base,
    tone: tasks.state === "failed" ? "problem" : "quiet",
    text: tasks.reason,
  };
};

export const contextSummary = (phase: ContextPhase): ContextSummary | null => {
  if (phase.phase === "done")
    return {
      outcome: contextOutcome(phase.run),
      items: phase.run.facts.length,
      tasks: phase.tasks.state === "made" ? phase.tasks.created : null,
    };
  if (phase.phase === "error")
    return {
      outcome: "failed",
      items: phase.run?.facts.length ?? 0,
      tasks: null,
    };
  return null;
};

/** "14 items found · 3 new tasks" */
export const doneLine = (summary: ContextSummary) => {
  const parts = [
    summary.items
      ? `${items(summary.items)} found about your organization`
      : "No items found yet",
    summary.tasks ? plural(summary.tasks, "new task", "new tasks") : null,
  ].filter(Boolean);
  return parts.join(" · ");
};

/** How long the finished run stays on screen before the dashboard opens. */
export const LAND_DELAY_MS = 1800;
