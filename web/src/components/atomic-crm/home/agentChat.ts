/**
 * The Home chat's connection to the main-UI agent (plan.md §21.2.5, B10): POST /chat with the conversation,
 * tool steps shown as cards (Undo → POST /undo/{token}), sends / merges / deletes as approval cards
 * (→ POST /chat/approve). A tiny external store so the thread and the composer (siblings on HomePage)
 * share one conversation without a provider.
 */
import { useSyncExternalStore } from "react";

import { API_URL, APPROVER_NAME } from "../providers/local/config";
import { scopesForTool, type RefetchScope } from "../providers/local/refetch";

export type AgentStep = {
  tool: string;
  args: Record<string, unknown>;
  summary: string | null;
  status: "done" | "error" | "awaiting_approval";
  undo_token: string | null;
  call_id?: string | null;
  undone?: boolean;
};

export type AgentApproval = {
  call_id: string;
  tool: string;
  args: Record<string, unknown>;
  /** One plain line from the service ("Call Maria Delgado at ***-***-0101"); absent = show the args. */
  summary?: string | null;
};

export type AgentMessage =
  | { role: "user"; text: string }
  | {
      role: "assistant";
      text: string;
      steps: AgentStep[];
      approvals: AgentApproval[];
      runId: string | null;
      decided?: boolean;
      /** call_id → approved; set when the person decides, so each card shows the outcome. */
      decisions?: Record<string, boolean>;
      /** set when approve/decline failed (e.g. the paused run was already consumed): the card is closed, not pending. */
      handled?: string;
    };

type ChatResponse = {
  reply: string | null;
  steps: AgentStep[];
  approvals: AgentApproval[];
  run_id: string | null;
};

type State = { messages: AgentMessage[]; pending: boolean; error: string | null };

let state: State = { messages: [], pending: false, error: null };
const listeners = new Set<() => void>();

const set = (next: Partial<State>) => {
  state = { ...state, ...next };
  listeners.forEach((l) => l());
};

export const useAgentChat = () =>
  useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
    () => state, // server snapshot: renderToString (the render tests) needs one
  );

export type Refetch = (scopes?: RefetchScope[]) => unknown;

/** Scopes touched by the writes in these steps (undefined = refetch everything). */
export const scopesOf = (steps: AgentStep[]): RefetchScope[] => {
  const scopes = new Set<RefetchScope>();
  for (const s of steps)
    if (s.status === "done" && s.undo_token) scopesForTool(s.tool)?.forEach((x) => scopes.add(x));
  return [...scopes];
};

const post = async <T,>(path: string, body: unknown): Promise<T> => {
  const res = await fetch(`${API_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    let detail = `${res.status}`;
    try {
      const data = await res.json();
      detail = typeof data?.detail === "string" ? data.detail : data?.detail?.detail ?? detail;
    } catch {
      /* not JSON */
    }
    throw new Error(res.status === 503 || res.status === 404 ? `The agent isn’t available yet (${detail})` : detail);
  }
  return res.json() as Promise<T>;
};

const toAssistant = (r: ChatResponse): AgentMessage => ({
  role: "assistant",
  text: r.reply ?? "",
  steps: r.steps ?? [],
  approvals: r.approvals ?? [],
  runId: r.run_id ?? null,
});

const history = () =>
  state.messages
    .map((m) => ({ role: m.role, content: m.text }))
    .filter((m) => m.content.trim())
    .slice(-12);

export const sendToAgent = async (text: string, refetch: Refetch) => {
  const message = text.trim();
  if (!message || state.pending) return;
  const prior = history();
  set({ messages: [...state.messages, { role: "user", text: message }], pending: true, error: null });
  try {
    const r = await post<ChatResponse>("/chat", { message, history: prior, context: { screen: "home" } });
    set({ messages: [...state.messages, toAssistant(r)], pending: false });
    const scopes = scopesOf(r.steps ?? []);
    if (scopes.length) refetch(scopes);
  } catch (e) {
    set({ pending: false, error: e instanceof Error ? e.message : String(e) });
  }
};

const patchStep = (msgIndex: number, stepIndex: number, patch: Partial<AgentStep>) => {
  const messages = state.messages.map((m, i) =>
    i === msgIndex && m.role === "assistant"
      ? { ...m, steps: m.steps.map((s, j) => (j === stepIndex ? { ...s, ...patch } : s)) }
      : m,
  );
  set({ messages });
};

export const undoStep = async (msgIndex: number, stepIndex: number, refetch: Refetch) => {
  const m = state.messages[msgIndex];
  const step = m?.role === "assistant" ? m.steps[stepIndex] : undefined;
  if (!step?.undo_token || step.undone) return;
  try {
    await post(`/undo/${encodeURIComponent(step.undo_token)}`, undefined);
    patchStep(msgIndex, stepIndex, { undone: true });
    refetch(scopesForTool(step.tool));
  } catch (e) {
    set({ error: `Couldn’t undo: ${e instanceof Error ? e.message : String(e)}` });
  }
};

/** A person decided the paused calls of one reply (call_id → approve). Unlisted calls are declined. */
/**
 * The service's stand-in reply while a run waits on cards (service/chat_agent.py: "Waiting for you: …").
 * Once the person decides, the cards say Approved/Declined, so the stale line is dropped.
 */
export const WAITING_PREFIX = "Waiting for you: ";

export const decide = async (msgIndex: number, decisions: Record<string, boolean>, refetch: Refetch) => {
  const m = state.messages[msgIndex];
  if (m?.role !== "assistant" || !m.runId || m.decided || state.pending) return;
  set({
    messages: state.messages.map((x, i) =>
      i === msgIndex
        ? {
            ...m,
            text: m.text.startsWith(WAITING_PREFIX) ? "" : m.text,
            decided: true,
            decisions: Object.fromEntries(m.approvals.map((a) => [a.call_id, Boolean(decisions[a.call_id])])),
          }
        : x,
    ),
    pending: true,
    error: null,
  });
  try {
    const r = await post<ChatResponse>("/chat/approve", {
      run_id: m.runId,
      approved_by: APPROVER_NAME,
      approvals: m.approvals.map((a) => ({ call_id: a.call_id, approve: Boolean(decisions[a.call_id]) })),
    });
    set({ messages: [...state.messages, toAssistant(r)], pending: false });
    const scopes = scopesOf(r.steps ?? []);
    if (scopes.length) refetch(scopes);
  } catch (e) {
    set({
      messages: state.messages.map((x, i) =>
        i === msgIndex
          ? { ...m, text: m.text.startsWith(WAITING_PREFIX) ? "" : m.text, decided: true, decisions: undefined, handled: "Already handled" }
          : x,
      ),
      pending: false,
      error: e instanceof Error ? e.message : String(e),
    });
  }
};

/** For tests. */
export const resetAgentChat = () => set({ messages: [], pending: false, error: null });

/** For tests: the thread as it stands. */
export const agentChatMessages = () => state.messages;
