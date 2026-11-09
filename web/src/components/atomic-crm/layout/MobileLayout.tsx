import { OverviewProvider } from "../home/OverviewProvider";
import { Error } from "@/components/admin/error";
import { Notification } from "@/components/admin/notification";
import { Skeleton } from "@/components/ui/skeleton";
import { Suspense, type ReactNode } from "react";
import { ErrorBoundary } from "react-error-boundary";
import { useLocation, ScrollRestoration } from "react-router";

import { AskSessionProvider } from "../ask/AskSession";
import { useAskSession } from "../ask/askSessionContext";
import { AskSidebar } from "../ask/AskSidebar";
import { DataImportProvider } from "../dataImport/DataImportProvider";
import { useConfigurationLoader } from "../root/useConfigurationLoader";
import { MobileNavigation } from "./MobileNavigation";
import { PullToRefresh } from "./PullToRefresh";
import Header from "./Header";
import { DashboardControls } from "./DashboardControls";
import { OnboardingGate } from "../onboarding/OnboardingGate";
import { DATA_MODE } from "../providers/local/config";
import { SampleDataBadge } from "./SampleDataBadge";
import { isHomePath } from "../home/homePath";

export const MobileLayout = ({ children }: { children: ReactNode }) => {
  useConfigurationLoader();
  return (
    <DataImportProvider>
      <AskSessionProvider>
        <OverviewProvider>
          <MobileShell>{children}</MobileShell>
        </OverviewProvider>
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
  const onHome = isHomePath(useLocation().pathname);
  return (
    <>
      <div inert={sidebarOpen}>
        <div
          className={
            onHome
              ? "home-mobile-shell"
              : "min-h-screen pb-[calc(92px+env(safe-area-inset-bottom))]"
          }
        >
          {onHome && (
            <>
              <DashboardControls />
              <Header />
            </>
          )}
          {!onHome && DATA_MODE === "snapshot" && (
            // Pages without the home header still say they are sample data.
            <div className="px-4 pt-3">
              <SampleDataBadge />
            </div>
          )}
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
        {!onHome && <MobileNavigation />}
      </div>
      {sidebarOpen && <AskSidebar docked={false} />}
      <OnboardingGate />
    </>
  );
};
