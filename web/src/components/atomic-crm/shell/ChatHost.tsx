import { useMemo, useState, type ReactNode } from "react";

import type { ChatContext } from "../providers/local/crmTypes";
import { ChatHost } from "./chatHostContext";

/** Holds the chat panel's context for the whole desktop layout (see chatHostContext.ts). */
export const ChatHostProvider = ({ children }: { children: ReactNode }) => {
  const [context, setContext] = useState<ChatContext>({ screen: "home" });
  const [selection, setSelection] = useState<number[]>([]);
  const [openBatchId, openBatch] = useState<string | null>(null);
  const value = useMemo(
    () => ({ context, setContext, selection, setSelection, openBatchId, openBatch }),
    [context, selection, openBatchId],
  );
  return <ChatHost.Provider value={value}>{children}</ChatHost.Provider>;
};
