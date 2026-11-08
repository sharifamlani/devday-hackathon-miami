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
  BackgroundRead,
  ContextSummary,
  OnboardingData,
  FilesSummary,
  OrgLinks,
  SocialPlatform,
} from "./onboardingState";
import {
  SOCIAL_LABELS,
  SOCIAL_PLATFORMS,
  TABS,
  TAB_NAMES,
  readTabCounts,
} from "./onboardingState";

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

/**
 * What POST /ingest reported, in the onboarding's terms. The service answers
 * {people_added, gifts_added, by_tab, flagged_for_review, duplicate_suggestions}
 * (service/ingest_adapter.py); the shared parser maps gifts and duplicates,
 * the rest is read from the raw response here.
 */
export const ingestSummary = (
  result: IngestResult,
  fileCount: number,
): FilesSummary => {
  const raw =
    result.raw && typeof result.raw === "object"
      ? (result.raw as Record<string, unknown>)
      : {};
  const byTab = readTabCounts(raw.by_tab);
  const people =
    result.donors ??
    (typeof raw.people_added === "number" ? raw.people_added : null) ??
    (byTab ? byTab.giver + byTab.neighbor + byTab.community : null);
  return {
    people,
    gifts: result.gifts,
    ...(typeof raw.declined_on_record === "number"
      ? { declined: raw.declined_on_record }
      : {}),
    duplicates: result.duplicates,
    files: fileCount,
    byTab,
    review: Array.isArray(raw.flagged_for_review)
      ? raw.flagged_for_review.length
      : null,
  };
};

/** The receipt's per-tab counts, in tab order; null when the service didn't say. */
export const tabRows = (summary: FilesSummary) =>
  summary.byTab
    ? TABS.map((tab) => ({
        tab,
        label: TAB_NAMES[tab],
        count: summary.byTab![tab],
      }))
    : null;

/** Past this many chosen files the list starts collapsed, so the button stays in view. */
export const COLLAPSE_AFTER = 3;

export const totalBytes = (files: { size: number }[]) =>
  files.reduce((sum, f) => sum + f.size, 0);

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

