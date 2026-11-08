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
  /** afterClose runs right after the pane has left the page (e.g. to return focus). */
  closeSidebar: (afterClose?: () => void) => void;
  toggleSidebar: () => void;
  /** True once a person opened the panel in this page view; drives focus-on-open. */
  openedByUser: boolean;

  /**
   * What the right pane shows while it is open: the Ask conversation or the
   * live call transcript (voice/LiveTranscriptPane). `sidebarOpen` is still
   * "the right pane is open"; the Ask triggers open it in "ask" mode.
   */
  paneMode: PaneMode;
  /** Open the right pane in a mode (switches mode if it is already open). */
  openPane: (mode: PaneMode) => void;
  /** The pane fills the workspace instead of sitting beside it. */
  paneExpanded: boolean;
  setPaneExpanded: (expanded: boolean) => void;
}

export type PaneMode = "ask" | "voice";

export const AskSessionContext = createContext<AskSession | null>(null);

export const useAskSession = () => {
  const session = useContext(AskSessionContext);
  if (!session)
    throw new Error("useAskSession must be used inside <AskSessionProvider>");
  return session;
};
