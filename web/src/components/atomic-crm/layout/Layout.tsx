import { Suspense, type ReactNode } from "react";
import { ErrorBoundary } from "react-error-boundary";
import { Notification } from "@/components/admin/notification";
import { Error } from "@/components/admin/error";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

import { AskSessionProvider } from "../ask/AskSession";
import { AskSidebar } from "../ask/AskSidebar";
import { useAskSession } from "../ask/askSessionContext";
import { useAskSidebarDocked } from "../ask/useAskSidebarDocked";
import { DataImportProvider } from "../dataImport/DataImportProvider";
import { useConfigurationLoader } from "../root/useConfigurationLoader";
import Header from "./Header";
import { ProjectsSidebar, ProjectsSidebarProvider } from "./ProjectsSidebar";
import { Rail } from "./Rail";

/**
 * Desktop shell in the Kindred look: a rounded warm surface on a beige canvas,
 * an icon rail on the left and the workspace (top bar + page) on the right.
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
 * The Ask sidebar (ask/AskSidebar.tsx) docks as a third grid column at
 * 1280px+, so the page shrinks instead of being covered. Narrower, it
 * overlays with a scrim and the page behind it is inert.
 */
const LayoutShell = ({ children }: { children: ReactNode }) => {
  const { sidebarOpen } = useAskSession();
  const docked = useAskSidebarDocked();
  const overlay = sidebarOpen && !docked;
  return (
    <>
      <div inert={overlay}>
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-full focus:bg-primary focus:px-4 focus:py-2 focus:text-primary-foreground"
        >
          Skip to content
        </a>
        <div className="min-h-screen bg-background p-4 xl:p-7">
          <div
            className={cn(
              "mx-auto grid min-h-[calc(100vh-2rem)] max-w-[1600px] grid-cols-[60px_minmax(0,1fr)] gap-4 rounded-[34px] bg-surface py-[18px] pr-[22px] pl-2.5 shadow-[0_20px_70px_#3430260a] xl:min-h-[calc(100vh-3.5rem)] xl:grid-cols-[68px_minmax(0,1fr)] xl:gap-7 xl:pt-[22px] xl:pr-[26px] xl:pl-4",
              sidebarOpen &&
                docked &&
                "max-w-[2000px] xl:grid-cols-[68px_minmax(0,1fr)_400px]",
            )}
          >
            <Rail />
            {/* Projects sidebar (Codex-style, collapsible) beside the workspace. */}
            <div className="flex min-w-0 gap-4 xl:gap-6">
              <ProjectsSidebar />
              <div className="min-w-0 flex-1">
                <Header />
                <main
                  id="main-content"
                  tabIndex={-1}
                  className="outline-none"
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
            </div>
            {sidebarOpen && docked && <AskSidebar docked />}
          </div>
        </div>
      </div>
      {overlay && <AskSidebar docked={false} />}
    </>
  );
};