/** "68 people · 113 gifts (+1 declined charge on record) · 6 possible duplicates found" */
export const filesLine = (summary: FilesSummary) => {
  const declined = summary.declined
    ? ` (+${plural(summary.declined, "declined charge", "declined charges")} on record)`
    : "";
  const parts = [
    summary.people != null ? plural(summary.people, "person", "people") : null,
    summary.gifts != null ? plural(summary.gifts, "gift", "gifts") + declined : null,
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

/** "0:07", "1:32": elapsed time while something runs. */
export const clock = (ms: number) => {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
};

/* ---------- Step 3: the context agent ---------- */

/**
 * POST /context/run waits this long for the website (service/config.py
 * CONTEXT_DEADLINE_S), then answers with served_from "fallback" and the read
 * goes on in the background. The progress bar is drawn against it.
 */
export const RUN_WAIT_MS = 30_000;

export type TasksResult =
  | { state: "made"; created: number }
  | { state: "skipped"; reason: string }
  | { state: "failed"; reason: string };

/** What the finished read shows before the dashboard opens. */
export interface Receipt {
  facts: number;
  /** A few facts, newest first. */
  titles: string[];
  tasks: number | null;
  /** Why there is no task count: "Not in this preview", "Couldn't make the list". */
  tasksNote?: string | null;
  orgName: string | null;
}

/**
 * reading: POST /context/run is in flight · tasks: then /tasks/generate ·
 * receipt → welcome: it worked, the dashboard opens on its own · slow: the
 * run timed out or the model failed, so the read goes on in the background
 * (POST /context/refresh) and people can move on · error: nothing was read.
 */
export type ContextPhase =
  | { phase: "reading" }
  | { phase: "tasks"; run: ContextRun }
  | { phase: "receipt"; run: ContextRun | null; receipt: Receipt }
  | { phase: "welcome"; run: ContextRun | null; receipt: Receipt }
  | { phase: "slow"; run: ContextRun }
  | { phase: "error"; run: ContextRun | null; message: string };

export type ContextEvent =
  | { type: "retry" }
  | { type: "run_ok"; run: ContextRun }
  | { type: "run_failed"; message: string }
  | { type: "tasks"; result: TasksResult }
  | { type: "welcome" }
  | { type: "background_done"; read: BackgroundRead }
  | { type: "background_failed"; message: string };

const READ_SOURCES = ["website", "news"];

/**
 * done: at least one source was read (another may have failed) · slow: the
 * live read timed out or the model failed (served_from "fallback"), so it
 * goes on in the background · failed: nothing could be read (a bad address,
 * a blocked site).
 */
export const contextOutcome = (run: ContextRun): "done" | "slow" | "failed" => {
  if (run.served_from === "fallback") return "slow";
  const read = run.sources.filter((s) => READ_SOURCES.includes(s.source));
  if (read.some((s) => s.state === "done" || s.state === "cached")) return "done";
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

export const receiptFromRun = (
  run: ContextRun,
  tasks: TasksResult | null,
): Receipt => ({
  facts: run.facts.length,
  titles: run.facts.slice(0, 3).map((f) => f.fact),
  tasks: tasks?.state === "made" ? tasks.created : null,
  tasksNote: tasks && tasks.state !== "made" ? tasks.reason : null,
  orgName: run.profile?.name ?? null,
});

export const contextReducer = (
  state: ContextPhase,
  event: ContextEvent,
): ContextPhase => {
  switch (event.type) {
    case "retry":
      return state.phase === "error" ? { phase: "reading" } : state;
    case "run_ok": {
      if (state.phase !== "reading") return state;
      const outcome = contextOutcome(event.run);
      if (outcome === "slow") return { phase: "slow", run: event.run };
      return outcome === "failed"
        ? { phase: "error", run: event.run, message: contextFailure(event.run) }
        : { phase: "tasks", run: event.run };
    }
    case "run_failed":
      if (state.phase !== "reading") return state;
      return { phase: "error", run: null, message: event.message };
    case "tasks":
      // Tasks never block the dashboard: a failure is shown, then we land.
      if (state.phase !== "tasks") return state;
      return {
        phase: "receipt",
        run: state.run,
        receipt: receiptFromRun(state.run, event.result),
      };
    case "welcome":
      return state.phase === "receipt"
        ? { phase: "welcome", run: state.run, receipt: state.receipt }
        : state;
    case "background_done":
      if (state.phase !== "slow") return state;
      return {
        phase: "receipt",
        run: null,
        receipt: {
          facts: event.read.facts ?? 0,
          titles: event.read.titles,
          tasks: null,
          orgName: state.run.profile?.name ?? null,
        },
      };
    case "background_failed":
      if (state.phase !== "slow") return state;
      return { phase: "error", run: state.run, message: event.message };
  }
};

export interface SourceRow {
  key: string;
  label: string;
  /** active: working on it · done · pending: not started · problem: couldn't · quiet: not read (not added, saved for later) */
  tone: "active" | "done" | "pending" | "problem" | "quiet";
  text: string;
}

const items = (n: number) => plural(n, "fact", "facts");

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
    case "cached":
      return {
        ...base,
        tone: "done",
        text: source.fact_count
          ? `${items(source.fact_count)} (saved; live read unavailable)`
          : "Saved earlier; live read unavailable",
      };
    case "saved_not_connected":
      return { ...base, tone: "quiet", text: "Saved for later" };
    case "not_provided":
      return { ...base, tone: "quiet", text: "Not added" };
    case "blocked":
      return { ...base, tone: "problem", text: "The site blocked reading" };
    default:
      return { ...base, tone: "problem", text: "Couldn't read" };
  }
};

const SOCIAL_KEYS: SocialPlatform[] = [...SOCIAL_PLATFORMS];

const hostOf = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
};

/** Rows before any result: website and news `reading` or `waiting`, links saved or not added. */
export const pendingRows = (
  links: OrgLinks,
  state: "reading" | "slow" | "stopped",
): SourceRow[] => {
  const host = hostOf(links.website);
  const read = (key: string, label: string, doing: string): SourceRow =>
    state === "stopped"
      ? { key, label, tone: "quiet", text: "Not read" }
      : {
          key,
          label,
          tone: "active",
          text: state === "slow" ? "Still reading in the background…" : doing,
        };
  return [
    read("website", "Website", host ? `Reading ${host}…` : "Reading…"),
    read("news", "News", "Searching recent news…"),
    ...SOCIAL_KEYS.map((platform): SourceRow => ({
      key: platform,
      label: SOCIAL_LABELS[platform],
      tone: "quiet",
      text: links[platform] ? "Saved for later" : "Not added",
    })),
  ];
};

