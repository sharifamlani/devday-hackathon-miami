import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

import { call } from "../providers/local/endpoint";
import {
  POLL_MS,
  backgroundStarted,
  readRefreshJob,
  type RefreshJob,
} from "./firstRun";
import { onboardingStore, type BackgroundRead } from "./onboardingState";

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
