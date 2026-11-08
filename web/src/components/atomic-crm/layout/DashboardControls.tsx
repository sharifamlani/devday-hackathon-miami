import { PanelLeft } from "lucide-react";
import { OVERVIEW_ID, useOverview } from "../home/overviewContext";
import { UserMenu } from "@/components/admin/user-menu";
import { AskSidebarTrigger, LiveTranscriptTrigger } from "../ask/AskSidebar";
import { RestartOnboardingMenuItem } from "../onboarding/RestartOnboardingMenuItem";
import { MotionMenuItems } from "./MotionMenuItems";
import { avatarSlot } from "./shellState";

export const DashboardControls = () => {
  const overview = useOverview();
  return (
    <nav aria-label="Workspace controls" className="home-workspace-controls">
      <button
        type="button"
        className="home-overview-toggle"
        onClick={overview.toggle}
        aria-label={
          overview.open ? "Hide workspace overview" : "Show workspace overview"
        }
        aria-expanded={overview.open}
        aria-controls={OVERVIEW_ID}
      >
        <PanelLeft
          className="size-[18px]"
          strokeWidth={1.6}
          aria-hidden="true"
        />
      </button>
      <div className="home-utility-buttons">
        <span data-tour="voice">
          <LiveTranscriptTrigger className="size-10 border-0 bg-transparent shadow-none" />
        </span>
        <span data-tour="ask">
          <AskSidebarTrigger className="size-10 border-0 bg-transparent shadow-none" />
        </span>
        <span className={avatarSlot("size-10")}>
          <UserMenu>
            <RestartOnboardingMenuItem />
            <MotionMenuItems />
          </UserMenu>
        </span>
      </div>
    </nav>
  );
};
