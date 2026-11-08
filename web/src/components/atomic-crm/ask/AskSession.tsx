import { useCallback, useMemo, useState, type ReactNode } from "react";

import type { AskAnswer, AskFilter, AskIntent } from "../providers/local/ask";
import { useAsk } from "../providers/local/hooks";
import {
  AskSessionContext,
  type AskSession,
  type PaneMode,
} from "./askSessionContext";
import { readSidebarOpen, writeSidebarOpen } from "./askSidebarState";

/** Holds the shared Ask session; mounted once per layout (Layout, MobileLayout). */
export const AskSessionProvider = ({ children }: { children: ReactNode }) => {
  const ask = useAsk();
  const [draft, setDraft] = useState("");
  const [original, setOriginal] = useState<AskAnswer | null>(null);
  const [answer, setAnswer] = useState<AskAnswer | null>(null);
  const [intent, setIntentState] = useState<AskIntent | null>(null);
  const [sidebarOpen, setSidebarOpenState] = useState(readSidebarOpen);
  const [openedByUser, setOpenedByUser] = useState(false);
  const [paneMode, setPaneMode] = useState<PaneMode>("ask");
  const [paneExpanded, setPaneExpandedState] = useState(false);
  const { mutateAsync, isPending } = ask;

  const run = useCallback(
    async (
      question: string,
      filter?: AskFilter | null,
      nextIntent?: AskIntent | null,
    ) => {
      try {
        const result = await mutateAsync({
          question,
          filter,
          intent: nextIntent,
        });
        setAnswer(result);
        if (!filter) {
          setOriginal(result);
          setIntentState(result.intent);
        }
      } catch {
        // ask.error is shown by the surface
      }
    },
    [mutateAsync],
  );

  const setSidebarOpen = useCallback((open: boolean, byUser: boolean) => {
    setSidebarOpenState(open);
    writeSidebarOpen(open);
    if (byUser) setOpenedByUser(open);
    if (!open) setPaneExpandedState(false);
  }, []);

  const value = useMemo<AskSession>(
    () => ({
      draft,
      setDraft,
      answer,
      original,
      intent,
      setIntent: setIntentState,
      pending: isPending,
      error: ask.error,
      submit: (question) => {
        const text = question.trim();
        if (!text || isPending) return;
        setDraft(text);
        void run(text);
      },
      refilter: (filter) => {
        if (answer) void run(answer.question, filter, intent);
      },
      reset: () => {
        if (original) setAnswer(original);
      },
      sidebarOpen,
      openSidebar: () => {
        setPaneMode("ask");
        setSidebarOpen(true, true);
      },
      closeSidebar: () => setSidebarOpen(false, true),
      // The Ask buttons: open in Ask mode, switch to Ask if the pane shows
      // the transcript, close only when Ask is already showing.
      toggleSidebar: () => {
        if (sidebarOpen && paneMode === "ask") setSidebarOpen(false, true);
        else {
          setPaneMode("ask");
          setSidebarOpen(true, true);
        }
      },
      openedByUser,
      paneMode,
      openPane: (mode) => {
        setPaneMode(mode);
        setSidebarOpen(true, true);
      },
      paneExpanded,
      setPaneExpanded: setPaneExpandedState,
    }),
    [
      draft,
      answer,
      original,
      intent,
      isPending,
      ask.error,
      run,
      sidebarOpen,
      openedByUser,
      setSidebarOpen,
      paneMode,
      paneExpanded,
    ],
  );

  return (
    <AskSessionContext.Provider value={value}>
      {children}
    </AskSessionContext.Provider>
  );
};
