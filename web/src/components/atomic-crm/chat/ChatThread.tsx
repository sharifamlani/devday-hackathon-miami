import { createContext, useContext, useSyncExternalStore } from "react";
import {
  ComposerPrimitive,
  MessagePrimitive,
  ThreadPrimitive,
  useAuiState,
  type ToolCallMessagePartComponent,
} from "@assistant-ui/react";
import { AlertCircle, ArrowUp, Check, Loader2, Sparkles, Wrench } from "lucide-react";

import { Badge } from "@/components/ui/badge";

import { BatchCard, ReceiptCard } from "./BatchCard";
import { metaOf, type StepResult } from "./chatAdapter";
import { getStore, saveReceipt, subscribe, type BatchReceipt } from "./threadStore";

interface ThreadEnv {
  threadId: string;
  greeting: string;
  chips: string[];
  onBatchResolved?: (batchId: string) => void;
}

export const ThreadEnvContext = createContext<ThreadEnv | null>(null);
const useThreadEnv = () => {
  const env = useContext(ThreadEnvContext);
  if (!env) throw new Error("ChatThread must render inside ThreadEnvContext");
  return env;
};

/** One agent step, rendered as an assistant-ui tool UI. */
const StepUI: ToolCallMessagePartComponent = ({ toolName, result }) => {
  const step = result as StepResult | undefined;
  const status = step?.status ?? "running";
  return (
    <div
      className="my-1 flex items-start gap-2 rounded-md border bg-muted/40 px-2 py-1.5 text-xs"
      data-testid="tool-step"
      data-tool={toolName}
    >
      {status === "running" ? (
        <Loader2 className="mt-0.5 size-3.5 shrink-0 animate-spin text-muted-foreground" aria-label="running" />
      ) : status === "error" ? (
        <AlertCircle className="mt-0.5 size-3.5 shrink-0 text-destructive" aria-label="failed" />
      ) : (
        <Check className="mt-0.5 size-3.5 shrink-0 text-emerald-600" aria-label="done" />
      )}
      <div className="min-w-0">
        <p className="font-medium">
          <Wrench className="mr-1 inline size-3 text-muted-foreground" aria-hidden />
          {step?.label ?? toolName}
          <code className="ml-1.5 text-[10px] font-normal text-muted-foreground">{toolName}</code>
        </p>
        {step?.summary && <p className="text-muted-foreground">{step.summary}</p>}
      </div>
    </div>
  );
};

const useReceipts = (threadId: string): Record<string, BatchReceipt> => {
  const store = useSyncExternalStore(subscribe, getStore);
  return store.threads.find((t) => t.id === threadId)?.receipts ?? {};
};

const AssistantMessage = () => {
  const { threadId, onBatchResolved } = useThreadEnv();
  const custom = useAuiState((s) => s.message.metadata?.custom);
  const meta = metaOf(custom);
  const receipts = useReceipts(threadId);
  const receipt = meta.batch ? receipts[meta.batch.id] : undefined;

  return (
    <MessagePrimitive.Root className="space-y-1.5" data-testid="assistant-message">
      {meta.demo && (
        <Badge variant="secondary" className="text-[10px]">
          Demo run (cached sample)
        </Badge>
      )}
      <div className="text-sm leading-relaxed">
        <MessagePrimitive.Parts
          components={{
            Text: ({ text }) => <p className="whitespace-pre-wrap">{text}</p>,
            tools: { Fallback: StepUI },
          }}
        />
      </div>
      {meta.error && (
        <p role="alert" className="flex items-start gap-1.5 rounded-md border border-destructive/40 bg-destructive/5 p-2 text-xs text-destructive">
          <AlertCircle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          {meta.error}
        </p>
      )}
      {meta.batch &&
        (receipt ? (
          <ReceiptCard receipt={receipt} />
        ) : (
          <BatchCard
            batch={meta.batch}
            demo={false} // the message above already carries the demo label
            onResolved={(r) => {
              saveReceipt(threadId, r);
              onBatchResolved?.(r.batchId);
            }}
          />
        ))}
    </MessagePrimitive.Root>
  );
};

const UserMessage = () => (
  <MessagePrimitive.Root className="flex justify-end" data-testid="user-message">
    <div className="max-w-[85%] rounded-2xl rounded-br-sm bg-primary px-3 py-1.5 text-sm text-primary-foreground">
      <MessagePrimitive.Parts components={{ Text: ({ text }) => <p className="whitespace-pre-wrap">{text}</p> }} />
    </div>
  </MessagePrimitive.Root>
);

const Thinking = () => {
  const running = useAuiState((s) => s.thread.isRunning);
  if (!running) return null;
  return (
    <p className="flex items-center gap-1.5 text-xs text-muted-foreground" role="status">
      <Loader2 className="size-3.5 animate-spin" aria-hidden />
      Working on it…
    </p>
  );
};

const Greeting = () => {
  const { greeting, chips } = useThreadEnv();
  return (
    <div className="space-y-3" data-testid="greeting">
      <div className="flex items-start gap-2">
        <Sparkles className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
        <p className="text-sm">{greeting}</p>
      </div>
      <div className="flex flex-wrap gap-1.5" aria-label="Quick actions">
        {chips.map((chip) => (
          <ThreadPrimitive.Suggestion
            key={chip}
            prompt={chip}
            send
            className="rounded-full border bg-background px-2.5 py-1 text-left text-xs hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring"
            data-testid="quick-action"
          >
            {chip}
          </ThreadPrimitive.Suggestion>
        ))}
      </div>
    </div>
  );
};

export const ChatThread = () => (
  <ThreadPrimitive.Root className="flex min-h-0 flex-1 flex-col">
    <ThreadPrimitive.Viewport className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-3 py-3">
      <ThreadPrimitive.Empty>
        <Greeting />
      </ThreadPrimitive.Empty>
      <ThreadPrimitive.Messages components={{ UserMessage, AssistantMessage }} />
      <Thinking />
    </ThreadPrimitive.Viewport>
    <ComposerPrimitive.Root className="m-2 flex items-end gap-1.5 rounded-lg border bg-background p-1.5 focus-within:ring-2 focus-within:ring-ring">
      <ComposerPrimitive.Input
        placeholder="Ask about your people or events…"
        aria-label="Message the assistant"
        rows={1}
        className="max-h-32 min-h-8 flex-1 resize-none bg-transparent px-1.5 py-1 text-sm outline-none"
      />
      <ComposerPrimitive.Send
        aria-label="Send message"
        className="flex size-8 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground disabled:opacity-40"
      >
        <ArrowUp className="size-4" aria-hidden />
      </ComposerPrimitive.Send>
    </ComposerPrimitive.Root>
  </ThreadPrimitive.Root>
);
