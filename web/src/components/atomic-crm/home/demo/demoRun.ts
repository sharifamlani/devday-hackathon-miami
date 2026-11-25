/**
 * Plays a "Try the agent" sample run in the public build: the user's line, then each step "running" for a
 * moment before it is "done", then the result cards. A tiny external store (like agentChat) so the rows on
 * Home and the thread that draws the runs share it. Nothing leaves the browser.
 */
import { useSyncExternalStore } from "react";

import type { AgentStep } from "../agentChat";
import { prefersReducedMotion } from "@/lib/motion";
import { loadSnapshot } from "../../providers/local/snapshotClient";
import { buildScript, type DemoScript, type DemoSnapshot, type ScenarioId } from "./scenarios";

export interface DemoRun {
  id: number;
  /** When it started: the thread orders sample runs and asked questions by this. */
  at: number;
  question: string;
  script: DemoScript | null;
  error: string | null;
  /** How many steps are done; the next one shows as running until this passes it. */
  shown: number;
  done: boolean;
  /** The Send card's answer, once given. */
  decision?: boolean;
  /** Steps added after the run: Send's outcome, Lookup's Save, the call's log. */
  extra: AgentStep[];
}

type State = { runs: DemoRun[]; playing: boolean };

/** How long each step "runs". */
export const STEP_MS = 700;

let state: State = { runs: [], playing: false };
let nextId = 1;
const listeners = new Set<() => void>();

const set = (next: State) => {
  state = next;
  listeners.forEach((l) => l());
};

const patch = (id: number, change: Partial<DemoRun> | ((run: DemoRun) => Partial<DemoRun>)) =>
  set({
    ...state,
    runs: state.runs.map((r) => (r.id === id ? { ...r, ...(typeof change === "function" ? change(r) : change) } : r)),
  });

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** The steps to draw: the done ones, plus the next one still running. */
export const visibleSteps = (run: DemoRun): AgentStep[] => {
  if (!run.script) return [];
  const steps = run.script.steps;
  return steps
    .slice(0, Math.min(run.shown + 1, steps.length))
    .map((s, i) => (i < run.shown ? s : { ...s, status: "running" as const }));
};

/** Plays one scenario. Ignored while another run is still playing. */
export const playDemo = async (
  scenario: ScenarioId,
  question: string,
  {
    stepMs = STEP_MS,
    load = loadSnapshot as () => Promise<unknown>,
  }: { stepMs?: number; load?: () => Promise<unknown> } = {},
) => {
  if (state.playing) return;
  const id = nextId++;
  set({
    playing: true,
    runs: [...state.runs, { id, at: Date.now(), question, script: null, error: null, shown: 0, done: false, extra: [] }],
  });
  try {
    const script = buildScript(scenario, (await load()) as DemoSnapshot);
    if (prefersReducedMotion() || stepMs <= 0) {
      patch(id, { script, shown: script.steps.length, done: true });
    } else {
      patch(id, { script });
      for (let i = 1; i <= script.steps.length; i++) {
        await sleep(stepMs);
        patch(id, { shown: i });
      }
      patch(id, { done: true });
    }
  } catch (e) {
    patch(id, { error: e instanceof Error ? e.message : String(e), done: true });
  } finally {
    set({ ...state, playing: false });
  }
};

/** The Send card's answer: adds its outcome as a step. Only the first answer counts. */
export const decideDemo = (id: number, approve: boolean) =>
  patch(id, (r) => {
    if (r.decision !== undefined || !r.script?.approval) return {};
    const a = r.script.approval;
    return { decision: approve, extra: [...r.extra, approve ? a.approved : a.declined] };
  });

/** Adds the run's follow-up step once (Lookup's Save, the call's log). */
export const followUpDemo = (id: number) =>
  patch(id, (r) => {
    const f = r.script?.followUp;
    return f && !r.extra.includes(f) ? { extra: [...r.extra, f] } : {};
  });

export const resetDemoRuns = () => set({ runs: [], playing: false });

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export const getDemoState = (): State => state;

export const useDemoRuns = (): State => useSyncExternalStore(subscribe, getDemoState);

/** A card's "Open profile": Home listens and opens the donor drawer. */
export const OPEN_DONOR_EVENT = "donor-desk:open-donor";
export const openDonor = (id: number) => window.dispatchEvent(new CustomEvent(OPEN_DONOR_EVENT, { detail: id }));
