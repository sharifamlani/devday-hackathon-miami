import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

import { DATA_MODE, donorDeskMethods } from "../providers/local";
import { sourceOf } from "../providers/local/endpoint";
import { generateTasks } from "../providers/local/tasks";
import { call } from "../providers/local/endpoint";
import {
  POLL_MS,
  contextReducer,
  contextSummary,
  plainError,
  type TasksResult,
  backgroundStarted,
  readRefreshJob,
  type RefreshJob,
} from "./firstRun";
import {
  onboardingStore,
  type BackgroundRead,
  type OrgLinks,
  type OnboardingPatch,
} from "./onboardingState";

/**
 * A slow first read goes on in the background: POST /context/refresh starts
 * one pass on the URLs the service saved (service/main.py start_refresh_job),
 * GET /context/refresh reports it. The state lives in onboarding storage, so
 * the status line survives moving around the app and a reload.
 */

const FEATURE = "Reading your website";

export const startBackgroundRead = async (): Promise<BackgroundRead> => {
  const job = await call<RefreshJob>(FEATURE, "POST", "/context/refresh");
  const read = backgroundStarted(job);
  onboardingStore.dispatch({ type: "update", patch: { background: read } });
  return read;
};

/** Three failed polls in a row (the service went away) end the watch. */
const MAX_POLL_ERRORS = 3;

/**
 * Polls while the background read runs; mount once (OnboardingGate). When it
 * finishes, every query refetches so the dashboard shows the new facts and
 * tasks, and the setup summary is updated to match.
 */
export const useBackgroundWatcher = (running: boolean) => {
  const queryClient = useQueryClient();
  useEffect(() => {
    if (!running) return;
    let stopped = false;
    let timer = 0;
    let errors = 0;
    const save = (background: BackgroundRead) => {
      const { data } = onboardingStore.get();
      const context =
        background.status === "done" && data.context
          ? {
              ...data.context,
              outcome: "done" as const,
              items: data.context.items + (background.facts ?? 0),
            }
          : data.context;
      onboardingStore.dispatch({
        type: "update",
        patch: { background, context },
      });
    };
    const tick = async () => {
      const current = onboardingStore.get().data.background;
      if (stopped || current?.status !== "running") return;
      try {
        const job = await call<RefreshJob>(FEATURE, "GET", "/context/refresh");
        errors = 0;
        if (stopped) return;
        const next = readRefreshJob(job, current, Date.now());
        if (next.status !== "running" || next.startedAt !== current.startedAt)
          save(next);
        if (next.status === "done") void queryClient.invalidateQueries();
        if (next.status !== "running") return;
      } catch {
        if (++errors >= MAX_POLL_ERRORS) {
          save({
            ...current,
            status: "failed",
            detail:
              "We lost touch with the Donor Desk service while it read your website. Choose Set up again in your profile menu to try again.",
          });
          return;
        }
      }
      if (!stopped) timer = window.setTimeout(() => void tick(), POLL_MS);
    };
    timer = window.setTimeout(() => void tick(), POLL_MS);
    return () => {
      stopped = true;
      window.clearTimeout(timer);
    };
  }, [running, queryClient]);
};

/** Save/research the organization without holding the dashboard behind a receipt.
 * This promise outlives the setup form; service writes and the existing slow-read
 * watcher retain the same behavior after the form unmounts.
 */
export const readOrganizationInBackground = async (
  links: OrgLinks,
): Promise<void> => {
  const update = (patch: OnboardingPatch) =>
    onboardingStore.dispatch({ type: "update", patch });
  update({ background: null, context: null });
  try {
    const run = await donorDeskMethods.runContext({
      website: links.website,
      x_url: links.x || null,
      linkedin_url: links.linkedin || null,
      instagram_url: links.instagram || null,
    });
    let phase = contextReducer({ phase: "reading" }, { type: "run_ok", run });
    if (phase.phase === "tasks") {
      let tasks: TasksResult = {
        state: "skipped",
        reason: "Not in this preview",
      };
      const source = await sourceOf("POST", "/tasks/generate");
      if (source !== "snapshot" && source !== "unavailable") {
        try {
          const made = await generateTasks();
          tasks = { state: "made", created: made?.created ?? 0 };
        } catch {
          tasks = { state: "failed", reason: "Couldn't make the list" };
        }
      }
      phase = contextReducer(phase, { type: "tasks", result: tasks });
    }
    update({
      context: contextSummary(phase),
      linksSavedTo: DATA_MODE === "local" ? "live" : "local",
    });
    if (phase.phase === "slow") await startBackgroundRead();
    else if (phase.phase === "error") throw new Error(phase.message);
  } catch (cause) {
    update({
      context: {
        outcome: "failed",
        items: onboardingStore.get().data.context?.items ?? 0,
        tasks: null,
      },
      background: {
        status: "failed",
        startedAt: null,
        finishedAt: new Date().toISOString(),
        facts: null,
        titles: [],
        hidden: false,
        detail: plainError(
          cause,
          "We couldn't read your website. You can try again from your profile menu.",
        ),
      },
    });
  }
};
