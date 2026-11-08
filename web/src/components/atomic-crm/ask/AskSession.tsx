import {
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { flushSync } from "react-dom";
import { runZoomTransition } from "../home/zoomTransition";

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

  // Opening, closing and expanding the pane slide it in and out (home/zoom.css, "pane").
  // The change runs inside the transition, a frame after the click; it reads the latest
  // open/mode from refs then, so a second click before the first lands never acts on stale state.
  const openRef = useRef(sidebarOpen);
  const modeRef = useRef(paneMode);
  useLayoutEffect(() => {
    openRef.current = sidebarOpen;
    modeRef.current = paneMode;
  }, [sidebarOpen, paneMode]);

  const commitOpen = useCallback((open: boolean, byUser: boolean) => {
    openRef.current = open;
    setSidebarOpenState(open);
    writeSidebarOpen(open);
    if (byUser) setOpenedByUser(open);
    if (!open) setPaneExpandedState(false);
  }, []);
  const commitMode = useCallback((mode: PaneMode) => {
    modeRef.current = mode;
    setPaneMode(mode);
  }, []);
  // after: runs once the change is on the page (still inside the transition).
  const inPaneTransition = useCallback(
    (change: () => void, after?: () => void, exit = false) => {
      runZoomTransition({
        kind: "pane",
        exit,
        update: () => {
          flushSync(change);
          after?.();
        },
      });
    },
    [],
  );

  const setSidebarOpen = useCallback(
    (open: boolean, byUser: boolean) =>
      inPaneTransition(() => commitOpen(open, byUser), undefined, !open),
    [inPaneTransition, commitOpen],
  );
  const setPaneExpanded = useCallback(
    (expanded: boolean) =>
      inPaneTransition(
        () => setPaneExpandedState(expanded),
        undefined,
        !expanded,
      ),
    [inPaneTransition],
  );

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
      openSidebar: () =>
        inPaneTransition(() => {
          commitMode("ask");
          commitOpen(true, true);
        }),
      closeSidebar: (afterClose) =>
        inPaneTransition(
          () => {
            commitOpen(false, true);
          },
          afterClose,
          true,
        ),
      // The Ask buttons: open in Ask mode, switch to Ask if the pane shows
      // the transcript, close only when Ask is already showing.
      toggleSidebar: () =>
        inPaneTransition(
          () => {
            if (openRef.current && modeRef.current === "ask")
              commitOpen(false, true);
            else {
              commitMode("ask");
              commitOpen(true, true);
            }
          },
          undefined,
          // Timing only: the change itself re-reads the refs when it applies.
          openRef.current && modeRef.current === "ask",
        ),
      openedByUser,
      paneMode,
      openPane: (mode) =>
        inPaneTransition(() => {
          commitMode(mode);
          commitOpen(true, true);
        }),
      paneExpanded,
      setPaneExpanded,
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
      setPaneExpanded,
      inPaneTransition,
      commitOpen,
      commitMode,
    ],
  );

  return (
    <AskSessionContext.Provider value={value}>
      {children}
    </AskSessionContext.Provider>
  );
};
