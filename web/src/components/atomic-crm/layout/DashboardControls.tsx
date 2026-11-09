import { useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router";
import { PanelLeft } from "lucide-react";
import { OVERVIEW_ID, useOverview } from "../home/overviewContext";
import { closeWorkspace, parseWorkspace } from "../home/workspaceView";
import { UserMenu } from "@/components/admin/user-menu";
import { LiveTranscriptTrigger } from "../ask/AskSidebar";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { Megaphone, PhoneCall } from "lucide-react";
import {
  RestartOnboardingDialog,
  RestartOnboardingMenuItem,
} from "../onboarding/RestartOnboardingMenuItem";
import { MotionMenuItems } from "./MotionMenuItems";
import { PublicLinkMenuItem } from "./PublicLinkMenuItem";
import { avatarSlot } from "./shellState";
import { HOME, isHomePath } from "../home/homePath";

export const DashboardControls = () => {
  const overview = useOverview();
  // Read the open panel from the URL only: HomePage owns useWorkspaceView's navigation effects.
  const location = useLocation();
  const navigate = useNavigate();
  const onHome = isHomePath(location.pathname);
  const panel = parseWorkspace(location.search);
  // With a panel open (Calendar, Tasks, CRM, Impact & story), the same button is the way home:
  // it closes the panel, then (once the close has committed) brings a hidden overview back, so
  // the two transitions never interrupt each other.
  const reopenOverview = useRef(false);
  const goHome = () => {
    reopenOverview.current = !overview.open;
    closeWorkspace();
  };
  useEffect(() => {
    if (panel || !reopenOverview.current) return;
    reopenOverview.current = false;
    if (!overview.open) overview.toggle();
  }, [panel, overview]);
  return (
    <nav aria-label="Workspace controls" className="home-workspace-controls">
      <button
        type="button"
        className="home-overview-toggle"
        onClick={
          !onHome ? () => navigate(HOME) : panel ? goHome : overview.toggle
        }
        aria-label={
          !onHome
            ? "Back to Home"
            : panel
              ? "Back to the overview"
              : overview.open
                ? "Hide workspace overview"
                : "Show workspace overview"
        }
        title={
          !onHome ? "Back to Home" : panel ? "Back to the overview" : undefined
        }
        aria-expanded={onHome && !panel ? overview.open : undefined}
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
        <span className={avatarSlot("size-10")}>
          <UserMenu>
            <RestartOnboardingMenuItem />
            {/* Pages the retired icon rail linked to that Home has no tile for. */}
            <DropdownMenuItem
              onClick={() => navigate("/campaigns")}
              className="cursor-pointer"
            >
              <Megaphone aria-hidden="true" />
              Campaigns
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => navigate("/inbox")}
              className="cursor-pointer"
            >
              <PhoneCall aria-hidden="true" />
              Outreach inbox
            </DropdownMenuItem>
            <PublicLinkMenuItem />
            <MotionMenuItems />
          </UserMenu>
          <RestartOnboardingDialog />
        </span>
      </div>
    </nav>
  );
};
