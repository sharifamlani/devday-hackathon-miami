import { createContext, useContext } from "react";

import type { AskAnswer, AskFilter, AskIntent } from "../providers/local/ask";

/**
 * One Ask conversation shared by the /ask page and the Ask sidebar, so a
 * question asked in the sidebar is still there on the full page. Mounted
 * once per layout (Layout, MobileLayout).
 */
export interface AskSession {
  draft: string;
  setDraft: (draft: string) => void;
  /** The answer on screen (may be a chip-edited re-run). */
  answer: AskAnswer | null;
  /** The answer to the question as asked, for "Reset filters". */
  original: AskAnswer | null;
  intent: AskIntent | null;
  setIntent: (intent: AskIntent) => void;
  pending: boolean;
  error: Error | null;
  submit: (question: string) => void;
  refilter: (filter: AskFilter) => void;
  reset: () => void;

  sidebarOpen: boolean;
  openSidebar: () => void;
  closeSidebar: () => void;
  toggleSidebar: () => void;
  /** True once a person opened the panel in this page view; drives focus-on-open. */
  openedByUser: boolean;
}

export const AskSessionContext = createContext<AskSession | null>(null);

export const useAskSession = () => {
  const session = useContext(AskSessionContext);
  if (!session)
    throw new Error("useAskSession must be used inside <AskSessionProvider>");
  return session;
};
