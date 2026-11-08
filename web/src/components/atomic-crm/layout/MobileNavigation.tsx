import { cn } from "@/lib/utils";
import {
  FolderOpen,
  House,
  PhoneCall,
  Send,
  Sparkles,
  Users,
} from "lucide-react";
import { useTranslate } from "ra-core";
import { Link, matchPath, useLocation } from "react-router";

import {
  SIDEBAR_ID,
  SIDEBAR_TOGGLE_ID,
  useProjectsSidebar,
} from "./projectsSidebarContext";

export const MobileNavigation = () => {
  const location = useLocation();
  const translate = useTranslate();
  const onHome = !!matchPath("/", location.pathname);
  const onInbox = !!matchPath("/inbox", location.pathname);
  const sidebar = useProjectsSidebar();
  const onDonors =
    !!matchPath("/contacts/*", location.pathname) ||
    !!matchPath("/companies/*", location.pathname);
  const onCampaigns =
    !!matchPath("/campaigns/*", location.pathname) ||
    !!matchPath("/outbox", location.pathname);

  // iOS standalone PWAs under-report the bottom inset; keep a floor.
  const isPwa = window.matchMedia("(display-mode: standalone)").matches;
  const isWebiOS = /iPad|iPod|iPhone/.test(window.navigator.userAgent);

  return (
    <nav
      aria-label={translate("crm.navigation.label")}
      className="fixed right-0 bottom-0 left-0 z-50 px-4 pb-[max(8px,env(safe-area-inset-bottom))]"
      style={{
        paddingBottom:
          isPwa && isWebiOS
            ? "max(15px, env(safe-area-inset-bottom))"
            : undefined,
      }}
    >
      <div className="tile flex min-h-[65px] items-center justify-around gap-1 rounded-[26px] px-1.5 py-1.5 shadow-[0_8px_30px_#2427281a] backdrop-blur-[15px] [--tile:color-mix(in_srgb,var(--card)_94%,transparent)]">
        <NavigationButton
          href="/"
          Icon={House}
          label="Home"
          isActive={onHome}
        />
        <NavigationButton
          href="/inbox"
          Icon={PhoneCall}
          label="Inbox"
          isActive={onInbox}
        />
        <NavigationButton
          href="/contacts"
          Icon={Users}
          label={translate("resources.contacts.name", { smart_count: 2 })}
          isActive={onDonors}
        />
        <NavigationButton
          href="/ask"
          Icon={Sparkles}
          label="Ask"
          isActive={!!matchPath("/ask", location.pathname)}
        />
        <NavigationButton
          href="/campaigns"
          Icon={Send}
          label={translate("crm.campaigns.title", { _: "Campaigns" })}
          isActive={onCampaigns}
        />
        {sidebar && (
          <button
            id={SIDEBAR_TOGGLE_ID}
            type="button"
            onClick={sidebar.toggle}
            aria-expanded={sidebar.open}
            aria-controls={SIDEBAR_ID}
            className={cn(
              navButton,
              sidebar.open
                ? "bg-strong text-brand"
                : "text-muted-foreground hover:bg-accent hover:text-foreground",
            )}
          >
            <FolderOpen className="size-[18px]" aria-hidden />
            <span className="text-[10px] font-medium leading-none">
              Projects
            </span>
          </button>
        )}
      </div>
    </nav>
  );
};

const navButton =
  "flex min-h-[50px] min-w-[52px] flex-1 max-w-[74px] flex-col items-center justify-center gap-1 rounded-[15px] px-1 py-1.5 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

const NavigationButton = ({
  href,
  Icon,
  label,
  isActive,
}: {
  href: string;
  Icon: React.ComponentType<React.SVGProps<SVGSVGElement>>;
  label: string;
  isActive: boolean;
}) => (
  <Link
    to={href}
    aria-current={isActive ? "page" : undefined}
    className={cn(
      navButton,
      isActive
        ? "bg-strong text-brand"
        : "text-muted-foreground hover:bg-accent hover:text-foreground",
    )}
  >
    <Icon className="size-[18px]" aria-hidden />
    <span className="text-[10px] font-medium leading-none">{label}</span>
  </Link>
);
