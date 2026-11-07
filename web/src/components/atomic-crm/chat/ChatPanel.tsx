/**
 * The right-side chat panel, on every screen. Built on assistant-ui
 * (LocalRuntime + a localStorage history adapter): each past chat is a thread,
 * each agent step a visible tool UI, each pending batch an approval card.
 * Nothing sends without a named approver (plan.md §17).
 */
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { AssistantRuntimeProvider, useLocalRuntime } from "@assistant-ui/react";
import {
  History,
  Inbox,
  MessageSquarePlus,
  PanelRightClose,
  PanelRightOpen,
  Sparkles,
  Trash2,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { useDonors, useSourceLabel } from "../providers/local/hooks";
import { useEvents, useSendBatch } from "../providers/local/crmHooks";
import type { ChatContext } from "../providers/local/crmTypes";
import { useDonorDesk } from "../providers/local";
import { BatchCard, ReceiptCard } from "./BatchCard";
import { makeChatAdapter } from "./chatAdapter";
import { ChatThread, ThreadEnvContext } from "./ChatThread";
import { greetingText, quickActions } from "./greeting";
import {
  allReceipts,
  createThread,
  deleteThread,
  getStore,
  getThread,
  historyAdapterFor,
  listThreads,
  saveReceipt,
  setActiveThread,
  subscribe,
  type ChatScreen,
} from "./threadStore";

export type ChatPanelProps = {
  context: ChatContext;
  /** Person ids selected in the People table. */
  selection: number[];
  /** Set when the calendar's "Review" planned a batch: opens its approval card. */
  openBatchId?: string | null;
  onBatchResolved?: (batchId: string) => void;
  defaultOpen?: boolean;
  className?: string;
};

const OPEN_KEY = "donor-desk.chat.open";
const SCREEN_LABELS: Record<ChatScreen, string> = {
  giver: "Givers",
  neighbor: "Neighbors",
  community: "Community",
  calendar: "Calendar",
  home: "Home",
};

const readOpen = (fallback: boolean) => {
  try {
    const raw = window.localStorage.getItem(OPEN_KEY);
    return raw == null ? fallback : raw === "1";
  } catch {
    return fallback;
  }
};

const shortDate = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

/** One assistant-ui runtime per thread; remounted (by key) when the thread changes. */
const ThreadRuntime = ({
  threadId,
  getContext,
  children,
}: {
  threadId: string;
  getContext: () => ChatContext & { selection?: number[] };
  children: React.ReactNode;
}) => {
  const dataProvider = useDonorDesk();
  const adapter = useMemo(
    () => makeChatAdapter((h, t, c) => dataProvider.chat(h, t, c), getContext),
    [dataProvider, getContext],
  );
  const history = useMemo(() => historyAdapterFor(threadId), [threadId]);
  const runtime = useLocalRuntime(adapter, { adapters: { history } });
  return <AssistantRuntimeProvider runtime={runtime}>{children}</AssistantRuntimeProvider>;
};

const CalendarBatch = ({
  batchId,
  threadId,
  onBatchResolved,
}: {
  batchId: string;
  threadId: string;
  onBatchResolved?: (batchId: string) => void;
}) => {
  const { data: batch, isPending, error } = useSendBatch(batchId);
  const { data: sourceLabel } = useSourceLabel();
  const store = useSyncExternalStore(subscribe, getStore);
  const receipt = store.threads.find((t) => t.id === threadId)?.receipts[batchId];
  if (receipt) return <ReceiptCard receipt={receipt} />;
  if (isPending) return <p className="text-xs text-muted-foreground" role="status">Loading the batch…</p>;
  if (error) return <p role="alert" className="text-xs text-destructive">{error.message}</p>;
  if (!batch) return null;
  return (
    <BatchCard
      batch={batch}
      demo={sourceLabel != null}
      onResolved={(r) => {
        saveReceipt(threadId, r);
        onBatchResolved?.(r.batchId);
      }}
    />
  );
};

export const ChatPanel = ({
  context,
  selection,
  openBatchId = null,
  onBatchResolved,
  defaultOpen = true,
  className,
}: ChatPanelProps) => {
  const [open, setOpen] = useState(() => readOpen(defaultOpen));
  const [view, setView] = useState<"chat" | "history" | "outbox">("chat");
  const store = useSyncExternalStore(subscribe, getStore);
  const { data: sourceLabel } = useSourceLabel();
  const { data: donors } = useDonors();
  const { data: events } = useEvents();

  // The adapter reads the latest screen/selection at send time.
  const contextRef = useRef({ ...context, selection });
  contextRef.current = { ...context, selection };
  const getContext = useMemo(() => () => contextRef.current, []);

  const activeId = getThread(store.activeId)?.id ?? null;
  useEffect(() => {
    if (!activeId) createThread(context.screen);
  }, [activeId, context.screen]);

  useEffect(() => {
    try {
      window.localStorage.setItem(OPEN_KEY, open ? "1" : "0");
    } catch {
      /* not remembered */
    }
  }, [open]);

  // The calendar's "Review" opens the panel on its batch.
  useEffect(() => {
    if (openBatchId) {
      setOpen(true);
      setView("chat");
    }
  }, [openBatchId]);

  const greetingInput = {
    screen: context.screen,
    giveMiamiDayDaysAway: donors?.find((d) => d.give_miami_day_days_away != null)?.give_miami_day_days_away ?? null,
    upcomingEvents: events ? events.filter((e) => e.status !== "past").length : null,
    selectionCount: selection.length,
  };

  if (!open) {
    return (
      <div className={cn("flex h-full flex-col border-l bg-card", className)}>
        <Button
          variant="ghost"
          size="icon"
          className="m-1"
          onClick={() => setOpen(true)}
          aria-label="Open assistant"
          aria-expanded={false}
        >
          <PanelRightOpen className="size-4" />
        </Button>
        <Sparkles className="mx-auto mt-2 size-4 text-primary" aria-hidden />
      </div>
    );
  }

  const threads = listThreads(store);
  const receipts = allReceipts(store);
  const newChat = () => {
    createThread(context.screen);
    setView("chat");
  };

  return (
    <aside
      aria-label="Assistant"
      className={cn("flex h-full w-[380px] max-w-full flex-col border-l bg-card", className)}
      data-testid="chat-panel"
    >
      <header className="flex items-center gap-1 border-b px-2 py-1.5">
        <Sparkles className="size-4 text-primary" aria-hidden />
        <h2 className="text-sm font-semibold">Assistant</h2>
        {sourceLabel && (
          <Badge variant="outline" className="ml-1 text-[10px]">
            {sourceLabel}
          </Badge>
        )}
        <div className="ml-auto flex items-center">
          <Button variant="ghost" size="icon" className="size-7" onClick={newChat} aria-label="New chat">
            <MessageSquarePlus className="size-4" />
          </Button>
          <Button
            variant={view === "history" ? "secondary" : "ghost"}
            size="icon"
            className="size-7"
            onClick={() => setView((v) => (v === "history" ? "chat" : "history"))}
            aria-label="Past chats"
            aria-pressed={view === "history"}
          >
            <History className="size-4" />
          </Button>
          <Button
            variant={view === "outbox" ? "secondary" : "ghost"}
            size="icon"
            className="size-7"
            onClick={() => setView((v) => (v === "outbox" ? "chat" : "outbox"))}
            aria-label="Outbox"
            aria-pressed={view === "outbox"}
          >
            <Inbox className="size-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-7"
            onClick={() => setOpen(false)}
            aria-label="Close assistant"
            aria-expanded
          >
            <PanelRightClose className="size-4" />
          </Button>
        </div>
      </header>

      {view === "history" && (
        <nav aria-label="Past chats" className="flex-1 overflow-y-auto p-2" data-testid="thread-list">
          {threads.length === 0 ? (
            <p className="p-2 text-xs text-muted-foreground">No past chats yet.</p>
          ) : (
            <ul className="space-y-1">
              {threads.map((t) => (
                <li key={t.id} className="group flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => {
                      setActiveThread(t.id);
                      setView("chat");
                    }}
                    className={cn(
                      "min-w-0 flex-1 rounded-md px-2 py-1.5 text-left hover:bg-accent",
                      t.id === activeId && "bg-accent",
                    )}
                    aria-current={t.id === activeId ? "true" : undefined}
                    data-testid="thread-item"
                  >
                    <p className="truncate text-sm">{t.title ?? "New chat"}</p>
                    <p className="text-[11px] text-muted-foreground">
                      {SCREEN_LABELS[t.screen]} · {shortDate(t.updatedAt)}
                    </p>
                  </button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-7 opacity-60 group-hover:opacity-100"
                    onClick={() => deleteThread(t.id)}
                    aria-label={`Delete chat: ${t.title ?? "New chat"}`}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </nav>
      )}

      {view === "outbox" && (
        <section aria-label="Outbox" className="flex-1 space-y-2 overflow-y-auto p-2" data-testid="outbox">
          <p className="text-[11px] text-muted-foreground">Approvals made in this browser.</p>
          {receipts.length === 0 ? (
            <p className="text-xs text-muted-foreground">Nothing approved yet.</p>
          ) : (
            receipts.map((r) => (
              <div key={`${r.batchId}-${r.at}`}>
                <p className="mb-0.5 text-[11px] text-muted-foreground">
                  {r.title ?? "Batch"} · {shortDate(r.at)}
                </p>
                <ReceiptCard receipt={r} />
              </div>
            ))
          )}
        </section>
      )}

      {view === "chat" && activeId && (
        <ThreadEnvContext.Provider
          value={{
            threadId: activeId,
            greeting: greetingText(greetingInput),
            chips: quickActions(greetingInput),
            onBatchResolved,
          }}
        >
          {openBatchId && (
            <div className="border-b p-2" data-testid="calendar-batch">
              <p className="mb-1 text-[11px] font-medium text-muted-foreground">From the calendar</p>
              <CalendarBatch batchId={openBatchId} threadId={activeId} onBatchResolved={onBatchResolved} />
            </div>
          )}
          <ThreadRuntime key={activeId} threadId={activeId} getContext={getContext}>
            <ChatThread />
          </ThreadRuntime>
        </ThreadEnvContext.Provider>
      )}
    </aside>
  );
};

export default ChatPanel;
