import { Suspense, type ReactNode } from "react";
import { ErrorBoundary } from "react-error-boundary";
import { Notification } from "@/components/admin/notification";
import { Error } from "@/components/admin/error";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

import { AskSessionProvider } from "../ask/AskSession";
import { AskSidebar } from "../ask/AskSidebar";
import { ASK_SIDEBAR_ID } from "../ask/askSidebarState";
import { useAskSession } from "../ask/askSessionContext";
import { useAskSidebarDocked } from "../ask/useAskSidebarDocked";
import { DataImportProvider } from "../dataImport/DataImportProvider";
import { OnboardingGate } from "../onboarding/OnboardingGate";
import { useConfigurationLoader } from "../root/useConfigurationLoader";
import Header from "./Header";
import { ProjectsSidebar, ProjectsSidebarProvider } from "./ProjectsSidebar";
import { Rail } from "./Rail";
import { shellState } from "./shellState";

/**
 * Desktop shell in the Kindred look: a white canvas with soft yellow-green
 * glows, 16px around the edge and 12px between columns:
 *   rail | Projects sidebar (collapsible) | workspace (top bar + page) | right pane
 * Phones use MobileLayout instead (see CRM.tsx, useIsMobile).
 */
export const Layout = ({ children }: { children: ReactNode }) => {
  useConfigurationLoader();
  return (
    <DataImportProvider>
      <AskSessionProvider>
        <ProjectsSidebarProvider>
          <LayoutShell>{children}</LayoutShell>
        </ProjectsSidebarProvider>
      </AskSessionProvider>
      <Notification />
    </DataImportProvider>
  );
};

/**
 * The right pane (ask/AskSidebar.tsx) docks as a column at 1280px+, so the
 * page shrinks instead of being covered; expanded, it takes the workspace's
 * place. Narrower, it overlays with a scrim and the page behind it is inert.
 * The shell is one viewport tall; the page scrolls inside <main>.
 */
const LayoutShell = ({ children }: { children: ReactNode }) => {
  const { sidebarOpen, paneExpanded } = useAskSession();
  const dockable = useAskSidebarDocked();
  const shell = shellState({
    open: sidebarOpen,
    dockable,
    expanded: paneExpanded,
  });
  return (
    <>
      <div inert={shell.overlay}>
        <a
          href={shell.workspaceHidden ? `#${ASK_SIDEBAR_ID}` : "#main-content"}
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-full focus:bg-primary focus:px-4 focus:py-2 focus:text-primary-foreground"
        >
          Skip to content
        </a>
        <div className="flex h-dvh gap-3 p-4">
          <Rail />
          <ProjectsSidebar />
          <div
            className={cn(
              "flex min-w-0 flex-1 flex-col gap-3",
              // Kept mounted so the page keeps its state behind the expanded pane.
              shell.workspaceHidden && "hidden",
            )}
          >
            <Header />
            {/* -m-1 p-1: room for focus rings at the scroll edges. relative: so
                absolutely positioned children (sr-only text) scroll and clip
                with the page instead of stretching the document. */}
            <main
              id="main-content"
              tabIndex={-1}
              className="relative -m-1 min-h-0 flex-1 overflow-y-auto p-1 outline-none"
            >
              <ErrorBoundary FallbackComponent={Error}>
                <Suspense
                  fallback={<Skeleton className="h-12 w-12 rounded-full" />}
                >
                  {children}
                </Suspense>
              </ErrorBoundary>
            </main>
          </div>
          {shell.docked && <AskSidebar docked />}
        </div>
      </div>
      {shell.overlay && <AskSidebar docked={false} />}
      <OnboardingGate />
    </>
  );
};
