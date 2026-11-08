import { ThemeToggleButton } from "@/components/admin/theme-mode-toggle";
import { UserMenu } from "@/components/admin/user-menu";

import { AskSidebarTrigger, LiveTranscriptTrigger } from "../ask/AskSidebar";
import { RestartOnboardingMenuItem } from "../onboarding/RestartOnboardingMenuItem";
import { MotionMenuItems } from "./MotionMenuItems";
import { PublicLinkMenuItem } from "./PublicLinkMenuItem";
import { SampleDataBadge } from "./SampleDataBadge";
import { avatarSlot } from "./shellState";

/**
 * Phone top bar: the page's own title or back button on the left, and the
 * same right-side buttons as the desktop top bar (live transcript, theme,
 * Ask, account), a little smaller so they fit at 375px. The snapshot build
 * shows the "Sample data" pill here on every page, as the desktop header does.
 */
const MobileHeader = ({ children }: { children: React.ReactNode }) => {
  return (
    <header className="fixed top-0 right-0 left-0 z-10 flex h-14 w-full items-center justify-between gap-2 bg-background/90 px-4 backdrop-blur-[12px]">
      <div className="flex min-w-0 flex-1 items-center">{children}</div>
      <div className="flex shrink-0 items-center gap-1.5">
        <SampleDataBadge />
        <span data-tour="voice" className="inline-flex">
          <LiveTranscriptTrigger className="size-9" />
        </span>
        <ThemeToggleButton className="size-9" />
        <span data-tour="ask" className="inline-flex">
          <AskSidebarTrigger className="size-9" />
        </span>
        <span className={avatarSlot("size-9")}>
          <UserMenu>
            <RestartOnboardingMenuItem />
            <PublicLinkMenuItem />
            <MotionMenuItems />
          </UserMenu>
        </span>
      </div>
    </header>
  );
};

export default MobileHeader;