/** Per-source rows from a finished run; a source the run didn't report is never left spinning. */
export const sourceRows = (links: OrgLinks, run: ContextRun): SourceRow[] => {
  const fromRun = new Map(run.sources.map((s) => [s.source, s]));
  return pendingRows(links, "reading").map((pending) => {
    const source = fromRun.get(pending.key);
    if (source) return rowFromRun(source, run);
    if (pending.tone !== "active") return pending;
    const saved = run.facts.filter((f) => f.source === pending.key).length;
    return saved
      ? { ...pending, tone: "done", text: `${items(saved)} (saved earlier)` }
      : { ...pending, tone: "quiet", text: "Not read" };
  });
};

const TASKS_ROW = { key: "tasks", label: "Today's tasks" };

const tasksText = (tasks: number | null) =>
  tasks == null
    ? "On your dashboard"
    : tasks
      ? plural(tasks, "new task", "new tasks")
      : "Up to date";

/** The checklist for every phase: one row per source, then today's tasks. */
export const checklist = (
  links: OrgLinks,
  phase: ContextPhase,
): SourceRow[] => {
  switch (phase.phase) {
    case "reading":
      return [
        ...pendingRows(links, "reading"),
        { ...TASKS_ROW, tone: "pending", text: "After the read" },
      ];
    case "tasks":
      return [
        ...sourceRows(links, phase.run),
        { ...TASKS_ROW, tone: "active", text: "Making your list…" },
      ];
    case "slow":
      return [
        ...sourceRows(links, phase.run),
        { ...TASKS_ROW, tone: "pending", text: "After the read" },
      ];
    case "receipt":
    case "welcome":
      return [
        ...(phase.run
          ? sourceRows(links, phase.run)
          : pendingRows(links, "reading").map((row) =>
              row.tone === "active"
                ? { ...row, tone: "done" as const, text: "Read" }
                : row,
            )),
        phase.receipt.tasks == null && phase.receipt.tasksNote
          ? { ...TASKS_ROW, tone: "quiet", text: phase.receipt.tasksNote }
          : {
              ...TASKS_ROW,
              tone: "done",
              text: tasksText(phase.receipt.tasks),
            },
      ];
    case "error":
      return [
        ...(phase.run
          ? sourceRows(links, phase.run)
          : pendingRows(links, "stopped")),
        { ...TASKS_ROW, tone: "quiet", text: "Not made yet" },
      ];
  }
};

/**
 * The bar above the checklist, 0–1. While the run is in flight it fills
 * against RUN_WAIT_MS (the service's wait), never past 65%: the bar only
 * reaches the end when the read really finished. Null hides it (errors).
 */
export const progressFraction = (
  phase: ContextPhase,
  elapsedMs: number,
  waitMs = RUN_WAIT_MS,
): number | null => {
  switch (phase.phase) {
    case "reading":
      return 0.05 + 0.6 * Math.min(1, Math.max(0, elapsedMs) / waitMs);
    case "slow":
      return 0.7;
    case "tasks":
      return 0.85;
    case "receipt":
    case "welcome":
      return 1;
    case "error":
      return null;
  }
};

export const contextSummary = (phase: ContextPhase): ContextSummary | null => {
  switch (phase.phase) {
    case "receipt":
    case "welcome":
      return {
        outcome: "done",
        items: phase.receipt.facts,
        tasks: phase.receipt.tasks,
      };
    case "slow":
      return {
        outcome: "background",
        items: phase.run.facts.length,
        tasks: null,
      };
    case "error":
      return {
        outcome: "failed",
        items: phase.run?.facts.length ?? 0,
        tasks: null,
      };
    default:
      return null;
  }
};

/** "14 facts found · 3 new tasks" */
export const receiptLine = (receipt: Receipt) =>
  [
    receipt.facts
      ? `${items(receipt.facts)} found about your organization`
      : "No new facts this time",
    receipt.tasks ? plural(receipt.tasks, "new task", "new tasks") : null,
  ]
    .filter(Boolean)
    .join(" · ");

