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
import { Loader2, Maximize2, PanelRight, X } from "lucide-react";
import { useNavigate } from "react-router";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { AskPanel } from "./AskPanel";
import { AskSessionContext, useAskSession } from "./askSessionContext";
import {
  ASK_SIDEBAR_ID,
  ASK_TRIGGER_ID,
  fullPageHref,
} from "./askSidebarState";

/**
 * The Ask sidebar: a right-side panel that opens beside any page, like a
 * browser's side panel. Docked (the page reflows) at 1280px and wider; an
 * overlay with a scrim below that; a full-screen sheet below md.
 *
 * It is also the one sidebar shell for other assistants. Tabs: "Ask" now,
 * "Chat" when a chat panel exists, so the app never grows two sidebars:
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

const focusTrigger = () =>
  // After the panel unmounts, so focus doesn't land on a removed node.
  requestAnimationFrame(() => document.getElementById(ASK_TRIGGER_ID)?.focus());

/* ---------- The top-bar button ---------- */

/** Opens and closes the sidebar. Renders nothing outside an AskSessionProvider. */
export const AskSidebarTrigger = ({ className }: { className?: string }) => {
  const session = useContext(AskSessionContext);
  if (!session) return null;
  return (
    <Button
      id={ASK_TRIGGER_ID}
      variant="ghost"
      size="icon"
      className={cn(
        "size-11 rounded-full",
        session.sidebarOpen && "bg-brand-soft text-brand-soft-foreground",
        className,
      )}
      aria-label="Open Ask sidebar"
      aria-expanded={session.sidebarOpen}
      aria-controls={ASK_SIDEBAR_ID}
      title={session.sidebarOpen ? "Close Ask sidebar" : "Open Ask sidebar"}
      onClick={session.toggleSidebar}
    >
      <PanelRight className="size-5" aria-hidden />
    </Button>
  );
};

/* ---------- The panel ---------- */

type Tab = "ask" | "chat";

export const AskSidebar = ({
  docked,
  chatSlot,
}: {
  /** In the layout grid beside the page (true) or over it with a scrim. */
  docked: boolean;
  chatSlot?: ReactNode;
}) => {
  const session = useAskSession();
  const navigate = useNavigate();
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const [tab, setTab] = useState<Tab>("ask");
  const hasChat = chatSlot != null || LazyChatPanel != null;
  const { openedByUser } = session;

  // A person opened it: move focus in (a reload that restores it does not).
  useEffect(() => {
    if (!openedByUser) return;
    const panel = panelRef.current;
    const target =
      panel?.querySelector<HTMLElement>("textarea") ??
      panel?.querySelector<HTMLElement>("h2");
    target?.focus();
  }, [openedByUser]);

  const close = () => {
    session.closeSidebar();
    focusTrigger();
  };

  const openFullPage = () => {
    const href = fullPageHref(session.draft);
    session.closeSidebar();
    navigate(href);
    requestAnimationFrame(() =>
      document.getElementById("main-content")?.focus(),
    );
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

  const body =
    tab === "chat" && hasChat ? (
      (chatSlot ?? (
        <Suspense
          fallback={
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2
                className="size-4 animate-spin motion-reduce:animate-none"
                aria-hidden
              />
              Loading chat…
            </p>
          }
        >
          {LazyChatPanel && <LazyChatPanel variant="sidebar" onClose={close} />}
        </Suspense>
      ))
    ) : (
      <AskPanel variant="sidebar" />
    );

  const panel = (
    <div
      ref={panelRef}
      id={ASK_SIDEBAR_ID}
      role={docked ? "complementary" : "dialog"}
      aria-modal={docked ? undefined : true}
      aria-labelledby={titleId}
      onKeyDown={onKeyDown}
      className={cn(
        "flex flex-col bg-card text-foreground",
        docked
          ? "sticky top-4 h-[calc(100vh-5.5rem)] min-h-0 overflow-hidden rounded-[26px] border border-border xl:top-7"
          : "fixed inset-0 z-50 md:inset-y-3 md:right-3 md:left-auto md:w-[400px] md:rounded-[26px] md:border md:border-border md:shadow-[0_20px_70px_#34302633]",
      )}
    >
      <header className="flex items-center gap-1 border-b border-border px-4 py-2">
        <h2
          id={titleId}
          tabIndex={-1}
          className="min-w-0 flex-1 truncate text-base font-semibold outline-none"
        >
          Ask Donor Desk
        </h2>
        <Button
          variant="ghost"
          size="icon"
          className="size-11 rounded-full"
          onClick={openFullPage}
          aria-label="Open full page"
          title="Open full page"
        >
          <Maximize2 className="size-4" aria-hidden />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="size-11 rounded-full"
          onClick={close}
          aria-label="Close Ask sidebar"
          title="Close (Esc)"
        >
          <X className="size-5" aria-hidden />
        </Button>
      </header>

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
                "min-h-11 rounded-full px-4 text-sm transition-colors",
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
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pt-4 pb-6"
      >
        {body}
      </div>
    </div>
  );

  if (docked) return panel;
  return (
    <>
      <div
        aria-hidden="true"
        onClick={close}
        className="fixed inset-0 z-40 bg-foreground/30 motion-safe:animate-in motion-safe:fade-in"
      />
      {panel}
    </>
  );
};
