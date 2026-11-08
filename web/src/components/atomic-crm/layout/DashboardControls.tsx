import { UserMenu } from "@/components/admin/user-menu";
import { AskSidebarTrigger, LiveTranscriptTrigger } from "../ask/AskSidebar";
import { RestartOnboardingMenuItem } from "../onboarding/RestartOnboardingMenuItem";
import { avatarSlot } from "./shellState";

export const DashboardControls = () => (
  <nav aria-label="Workspace controls" className="home-workspace-controls">
    <span data-tour="voice">
      <LiveTranscriptTrigger className="size-10 border-0 bg-transparent shadow-none" />
    </span>
    <span data-tour="ask">
      <AskSidebarTrigger className="size-10 border-0 bg-transparent shadow-none" />
    </span>
    <span className={avatarSlot("size-10")}>
      <UserMenu>
        <RestartOnboardingMenuItem />
      </UserMenu>
    </span>
  </nav>
);
