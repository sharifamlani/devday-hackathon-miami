import {
  Suspense,
  lazy,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ComponentType,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import {
  AudioLines,
  Loader2,
  Maximize2,
  Minimize2,
  Sparkles,
  X,
} from "lucide-react";

import { cn } from "@/lib/utils";
import {
  VOICE_TRIGGER_ID,
  roundButton,
  voiceButtonAction,
} from "../layout/shellState";
import { useRecording } from "../voice/recordingState";
import { AskPanel } from "./AskPanel";
import { AskSessionContext, useAskSession } from "./askSessionContext";
import { ASK_SIDEBAR_ID, ASK_TRIGGER_ID } from "./askSidebarState";

/**
 * The right pane: opens beside any page, like a browser's side panel. Docked
 * (the page reflows) at 1280px and wider, an overlay with a scrim below that,
 * a full-screen sheet on phones. It can expand in place to take the
 * workspace's place (`paneExpanded`); the /ask route is still the full page.
 *
 * Two modes (`paneMode`): "ask" shows the Ask conversation, "voice" shows the
 * live call transcript (voice/LiveTranscriptPane.tsx, loaded lazily).
 *
 * In Ask mode it is also the one sidebar shell for other assistants. Tabs:
 * "Ask" now, "Chat" when a chat panel exists, so the app never grows two
 * sidebars:
 *   - pass `chatSlot` (any ReactNode), or
 *   - add `web/src/components/atomic-crm/<folder>/ChatPanel.tsx` exporting
 *     `ChatPanel` (named or default, props: ChatPanelProps). It is found at
 *     build time and loaded lazily the first time the Chat tab opens.
 * With neither, there are no tabs and the panel is just Ask.
 */

export interface ChatPanelProps {
  /** Always "sidebar" here; lets one ChatPanel also render elsewhere. */
  variant: "sidebar";
  /** Close the whole sidebar (focus returns to the top-bar button). */
  onClose: () => void;
}

type ChatModule = {
  ChatPanel?: ComponentType<ChatPanelProps>;
  default?: ComponentType<ChatPanelProps>;
};
// {} when no ChatPanel.tsx exists, so the build never depends on it.
const chatModules = import.meta.glob<ChatModule>("../*/ChatPanel.tsx");
const chatLoader = Object.values(chatModules)[0];
const LazyChatPanel = chatLoader
  ? lazy(() =>
      chatLoader().then((m) => {
        const Component = m.ChatPanel ?? m.default;
        if (!Component) throw new Error("ChatPanel.tsx exports no ChatPanel");
        return { default: Component };
      }),
    )
  : null;

export interface LiveTranscriptPaneProps {
  onClose: () => void;
  /** The pane fills the workspace (wider, centered content). */
  expanded: boolean;
}

type TranscriptModule = {
  LiveTranscriptPane?: ComponentType<LiveTranscriptPaneProps>;
  default?: ComponentType<LiveTranscriptPaneProps>;
};
// Same pattern: {} until voice/LiveTranscriptPane.tsx exists.
const transcriptModules = import.meta.glob<TranscriptModule>(
  "../voice/LiveTranscriptPane.tsx",
);
const transcriptLoader = Object.values(transcriptModules)[0];
const LazyTranscriptPane = transcriptLoader
  ? lazy(() =>
      transcriptLoader().then((m) => {
        const Component = m.LiveTranscriptPane ?? m.default;
        if (!Component)
          throw new Error("LiveTranscriptPane.tsx exports no component");
        return { default: Component };
      }),
    )
  : null;

const focusById = (id: string) =>
  // After the panel unmounts, so focus doesn't land on a removed node.
  requestAnimationFrame(() => document.getElementById(id)?.focus());

/* ---------- The top-bar buttons ---------- */

/** Opens and closes the Ask pane. Renders nothing outside an AskSessionProvider. */
export const AskSidebarTrigger = ({ className }: { className?: string }) => {
  const session = useContext(AskSessionContext);
  if (!session) return null;
  const showing = session.sidebarOpen && session.paneMode === "ask";
  return (
    <button
      type="button"
      id={ASK_TRIGGER_ID}
      className={cn(
        roundButton,
        showing &&
          "border-strong bg-strong text-brand hover:bg-strong dark:border-border",
        className,
      )}
      aria-label="Open Ask sidebar"
      aria-expanded={showing}
      aria-controls={ASK_SIDEBAR_ID}
      title={showing ? "Close Ask sidebar" : "Open Ask sidebar"}
      onClick={session.toggleSidebar}
    >
      <Sparkles className="size-[19px]" aria-hidden />
    </button>
  );
};

/**
 * The yellow live-transcript button: opens the pane on the transcript, closes
 * it when the transcript is already showing. A red dot pulses while a call
 * is recording.
 */
export const LiveTranscriptTrigger = ({
  className,
}: {
  className?: string;
}) => {
  const session = useContext(AskSessionContext);
  const recording = useRecording();
  if (!session) return null;
  const showing = session.sidebarOpen && session.paneMode === "voice";
  const onClick = () => {
    if (voiceButtonAction(session.sidebarOpen, session.paneMode) === "close")
      session.closeSidebar();
    else session.openPane("voice");
  };
  return (
    <button
      type="button"
      id={VOICE_TRIGGER_ID}
      onClick={onClick}
      aria-label={recording ? "Live transcript, recording" : "Live transcript"}
      aria-expanded={showing}
      aria-controls={ASK_SIDEBAR_ID}
      title={showing ? "Close live transcript" : "Open live transcript"}
      className={cn(
        "relative grid size-10 shrink-0 place-items-center rounded-full bg-brand text-brand-foreground shadow-[0_2px_10px_rgb(244_217_88/0.45)] transition-[filter] hover:brightness-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
        showing &&
          "ring-2 ring-foreground ring-offset-2 ring-offset-background",
        className,
      )}
    >
      <AudioLines className="size-5" strokeWidth={2.2} aria-hidden />
      {recording && (
        <span
          aria-hidden
          className="absolute top-px right-px size-2.5 rounded-full bg-[#e5534b] ring-2 ring-background motion-safe:animate-pulse"
        />
      )}
    </button>
  );
};

/* ---------- The panel ---------- */

type Tab = "ask" | "chat";

export const AskSidebar = ({
  docked,
  chatSlot,
}: {
  /** In the layout beside the page (true) or over it with a scrim. */
  docked: boolean;
  chatSlot?: ReactNode;
}) => {
  const session = useAskSession();
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const [tab, setTab] = useState<Tab>("ask");
  const hasChat = chatSlot != null || LazyChatPanel != null;
  const { openedByUser, paneMode, paneExpanded, setPaneExpanded } = session;
  const voice = paneMode === "voice";

  // A person opened it: move focus in (a reload that restores it does not).
  useEffect(() => {
    if (!openedByUser) return;
    const panel = panelRef.current;
    const target =
      panel?.querySelector<HTMLElement>("textarea") ??
      panel?.querySelector<HTMLElement>("h2");
    target?.focus();
  }, [openedByUser, paneMode]);

  const close = () => {
    session.closeSidebar();
    focusById(voice ? VOICE_TRIGGER_ID : ASK_TRIGGER_ID);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    // Portaled children (the donor drawer) bubble here in React; let them handle their own Esc.
    if (
      event.key === "Escape" &&
      !event.defaultPrevented &&
      event.currentTarget.contains(event.target as Node)
    ) {
      event.preventDefault();
      close();
    }
  };

  const tabIds = { ask: `${titleId}-tab-ask`, chat: `${titleId}-tab-chat` };
  const onTabKey = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const next: Tab =
      event.key === "Home"
        ? "ask"
        : event.key === "End"
          ? "chat"
          : tab === "ask"
            ? "chat"
            : "ask";
    setTab(next);
    document.getElementById(tabIds[next])?.focus();
  };

  const loading = (label: string) => (
    <p className="flex items-center gap-2 px-4 py-4 text-sm text-muted-foreground">
      <Loader2
        className="size-4 animate-spin motion-reduce:animate-none"
        aria-hidden
      />
      {label}
    </p>
  );

  const askBody =
    tab === "chat" && hasChat ? (
      (chatSlot ?? (
        <Suspense fallback={loading("Loading chat…")}>
          {LazyChatPanel && <LazyChatPanel variant="sidebar" onClose={close} />}
        </Suspense>
      ))
    ) : (
      <AskPanel variant="sidebar" />
    );

  const Icon = voice ? AudioLines : Sparkles;
  const title = voice ? "Live transcript" : "Ask Donor Desk";
  const ExpandIcon = paneExpanded ? Minimize2 : Maximize2;
  const expandLabel = paneExpanded
    ? "Shrink to sidebar"
    : "Expand to full page";

  const panel = (
    <div
      ref={panelRef}
      id={ASK_SIDEBAR_ID}
      role={docked ? "complementary" : "dialog"}
      aria-modal={docked ? undefined : true}
      aria-labelledby={titleId}
      tabIndex={-1}
      onKeyDown={onKeyDown}
      data-expanded={paneExpanded || undefined}
      className={cn(
        "tile flex min-h-0 flex-col overflow-hidden text-foreground outline-none",
        docked
          ? paneExpanded
            ? "relative h-full min-w-0 flex-1"
            : "relative h-full w-[392px] shrink-0"
          : // Over a scrim: opaque. Phones: a full-screen sheet.
            cn(
              "fixed inset-0 z-50 [--tile:var(--card)] max-md:rounded-none max-md:border-0 md:shadow-[0_20px_70px_#24272833]",
              paneExpanded
                ? "md:inset-4"
                : "md:inset-y-4 md:right-4 md:left-auto md:w-[400px]",
            ),
      )}
    >
      <header className="flex items-center gap-1 border-b border-border py-3 pr-3 pl-[18px]">
        <h2
          id={titleId}
          tabIndex={-1}
          className="flex min-w-0 flex-1 items-center gap-2 text-base font-semibold outline-none"
        >
          <Icon className="size-[18px] shrink-0" aria-hidden />
          <span className="truncate">{title}</span>
        </h2>
        <button
          type="button"
          onClick={() => setPaneExpanded(!paneExpanded)}
          aria-label={expandLabel}
          aria-pressed={paneExpanded}
          title={expandLabel}
          // Phones already show it full screen.
          className="hidden size-10 place-items-center rounded-full text-foreground transition-colors hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring md:grid"
        >
          <ExpandIcon className="size-[18px]" aria-hidden />
        </button>
        <button
          type="button"
          onClick={close}
          aria-label={voice ? "Close live transcript" : "Close Ask sidebar"}
          title="Close (Esc)"
          className="grid size-10 place-items-center rounded-full text-foreground transition-colors hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring"
        >
          <X className="size-5" aria-hidden />
        </button>
      </header>

      {voice ? (
        <div className="flex min-h-0 flex-1 flex-col">
          {LazyTranscriptPane ? (
            <Suspense fallback={loading("Loading live transcript…")}>
              <LazyTranscriptPane onClose={close} expanded={paneExpanded} />
            </Suspense>
          ) : (
            <p className="px-[18px] py-4 text-sm text-muted-foreground">
              The live transcript isn't available in this build.
            </p>
          )}
        </div>
      ) : (
        <>
          {hasChat && (
            <div
              role="tablist"
              aria-label="Assistant"
              className="flex gap-1 border-b border-border px-3 py-1.5"
            >
              {(["ask", "chat"] as const).map((key) => (
                <button
                  key={key}
                  id={tabIds[key]}
                  type="button"
                  role="tab"
                  aria-selected={tab === key}
                  aria-controls={`${titleId}-tabpanel`}
                  tabIndex={tab === key ? 0 : -1}
                  onClick={() => setTab(key)}
                  onKeyDown={onTabKey}
                  className={cn(
                    "min-h-10 rounded-full px-4 text-sm transition-colors focus-visible:outline-2 focus-visible:outline-ring",
                    tab === key
                      ? "bg-primary text-primary-foreground"
                      : "text-foreground hover:bg-accent",
                  )}
                >
                  {key === "ask" ? "Ask" : "Chat"}
                </button>
              ))}
            </div>
          )}

          <div
            id={`${titleId}-tabpanel`}
            role={hasChat ? "tabpanel" : undefined}
            aria-labelledby={hasChat ? tabIds[tab] : undefined}
            className={cn(
              "min-h-0 flex-1 overflow-y-auto overscroll-contain pt-4 pb-6",
              paneExpanded
                ? "px-[max(18px,calc((100%_-_740px)/2))] pt-7"
                : "px-4",
            )}
          >
            {askBody}
          </div>
        </>
      )}
    </div>
  );

  if (docked) return panel;
  return (
    <>
      <div
        aria-hidden="true"
        onClick={close}
        data-pane-scrim
        className="fixed inset-0 z-40 bg-foreground/30 duration-(--motion-base) ease-enter animate-in fade-in"
      />
      {panel}
    </>
  );
};
