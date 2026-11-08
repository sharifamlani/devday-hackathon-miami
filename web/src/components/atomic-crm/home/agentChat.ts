/**
 * The Home chat's connection to the main-UI agent (plan.md §21.2.5, B10): POST /chat/stream with the
 * conversation (each tool step appears as it runs, the reply types out live; POST /chat if the stream fails),
 * tool steps shown as cards (Undo → POST /undo/{token}), sends / merges / deletes as approval cards
 * (→ POST /chat/approve). A tiny external store so the thread and the composer (siblings on HomePage)
 * share one conversation without a provider.
 */
import { useSyncExternalStore } from "react";

import { API_URL, APPROVER_NAME, PUBLIC_READ_ONLY } from "../providers/local/config";
import { scopesForTool, type RefetchScope } from "../providers/local/refetch";

export type AgentStep = {
  tool: string;
  args: Record<string, unknown>;
  summary: string | null;
  status: "running" | "done" | "error" | "awaiting_approval";
  undo_token: string | null;
  call_id?: string | null;
  undone?: boolean;
  /** A richer card from the service, drawn by kind (e.g. "call_sheet", "merged_pairs"). */
  card?: StepCardData | null;
};

/** One pair the agent merged by itself (80%+ match), with its own Undo. */
export type MergedPair = {
  suggestion_id: number;
  kept: string;
  merged_in: string;
  confidence: number;
  evidence: string;
  undo_token: string | null;
  undone?: boolean;
};

export type StepCardData = { kind: "merged_pairs"; pairs: MergedPair[] } | { kind: string; [key: string]: unknown };

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
      /** true while the reply is still streaming in */
      streaming?: boolean;
    };

type AssistantMessage = Extract<AgentMessage, { role: "assistant" }>;
type Assistant = AssistantMessage;

type ChatResponse = {
  reply: string | null;
  steps: AgentStep[];
  approvals: AgentApproval[];
  run_id: string | null;
};

type State = { messages: AgentMessage[]; pending: boolean; error: string | null };

/** The last conversation, kept for this tab so a reload doesn't lose the thread and its Undo buttons. */
export const CHAT_STORAGE_KEY = "donor-desk-agent-chat";

/** The saved thread, if any: nothing left streaming or spinning (a reload ended those runs). */
export const loadSavedChat = (): AgentMessage[] => {
  try {
    const raw = typeof sessionStorage === "undefined" ? null : sessionStorage.getItem(CHAT_STORAGE_KEY);
    const saved = raw ? (JSON.parse(raw) as AgentMessage[]) : [];
    if (!Array.isArray(saved)) return [];
    return saved.map((m) =>
      m.role !== "assistant"
        ? m
        : {
            ...m,
            streaming: undefined,
            steps: (m.steps ?? []).map((st) => (st.status === "running" ? { ...st, status: "error" as const, summary: "no result" } : st)),
          },
    );
  } catch {
    return [];
  }
};

const saveChat = (messages: AgentMessage[]) => {
  try {
    if (typeof sessionStorage === "undefined") return;
    if (messages.length) sessionStorage.setItem(CHAT_STORAGE_KEY, JSON.stringify(messages.slice(-20)));
    else sessionStorage.removeItem(CHAT_STORAGE_KEY);
  } catch {
    /* private mode or full storage: the thread just isn't kept */
  }
};

let state: State = { messages: loadSavedChat(), pending: false, error: null };
const listeners = new Set<() => void>();

