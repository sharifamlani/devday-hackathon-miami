/**
 * Chat history, kept in this browser's localStorage. One entry per thread:
 * its title, the screen it started on, the assistant-ui message repository,
 * and a receipt for every batch already sent or discarded. A backend store can
 * replace this later behind the same functions.
 */
import type {
  ExportedMessageRepository,
  ExportedMessageRepositoryItem,
  ThreadHistoryAdapter,
  ThreadMessage,
} from "@assistant-ui/react";

import type { ChatContext } from "../providers/local/crmTypes";

export type ChatScreen = ChatContext["screen"];

export interface BatchReceipt {
  batchId: string;
  title: string | null;
  outcome: "sent" | "discarded";
  sent: number;
  skipped: number;
  blocked: { id: number; reason: string }[];
  simulated: boolean;
  approvedBy: string | null;
  at: string; // ISO
}

export interface StoredThread {
  id: string;
  title: string | null; // the first question, trimmed
  screen: ChatScreen;
  createdAt: string;
  updatedAt: string;
  repo: { headId: string | null; messages: { message: unknown; parentId: string | null }[] };
  receipts: Record<string, BatchReceipt>;
}

interface StoreShape {
  version: 1;
  activeId: string | null;
  threads: StoredThread[];
}

export const STORAGE_KEY = "donor-desk.chat.v1";
const TITLE_MAX = 48;

const empty = (): StoreShape => ({ version: 1, activeId: null, threads: [] });

// Storage can throw (private mode, blocked site data): fall back to memory.
let memory: StoreShape | null = null;

const read = (): StoreShape => {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as StoreShape;
      if (parsed?.version === 1 && Array.isArray(parsed.threads)) return parsed;
    }
  } catch {
    /* fall through to memory */
  }
  return memory ?? empty();
};

const listeners = new Set<() => void>();
let cached: StoreShape | null = null;

const write = (next: StoreShape) => {
  memory = next;
  cached = next;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    /* memory copy still serves this tab */
  }
  listeners.forEach((listener) => listener());
};

/** For useSyncExternalStore: a stable snapshot until the next write. */
export const getStore = (): StoreShape => (cached ??= read());
export const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

/** Test hook: forget the cached copy so the next read hits storage. */
export const resetStoreCache = () => {
  cached = null;
  memory = null;
};

const update = (fn: (store: StoreShape) => StoreShape) => write(fn(getStore()));

const patchThread = (id: string, fn: (thread: StoredThread) => StoredThread) =>
  update((store) => ({
    ...store,
    threads: store.threads.map((t) => (t.id === id ? fn(t) : t)),
  }));

const newId = () =>
  `t_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

export const createThread = (screen: ChatScreen): string => {
  const now = new Date().toISOString();
  const thread: StoredThread = {
    id: newId(),
    title: null,
    screen,
    createdAt: now,
    updatedAt: now,
    repo: { headId: null, messages: [] },
    receipts: {},
  };
  update((store) => ({ ...store, activeId: thread.id, threads: [thread, ...store.threads] }));
  return thread.id;
};

export const setActiveThread = (id: string) =>
  update((store) => ({ ...store, activeId: id }));

export const deleteThread = (id: string) =>
  update((store) => ({
    ...store,
    activeId: store.activeId === id ? null : store.activeId,
    threads: store.threads.filter((t) => t.id !== id),
  }));

export const getThread = (id: string | null) =>
  id ? (getStore().threads.find((t) => t.id === id) ?? null) : null;

/** Past chats with at least one message, newest first. */
export const listThreads = (store: StoreShape = getStore()) =>
  store.threads
    .filter((t) => t.repo.messages.length > 0)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

export const saveReceipt = (threadId: string, receipt: BatchReceipt) =>
  patchThread(threadId, (t) => ({
    ...t,
    updatedAt: receipt.at,
    receipts: { ...t.receipts, [receipt.batchId]: receipt },
  }));

/** Every receipt across all chats, newest first: the mini outbox. */
export const allReceipts = (store: StoreShape = getStore()): BatchReceipt[] =>
  store.threads
    .flatMap((t) => Object.values(t.receipts))
    .sort((a, b) => b.at.localeCompare(a.at));

const textOf = (message: ThreadMessage) =>
  message.content
    .map((part) => (part.type === "text" ? part.text : ""))
    .join(" ")
    .trim();

const titleFrom = (text: string) =>
  text.length > TITLE_MAX ? `${text.slice(0, TITLE_MAX - 1).trimEnd()}…` : text;

// JSON turns Dates into strings; assistant-ui expects Date objects back.
const revive = (message: unknown): ThreadMessage => {
  const m = message as ThreadMessage & { createdAt: string | Date };
  return { ...m, createdAt: new Date(m.createdAt) } as ThreadMessage;
};

const upsertMessage = (threadId: string, item: ExportedMessageRepositoryItem) =>
  patchThread(threadId, (t) => {
    const messages = t.repo.messages.filter((m) => (m.message as ThreadMessage).id !== item.message.id);
    messages.push({ message: item.message, parentId: item.parentId });
    const firstUserText =
      t.title ?? (item.message.role === "user" ? titleFrom(textOf(item.message)) || null : null);
    return {
      ...t,
      title: firstUserText,
      updatedAt: new Date().toISOString(),
      repo: { headId: item.message.id, messages },
    };
  });

/** assistant-ui's history adapter for one thread, backed by this store. */
export const historyAdapterFor = (threadId: string): ThreadHistoryAdapter => ({
  scopeId: threadId,
  async load(): Promise<ExportedMessageRepository> {
    const thread = getThread(threadId);
    if (!thread) return { headId: null, messages: [] };
    return {
      headId: thread.repo.headId,
      messages: thread.repo.messages.map((m) => ({
        message: revive(m.message),
        parentId: m.parentId,
      })),
    };
  },
  async append(item) {
    upsertMessage(threadId, item);
  },
  async update(item) {
    upsertMessage(threadId, item);
  },
  async delete(items) {
    const ids = new Set(items.map((i) => i.message.id));
    patchThread(threadId, (t) => ({
      ...t,
      repo: {
        ...t.repo,
        messages: t.repo.messages.filter((m) => !ids.has((m.message as ThreadMessage).id)),
      },
    }));
  },
});
