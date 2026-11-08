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
import { PullToRefresh } from "./PullToRefresh";

export const MobileLayout = ({ children }: { children: ReactNode }) => {
  useConfigurationLoader();
  return (
    <DataImportProvider>
      <AskSessionProvider>
        <MobileShell>{children}</MobileShell>
      </AskSessionProvider>
      <Notification mobileOffset={{ bottom: "88px" }} />
    </DataImportProvider>
  );
};

/** The Ask sidebar opens as a full-screen sheet; the page and tab bar behind it are inert. */
const MobileShell = ({ children }: { children: ReactNode }) => {
  const { sidebarOpen } = useAskSession();
  return (
    <>
      <div inert={sidebarOpen}>
        <div className="min-h-screen bg-surface pb-[calc(78px+env(safe-area-inset-bottom))]">
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
      </div>
      {sidebarOpen && <AskSidebar docked={false} />}
    </>
  );
};