const set = (next: Partial<State>) => {
  state = { ...state, ...next };
  if (next.messages) saveChat(state.messages);
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
    if (s.status === "done") scopesForTool(s.tool)?.forEach((x) => scopes.add(x));
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

const toAssistant = (r: ChatResponse): AssistantMessage => ({
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

const withStep = (reply: Assistant, callId: string, patch: Partial<AgentStep>): Assistant => ({
  ...reply,
  steps: reply.steps.map((s) => (s.call_id === callId ? { ...s, ...patch } : s)),
});

/**
 * Apply one line of the assistant-stream data stream (service/chat_stream.py) to the reply being built:
 * "0:" text delta · "b:" a tool call starts (its card shows as running) · "c:" its JSON args arrive ·
 * "a:" its result {summary, status, undo_token, card} · "2:" data ({type: "approvals", run_id, approvals}) ·
 * "3:" an error (thrown). Anything else (finish markers) is ignored. argsText collects partial args per call.
 */
export const applyStreamLine = (reply: Assistant, line: string, argsText: Map<string, string>): Assistant => {
  const at = line.indexOf(":");
  if (at < 1) return reply;
  let value: any;
  try {
    value = JSON.parse(line.slice(at + 1));
  } catch {
    return reply;
  }
  switch (line.slice(0, at)) {
    case "0":
      return { ...reply, text: reply.text + String(value) };
    case "b":
      return {
        ...reply,
        steps: [
          ...reply.steps,
          { tool: value.toolName, args: {}, summary: null, status: "running", undo_token: null, call_id: value.toolCallId },
        ],
      };
    case "c": {
      const text = (argsText.get(value.toolCallId) ?? "") + (value.argsTextDelta ?? "");
      argsText.set(value.toolCallId, text);
      try {
        return withStep(reply, value.toolCallId, { args: JSON.parse(text) });
      } catch {
        return reply; // the args are still arriving
      }
    }
    case "a": {
      const r = value.result ?? {};
      return withStep(reply, value.toolCallId, {
        summary: r.summary ?? null,
        status: r.status ?? "done",
        undo_token: r.undo_token ?? null,
        card: r.card ?? undefined,
      });
    }
    case "2":
      for (const d of Array.isArray(value) ? value : [])
        if (d?.type === "approvals") reply = { ...reply, approvals: d.approvals ?? [], runId: d.run_id ?? null };
      return reply;
    case "3":
      throw new Error(typeof value === "string" ? value : JSON.stringify(value));
    default:
      return reply;
  }
};

/** What POST /chat would say for a run paused on cards with no words of its own (service: "Waiting for you: …"). */
export const waitingLine = (approvals: AgentApproval[]) =>
  approvals.length === 1
    ? `${WAITING_PREFIX}${approvals[0].summary || approvals[0].tool.replace(/_/g, " ")}.`
    : `${WAITING_PREFIX}${approvals.length} decisions on the cards above.`; // each card already says what it does

export const sendToAgent = async (text: string, refetch: Refetch) => {
  const message = text.trim();
  if (!message || state.pending) return;
  const body = { message, history: history(), context: { screen: "home" } };
  set({ messages: [...state.messages, { role: "user", text: message }], pending: true, error: null });
  const at = state.messages.length; // the reply goes right after the question
  let reply: Assistant = { role: "assistant", text: "", steps: [], approvals: [], runId: null, streaming: true };
  const show = () => set({ messages: [...state.messages.slice(0, at), reply] });
  // POST /chat answers in one piece: used when the stream can't start, or fails before any tool ran
  // (after a tool ran, asking again could repeat its write, so the error is shown instead).
  const viaChat = async () => {
    reply = { ...toAssistant(await post<ChatResponse>("/chat", body)), streaming: true };
  };
  try {
    let res: Response | null = null;
    try {
      // public mode refuses the stream (a 403 and a console error before the fallback): go to /chat directly
      if (PUBLIC_READ_ONLY) throw new Error("public mode: no stream");
      res = await fetch(`${API_URL}/chat/stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    } catch {
      res = null;
    }
    if (!res?.ok || !res.body) {
      await viaChat();
    } else if ((res.headers.get("content-type") ?? "").includes("application/json")) {
      reply = { ...toAssistant((await res.json()) as ChatResponse), streaming: true };
    } else {
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      const argsText = new Map<string, string>();
      let buffer = "";
      try {
        for (;;) {
          const { done, value } = await reader.read();
          buffer += decoder.decode(value, { stream: !done });
          const lines = buffer.split("\n");
          buffer = done ? "" : (lines.pop() ?? "");
          for (const line of lines) if (line.trim()) reply = applyStreamLine(reply, line, argsText);
          show();
          if (done) break;
        }
      } catch (e) {
        if (reply.steps.length || reply.text) throw e;
        await viaChat();
      }
    }
    finish();
    set({ pending: false });
  } catch (e) {
    if (reply.steps.length || reply.text) finish(); // an error frame, or the connection dropped after a tool
    set({ pending: false, error: e instanceof Error ? e.message : String(e) });
  }

  /** Close the reply on every path: no card left spinning, streaming off, and the screens refetched for the
   *  writes that did finish (a task written before an error must still show up). */
  function finish() {
    reply = {
      ...reply,
      text: reply.approvals.length && !reply.text.trim() ? waitingLine(reply.approvals) : reply.text,
      steps: reply.steps.map((s) => (s.status === "running" ? { ...s, status: "error", summary: "no result" } : s)),
      streaming: undefined,
    };
    show();
    const scopes = scopesOf(reply.steps);
    if (scopes.length) refetch(scopes);
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

/** Undo one of the pairs the agent merged by itself (POST /undo/{token} splits them again). */
export const undoMergedPair = async (msgIndex: number, stepIndex: number, pairIndex: number, refetch: Refetch) => {
  const m = state.messages[msgIndex];
  const step = m?.role === "assistant" ? m.steps[stepIndex] : undefined;
  const card = step?.card;
  if (!step || card?.kind !== "merged_pairs") return;
  const pairs = (card as { pairs: MergedPair[] }).pairs;
  const pair = pairs[pairIndex];
  if (!pair?.undo_token || pair.undone) return;
  try {
    await post(`/undo/${encodeURIComponent(pair.undo_token)}`, undefined);
    const next = pairs.map((p, k) => (k === pairIndex ? { ...p, undone: true } : p));
    patchStep(msgIndex, stepIndex, { card: { kind: "merged_pairs", pairs: next } });
    refetch(scopesForTool("merge_duplicate"));
  } catch (e) {
    set({ error: `Couldn’t undo the merge: ${e instanceof Error ? e.message : String(e)}` });
  }
};

/** A person decided the paused calls of one reply (call_id → approve). Unlisted calls are declined. */
/**
 * The service's stand-in reply while a run waits on cards (service/chat_agent.py: "Waiting for you: …").
 * Once the person decides, the cards say Approved/Declined, so the stale line is dropped.
 */
export const WAITING_PREFIX = "Waiting for you: ";

/** What a decided card's "waiting for your approval" step says until the run's own result arrives. */
export const decidedLabel = (tool: string, approve: boolean) =>
  ({
    merge_duplicate: approve ? "merging" : "kept separate",
    send: approve ? "sending" : "not sent",
    call_person: approve ? "calling" : "not called",
    delete_event: approve ? "deleting" : "kept (not deleted)",
    delete_calendar_item: approve ? "deleting" : "kept (not deleted)",
  })[tool] ?? (approve ? "approved" : "declined");

/** True once every card in this message has an answer (or the run was already handled). */
export const allDecided = (m: AssistantMessage) =>
  Boolean(m.handled) || m.approvals.every((a) => m.decisions?.[a.call_id] !== undefined);

/**
 * Decide some of a message's cards (usually the one clicked). Only those go to /chat/approve; the service
 * keeps the others pending and pauses on them again under a new run_id (same call_ids), so the cards left
 * stay where they are, now pointing at that run. Approving one card never declines another.
 */
export const decide = async (msgIndex: number, decisions: Record<string, boolean>, refetch: Refetch) => {
  const m = state.messages[msgIndex];
  if (m?.role !== "assistant" || !m.runId || m.handled || state.pending) return;
  const fresh = Object.fromEntries(
    Object.entries(decisions).filter(
      ([id]) => m.approvals.some((a) => a.call_id === id) && m.decisions?.[id] === undefined,
    ),
  );
  if (!Object.keys(fresh).length) return;
  const answered = (x: typeof m): typeof m => {
    const next = { ...x, decisions: { ...x.decisions, ...fresh } };
    const done = allDecided(next);
    const open = next.approvals.filter((a) => next.decisions?.[a.call_id] === undefined);
    const steps = next.steps.map((st) =>
      st.call_id && st.call_id in fresh ? { ...st, status: "done" as const, summary: decidedLabel(st.tool, fresh[st.call_id]) } : st,
    );
    const text = !x.text.startsWith(WAITING_PREFIX) ? x.text : done || !open.length ? "" : waitingLine(open);
    return { ...next, steps, decided: done, text };
  };
  set({
    messages: state.messages.map((x, i) => (i === msgIndex ? answered(m) : x)),
    pending: true,
    error: null,
  });
  try {
    const r = await post<ChatResponse>("/chat/approve", {
      run_id: m.runId,
      approved_by: APPROVER_NAME,
      approvals: Object.entries(fresh).map(([call_id, approve]) => ({ call_id, approve })),
    });
    const again = new Set((r.approvals ?? []).map((a) => a.call_id));
    const onScreen = new Set<string>();
    // A decided card's result fills in its own placeholder step (by call_id) instead of a second row below.
    const results = new Map(
      (r.steps ?? []).filter((st) => st.call_id && st.status !== "awaiting_approval").map((st) => [st.call_id as string, st]),
    );
    const placed = new Set<string>();
    const filled = state.messages.map((x) => {
      if (x.role !== "assistant" || !x.steps.some((st) => st.call_id && results.has(st.call_id))) return x;
      return {
        ...x,
        steps: x.steps.map((st) => {
          const res = st.call_id ? results.get(st.call_id) : undefined;
          if (!res) return st;
          placed.add(st.call_id as string);
          return { ...st, summary: res.summary, status: res.status, undo_token: res.undo_token, card: res.card };
        }),
      };
    });
    // Cards still waiting anywhere in the thread follow the run to its new id.
    const messages = filled.map((x) => {
      if (x.role !== "assistant" || allDecided(x)) return x;
      const waiting = x.approvals.filter((a) => x.decisions?.[a.call_id] === undefined && again.has(a.call_id));
      waiting.forEach((a) => onScreen.add(a.call_id));
      return waiting.length ? { ...x, runId: r.run_id } : x;
    });
    const reply = toAssistant(r);
    // A card already on screen isn't shown twice (nor its "waiting for your approval" step); the reply keeps
    // only what's new.
    const extra = {
      ...reply,
      approvals: reply.approvals.filter((a) => !onScreen.has(a.call_id)),
      steps: reply.steps.filter(
        (st) =>
          !(st.call_id && placed.has(st.call_id)) &&
          !(st.status === "awaiting_approval" && st.call_id && onScreen.has(st.call_id)),
      ),
    };
    if (!extra.approvals.length && extra.text.startsWith(WAITING_PREFIX)) extra.text = "";
    const show = extra.text || extra.steps.length || extra.approvals.length;
    set({ messages: show ? [...messages, extra] : messages, pending: false });
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
