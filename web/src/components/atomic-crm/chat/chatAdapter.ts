/**
 * Connects assistant-ui's LocalRuntime to the Donor Desk chat agent
 * (dataProvider.chat → POST /chat, or the canned snapshot run). Each agent
 * step becomes a tool-call part so it renders as a visible tool UI; the batch,
 * demo flag and any error ride along in message metadata.
 */
import type {
  ChatModelAdapter,
  ChatModelRunResult,
  ThreadAssistantMessagePart,
  ThreadMessage,
} from "@assistant-ui/react";

import type {
  ChatContext,
  ChatMessage,
  CrmMethods,
  SendBatch,
} from "../providers/local/crmTypes";

export interface ChatMeta {
  batch: SendBatch | null;
  demo: boolean;
  error: string | null;
}

export interface StepResult {
  label: string;
  summary: string | null;
  status: "done" | "error" | "running";
}

const textOf = (message: ThreadMessage) =>
  message.content
    .map((part) => (part.type === "text" ? part.text : ""))
    .join("\n")
    .trim();

/** The earlier turns, in the data layer's shape. */
export const toHistory = (messages: readonly ThreadMessage[]): ChatMessage[] =>
  messages
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => ({
      role: m.role as "user" | "assistant",
      text: textOf(m),
      steps: [],
      batch: null,
      demo: false,
    }))
    .filter((m) => m.text.length > 0);

/** The agent's reply as assistant-ui parts: one tool call per step, then the text. */
export const toContent = (reply: ChatMessage): ThreadAssistantMessagePart[] => [
  ...reply.steps.map(
    (step, index): ThreadAssistantMessagePart => ({
      type: "tool-call",
      toolCallId: `step-${index}-${step.tool}`,
      toolName: step.tool,
      args: {},
      argsText: "{}",
      result: { label: step.label, summary: step.summary, status: step.status } satisfies StepResult,
      isError: step.status === "error",
    }),
  ),
  ...(reply.text ? [{ type: "text" as const, text: reply.text }] : []),
];

export const metaOf = (custom: Record<string, unknown> | undefined): ChatMeta => ({
  batch: (custom?.batch as SendBatch | null | undefined) ?? null,
  demo: custom?.demo === true,
  error: typeof custom?.error === "string" ? custom.error : null,
});

export const makeChatAdapter = (
  chat: CrmMethods["chat"],
  getContext: () => ChatContext & { selection?: number[] },
): ChatModelAdapter => ({
  async run({ messages }): Promise<ChatModelRunResult> {
    const last = messages[messages.length - 1];
    const text = last ? textOf(last) : "";
    const history = toHistory(messages.slice(0, -1));
    try {
      const reply = await chat(history, text, getContext() as ChatContext);
      return {
        content: toContent(reply),
        metadata: {
          custom: { batch: reply.batch, demo: reply.demo, error: null } satisfies ChatMeta as unknown as Record<string, unknown>,
        },
      };
    } catch (error) {
      // Shown inline as a styled error, not thrown, so the thread stays usable.
      const message = error instanceof Error ? error.message : String(error);
      return {
        content: [],
        status: { type: "incomplete", reason: "error", error: message },
        metadata: { custom: { batch: null, demo: false, error: message } },
      };
    }
  },
});
