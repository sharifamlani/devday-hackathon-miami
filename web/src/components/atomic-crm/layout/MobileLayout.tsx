import { Error } from "@/components/admin/error";
import { Notification } from "@/components/admin/notification";
import { Skeleton } from "@/components/ui/skeleton";
import { Suspense, type ReactNode } from "react";
import { ErrorBoundary } from "react-error-boundary";
import { ScrollRestoration } from "react-router";

import { DataImportProvider } from "../dataImport/DataImportProvider";
import { useConfigurationLoader } from "../root/useConfigurationLoader";
import { MobileNavigation } from "./MobileNavigation";
import { ProjectsSidebar, ProjectsSidebarProvider } from "./ProjectsSidebar";
import { PullToRefresh } from "./PullToRefresh";

export const MobileLayout = ({ children }: { children: ReactNode }) => {
  useConfigurationLoader();
  return (
    <DataImportProvider>
      <ProjectsSidebarProvider forceOverlay>
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
        <ProjectsSidebar />
        <Notification mobileOffset={{ bottom: "88px" }} />
      </ProjectsSidebarProvider>
    </DataImportProvider>
  );
};
