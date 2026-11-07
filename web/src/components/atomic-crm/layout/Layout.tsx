import { Suspense, type ReactNode } from "react";
import { ErrorBoundary } from "react-error-boundary";
import { Notification } from "@/components/admin/notification";
import { Error } from "@/components/admin/error";
import { Skeleton } from "@/components/ui/skeleton";

import { DataImportProvider } from "../dataImport/DataImportProvider";
import { useConfigurationLoader } from "../root/useConfigurationLoader";
import { ChatHostProvider } from "../shell/ChatHost";
import { ChatSlot } from "../shell/ChatSlot";
import Header from "./Header";
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
      <ChatHostProvider>
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-full focus:bg-primary focus:px-4 focus:py-2 focus:text-primary-foreground"
      >
        Skip to content
      </a>
      <div className="min-h-screen bg-background p-4 xl:p-7">
        <div className="mx-auto grid min-h-[calc(100vh-2rem)] max-w-[1600px] grid-cols-[60px_minmax(0,1fr)] gap-4 rounded-[34px] bg-surface py-[18px] pr-[22px] pl-2.5 shadow-[0_20px_70px_#3430260a] xl:min-h-[calc(100vh-3.5rem)] xl:grid-cols-[68px_minmax(0,1fr)] xl:gap-7 xl:pt-[22px] xl:pr-[26px] xl:pl-4">
          <Rail />
          <div className="flex min-w-0 gap-4">
            <div className="min-w-0 flex-1">
              <Header />
              <main id="main-content" tabIndex={-1} className="outline-none">
                <ErrorBoundary FallbackComponent={Error}>
                  <Suspense
                    fallback={<Skeleton className="h-12 w-12 rounded-full" />}
                  >
                    {children}
                  </Suspense>
                </ErrorBoundary>
              </main>
            </div>
            {/* The assistant (chat/ChatPanel, owned by 3a); a stub until it lands. */}
            <ChatSlot />
          </div>
        </div>
      </div>
      <Notification />
      </ChatHostProvider>
    </DataImportProvider>
  );
};
