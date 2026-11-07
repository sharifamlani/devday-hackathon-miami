import type { ComponentType } from "react";
import { MessageCircle } from "lucide-react";

import type { ChatContext } from "../providers/local/crmTypes";
import { useChatHost } from "./chatHostContext";

/** The contract agreed with 3a (chat panel owner). */
export interface ChatPanelProps {
  context: ChatContext;
  selection: number[];
  openBatchId?: string | null;
  onBatchResolved?: (batchId: string) => void;
}

// 3a's panel lives in ../chat/ChatPanel.tsx. An optional glob, so this builds
// before that file exists and picks it up automatically once it lands.
const modules = import.meta.glob<{ ChatPanel?: ComponentType<ChatPanelProps> }>(
  "../chat/ChatPanel.tsx",
  { eager: true },
);
const ChatPanel = Object.values(modules)[0]?.ChatPanel;

/** The single chat-panel mount point in the desktop layout. */
export const ChatSlot = () => {
  const host = useChatHost();
  if (ChatPanel) {
    return (
      <ChatPanel
        context={host.context}
        selection={host.selection}
        openBatchId={host.openBatchId}
        onBatchResolved={() => host.openBatch(null)}
      />
    );
  }
  // Placeholder until the chat panel lands: says what goes here, does nothing.
  return (
    <aside
      aria-label="Assistant"
      className="hidden w-[52px] shrink-0 flex-col items-center gap-2 rounded-[22px] bg-card py-4 text-muted-foreground xl:flex"
      title="The assistant panel goes here"
    >
      <MessageCircle className="size-5" aria-hidden />
      <span className="text-[10px] [writing-mode:vertical-rl]">Assistant · coming</span>
    </aside>
  );
};
