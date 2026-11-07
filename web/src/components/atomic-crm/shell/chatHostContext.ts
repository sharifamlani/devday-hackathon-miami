import { createContext, useContext } from "react";

import type { ChatContext } from "../providers/local/crmTypes";

/**
 * What the chat panel (3a's, web/src/components/atomic-crm/chat/) needs from
 * the page around it: which screen is open, which people are selected, and a
 * batch to open (the Calendar's "Review"). Pages write it; ChatSlot reads it.
 */
export interface ChatHostValue {
  context: ChatContext;
  setContext: (context: ChatContext) => void;
  selection: number[];
  setSelection: (ids: number[]) => void;
  openBatchId: string | null;
  /** Calendar "Review": open this batch's approval card in the chat panel. */
  openBatch: (batchId: string | null) => void;
}

export const ChatHost = createContext<ChatHostValue | null>(null);

/** Pages call this to tell the chat panel where it is. Outside the provider it's a no-op. */
export const useChatHost = (): ChatHostValue =>
  useContext(ChatHost) ?? {
    context: { screen: "home" },
    setContext: () => {},
    selection: [],
    setSelection: () => {},
    openBatchId: null,
    openBatch: () => {},
  };
