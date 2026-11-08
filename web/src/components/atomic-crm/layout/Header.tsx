import { useLocation } from "react-router";
import { ThemeToggleButton } from "@/components/admin/theme-mode-toggle";
import { UserMenu } from "@/components/admin/user-menu";

import { AskSidebarTrigger, LiveTranscriptTrigger } from "../ask/AskSidebar";
import { useConfigurationContext } from "../root/ConfigurationContext";
import { GlobalSearchButton } from "../search/GlobalSearchButton";
import { RestartOnboardingMenuItem } from "../onboarding/RestartOnboardingMenuItem";
import { MotionMenuItems } from "./MotionMenuItems";
import { avatarSlot } from "./shellState";
import { SampleDataBadge } from "./SampleDataBadge";

/**
 * Top bar: wordmark on the left; live transcript, theme,
 * Ask and the account avatar on the right.
 */
const Header = () => {
  const { title, darkModeLogo, lightModeLogo } = useConfigurationContext();
  const onHome = useLocation().pathname === "/";

  return (
    <header className="flex h-[46px] shrink-0 items-center gap-2">
      <span
        data-testid="wordmark"
        className="flex min-w-0 items-center gap-2 text-xl font-bold tracking-[-0.02em]"
      >
        <img className="[.light_&]:hidden h-6 shrink-0" src={darkModeLogo} alt="" />
        <img className="[.dark_&]:hidden h-6 shrink-0" src={lightModeLogo} alt="" />
        <span className="truncate">{title}</span>
      </span>
      <SampleDataBadge />
      <span className="flex-1" />
      {!onHome && (
        <>
          <span data-tour="voice" className="inline-flex">
            <LiveTranscriptTrigger />
          </span>
          <ThemeToggleButton />
          <span data-tour="ask" className="inline-flex">
            <AskSidebarTrigger />
          </span>
          <span className={avatarSlot("size-10")}>
            <UserMenu>
              <RestartOnboardingMenuItem />
              <MotionMenuItems />
            </UserMenu>
          </span>
        </>
      )}
      {/* No search field in the top bar; ⌘K / Ctrl+K still opens search. */}
      <span className="hidden">
        <GlobalSearchButton />
      </span>
    </header>
  );
};

export default Header;
