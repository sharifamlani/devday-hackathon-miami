import { PanelLeft } from "lucide-react";
import { OVERVIEW_ID, useOverview } from "../home/overviewContext";
import { useWorkspaceView } from "../home/workspaceView";
import { UserMenu } from "@/components/admin/user-menu";
import { AskSidebarTrigger, LiveTranscriptTrigger } from "../ask/AskSidebar";
import { RestartOnboardingMenuItem } from "../onboarding/RestartOnboardingMenuItem";
import { MotionMenuItems } from "./MotionMenuItems";
import { PublicLinkMenuItem } from "./PublicLinkMenuItem";
import { avatarSlot } from "./shellState";

export const DashboardControls = () => {
  const overview = useOverview();
  const { view: panel, closeWorkspace } = useWorkspaceView();
  // With a panel open (Calendar, Tasks, CRM, Impact & story), the same button is the way home:
  // it closes the panel and brings the overview back.
  const goHome = () => {
    closeWorkspace();
    if (!overview.open) overview.toggle();
  };
  return (
    <nav aria-label="Workspace controls" className="home-workspace-controls">
      <button
        type="button"
        className="home-overview-toggle"
        onClick={panel ? goHome : overview.toggle}
        aria-label={
          panel
            ? "Back to the overview"
            : overview.open
              ? "Hide workspace overview"
              : "Show workspace overview"
        }
        title={panel ? "Back to the overview" : undefined}
        aria-expanded={panel ? false : overview.open}
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
            <PublicLinkMenuItem />
            <MotionMenuItems />
          </UserMenu>
        </span>
      </div>
    </nav>
  );
};