/** How long the welcome card stays before the dashboard. The receipt before it waits for a click. */
export const WELCOME_MS = 1600;

/* ---------- The background read (POST/GET /context/refresh) ---------- */

/** GET /context/refresh (service/main.py refresh_job_state). */
export interface RefreshJob {
  status?: string | null; // idle | refreshing | done | failed
  started_at?: string | null;
  finished_at?: string | null;
  detail?: string | null;
  changes?: {
    facts?: {
      added?: number | null;
      added_facts?: string[] | null;
      failed_sources?: string[] | null;
    } | null;
  } | null;
}

export const POLL_MS = 3000;
/** Stop watching after this long; the job may still finish and save. */
export const GIVE_UP_MS = 10 * 60_000;

export const backgroundStarted = (job: RefreshJob | null): BackgroundRead => ({
  status: "running",
  startedAt: job?.started_at ?? null,
  finishedAt: null,
  facts: null,
  titles: [],
  detail: null,
  hidden: false,
});

const failed = (current: BackgroundRead, detail: string, at: string | null) =>
  ({
    ...current,
    status: "failed",
    finishedAt: at,
    detail,
  }) satisfies BackgroundRead;

/** What a GET /context/refresh report means for the read we started. */
export const readRefreshJob = (
  job: RefreshJob | null,
  current: BackgroundRead,
  now: number,
): BackgroundRead => {
  const at = job?.finished_at ?? null;
  switch (job?.status) {
    case "refreshing": {
      const started = job.started_at ?? current.startedAt;
      const since = started ? now - Date.parse(started) : 0;
      if (since > GIVE_UP_MS)
        return failed(
          current,
          "Reading your website is taking much longer than usual. Check back later, or choose Set up again in your profile menu.",
          null,
        );
      return { ...current, status: "running", startedAt: started };
    }
    case "done": {
      const facts = job.changes?.facts;
      const failedSources = facts?.failed_sources ?? [];
      if (READ_SOURCES.every((s) => failedSources.includes(s)))
        return failed(current, "We couldn't read your website this time.", at);
      return {
        ...current,
        status: "done",
        finishedAt: at,
        facts: facts?.added ?? 0,
        titles: (facts?.added_facts ?? []).slice(0, 3),
        detail: null,
      };
    }
    case "failed":
      return failed(
        current,
        /no website saved/i.test(job.detail ?? "")
          ? "Your website wasn't saved, so it couldn't be read. Choose Set up again in your profile menu."
          : "We couldn't read your website this time.",
        at,
      );
    default:
      // idle: nothing is running, so the read we started is gone (a restart).
      return failed(
        current,
        "The read stopped before it finished. Choose Set up again in your profile menu to try again.",
        at,
      );
  }
};

/** The one line about the background read, for the dashboard. */
export const backgroundLine = (read: BackgroundRead) =>
  read.status === "running"
    ? "Still reading your website. New facts show up here when it's done."
    : read.status === "done"
      ? read.facts
        ? `Your website is read: ${items(read.facts)} saved.`
        : "Your website is read. Nothing new this time."
      : (read.detail ?? "We couldn't read your website this time.");

/** The card's title and line: "ready" only when the website really was read. The read-only sample
 * build (`sample`) reads no website: its workspace is already built, so the card says that instead. */
export const offerCopy = (
  data: Pick<OnboardingData, "context" | "background">,
  sample = false,
): { title: string; body: string } => {
  if (sample)
    return {
      title: "This is the sample desk.",
      body: "Every name and amount is made up. Want a one-minute tour of where things are?",
    };
  const outcome =
    data.background?.status === "done" ? "done" : data.context?.outcome;
  if (outcome === "done")
    return {
      title: "Your desk is ready.",
      body: "Want a one-minute tour of where things are?",
    };
  if (outcome === "background" && data.background?.status !== "failed")
    return {
      title: "Your desk is open.",
      body: "We're still reading your website. Want a one-minute tour while it finishes?",
    };
  return {
    title: "Your desk is open.",
    body: "Your website wasn't read yet. Want a one-minute tour of where things are?",
  };
};
