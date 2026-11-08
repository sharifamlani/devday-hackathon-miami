import { Error } from "@/components/admin/error";
import { Notification } from "@/components/admin/notification";
import { Skeleton } from "@/components/ui/skeleton";
import { Suspense, type ReactNode } from "react";
import { ErrorBoundary } from "react-error-boundary";
import { ScrollRestoration } from "react-router";

import { AskSessionProvider } from "../ask/AskSession";
import { useAskSession } from "../ask/askSessionContext";
import { AskSidebar } from "../ask/AskSidebar";
import { DataImportProvider } from "../dataImport/DataImportProvider";
import { useConfigurationLoader } from "../root/useConfigurationLoader";
import { MobileNavigation } from "./MobileNavigation";
import { ProjectsSidebar, ProjectsSidebarProvider } from "./ProjectsSidebar";
import { PullToRefresh } from "./PullToRefresh";
import { OnboardingGate } from "../onboarding/OnboardingGate";

export const MobileLayout = ({ children }: { children: ReactNode }) => {
  useConfigurationLoader();
  return (
    <DataImportProvider>
      <AskSessionProvider>
        <ProjectsSidebarProvider forceOverlay>
          <MobileShell>{children}</MobileShell>
        </ProjectsSidebarProvider>
      </AskSessionProvider>
      <Notification mobileOffset={{ bottom: "96px" }} />
    </DataImportProvider>
  );
};

/**
 * The right pane (Ask or Live transcript) opens as a full-screen sheet; the
 * page and tab bar behind it are inert. The page sits on the white canvas
 * with the Kindred glows (index.css, body).
 */
const MobileShell = ({ children }: { children: ReactNode }) => {
  const { sidebarOpen } = useAskSession();
  return (
    <>
      <div inert={sidebarOpen}>
        <div className="min-h-screen pb-[calc(92px+env(safe-area-inset-bottom))]">
          <ScrollRestoration />
          <PullToRefresh />
          <ErrorBoundary FallbackComponent={Error}>
            <Suspense
              fallback={<Skeleton className="h-12 w-12 rounded-full" />}
            >
              {children}
            </Suspense>
          </ErrorBoundary>
        </div>
        <MobileNavigation />
        <ProjectsSidebar />
      </div>
      {sidebarOpen && <AskSidebar docked={false} />}
      <OnboardingGate />
    </>
  );
};
