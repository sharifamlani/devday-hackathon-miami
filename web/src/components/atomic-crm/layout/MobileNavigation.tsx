import { cn } from "@/lib/utils";
import { PhoneCall, Send, Users } from "lucide-react";
import { useTranslate } from "ra-core";
import { Link, matchPath, useLocation } from "react-router";

export const MobileNavigation = () => {
  const location = useLocation();
  const translate = useTranslate();
  const onHome = !!matchPath("/", location.pathname);
  const onDonors = !!matchPath("/contacts/*", location.pathname);
  const onCampaigns =
    !!matchPath("/campaigns/*", location.pathname) ||
    !!matchPath("/outbox", location.pathname);

  // iOS standalone PWAs under-report the bottom inset; keep a floor.
  const isPwa = window.matchMedia("(display-mode: standalone)").matches;
  const isWebiOS = /iPad|iPod|iPhone/.test(window.navigator.userAgent);

  return (
    <nav
      aria-label={translate("crm.navigation.label")}
      className="fixed bottom-0 left-0 right-0 z-50 border-t border-border bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-[15px]"
      style={{
        paddingBottom:
          isPwa && isWebiOS
            ? "max(15px, env(safe-area-inset-bottom))"
            : undefined,
      }}
    >
      <div className="flex min-h-[65px] items-center justify-around gap-1 px-5 py-1.5">
        <NavigationButton
          href="/"
          Icon={PhoneCall}
          label={translate("crm.call_today.title", { _: "Call today" })}
          isActive={onHome}
        />
        <NavigationButton
          href="/contacts"
          Icon={Users}
          label={translate("resources.contacts.name", { smart_count: 2 })}
          isActive={onDonors}
        />
        <NavigationButton
          href="/campaigns"
          Icon={Send}
          label={translate("crm.campaigns.title", { _: "Campaigns" })}
          isActive={onCampaigns}
        />
      </div>
    </nav>
  );
};

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
      "flex min-h-[50px] min-w-[56px] flex-1 max-w-[74px] flex-col items-center justify-center gap-1 rounded-[15px] px-1 py-1.5 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
      isActive
        ? "bg-primary text-brand dark:text-primary-foreground"
        : "text-muted-foreground hover:bg-accent hover:text-foreground",
    )}
  >
    <Icon className="size-[18px]" aria-hidden />
    <span className="text-[10px] font-medium leading-none">{label}</span>
  </Link>
);
