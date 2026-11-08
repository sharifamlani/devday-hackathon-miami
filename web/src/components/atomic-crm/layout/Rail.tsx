import {
  CalendarDays,
  HeartHandshake,
  House,
  PhoneCall,
  Send,
  Sparkles,
  Users,
} from "lucide-react";
import { useContext, type ComponentType } from "react";
import { useTranslate } from "ra-core";
import { Link, matchPath, useLocation } from "react-router";

import { cn } from "@/lib/utils";
import { AskSessionContext } from "../ask/askSessionContext";
import { ASK_SIDEBAR_ID } from "../ask/askSidebarState";

type Icon = ComponentType<{ className?: string; "aria-hidden"?: boolean }>;

const itemClass = (active: boolean) =>
  cn(
    "grid size-[42px] place-items-center rounded-full transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
    active
      ? "bg-strong text-brand"
      : "text-muted-foreground hover:bg-accent hover:text-foreground",
  );

/**
 * Kindred's permanent icon rail: the brand mark, then the page buttons in a
 * tile-style pill. Ask opens the Ask pane beside the page (the /ask full page
 * is still reachable from the pane's saved questions and links).
 */
export const Rail = () => {
  const location = useLocation();
  const translate = useTranslate();
  const session = useContext(AskSessionContext);
  const onHome = !!matchPath("/", location.pathname);
  const onInbox = !!matchPath("/inbox", location.pathname);
  const onDonors =
    !!matchPath("/contacts/*", location.pathname) ||
    !!matchPath("/companies/*", location.pathname);
  const onCalendar = !!matchPath("/calendar", location.pathname);
  const onCampaigns =
    !!matchPath("/campaigns/*", location.pathname) ||
    !!matchPath("/outbox", location.pathname);
  const askShowing = !!session?.sidebarOpen && session.paneMode === "ask";

  return (
    <nav
      aria-label="Main"
      className="flex w-[52px] shrink-0 flex-col items-center gap-3"
    >
      <Link
        to="/"
        aria-label="Donor Desk home"
        className="grid size-[46px] place-items-center rounded-full bg-strong text-brand focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        <HeartHandshake className="size-6" aria-hidden />
      </Link>
      <ul className="tile flex flex-col gap-1.5 rounded-[26px] p-1">
        <RailLink to="/" label="Home" icon={House} active={onHome} />
        <RailLink
          to="/inbox"
          label="Outreach inbox"
          icon={PhoneCall}
          active={onInbox}
        />
        <RailLink
          to="/contacts"
          label={translate("resources.contacts.name", { smart_count: 2 })}
          icon={Users}
          active={onDonors}
        />
        <li>
          {session ? (
            <button
              type="button"
              onClick={session.toggleSidebar}
              aria-label="Ask"
              title={askShowing ? "Close Ask" : "Ask"}
              aria-expanded={askShowing}
              aria-controls={ASK_SIDEBAR_ID}
              className={itemClass(
                askShowing || !!matchPath("/ask", location.pathname),
              )}
            >
              <Sparkles className="size-5" aria-hidden />
            </button>
          ) : (
            <Link
              to="/ask"
              aria-label="Ask"
              title="Ask"
              className={itemClass(!!matchPath("/ask", location.pathname))}
            >
              <Sparkles className="size-5" aria-hidden />
            </Link>
          )}
        </li>
        <RailLink
          to="/campaigns"
          label={translate("crm.campaigns.title", { _: "Campaigns" })}
          icon={Send}
          active={onCampaigns}
        />
        {/* Event calendar (feat/calendar-view) */}
        <RailLink
          to="/calendar"
          label="Calendar"
          icon={CalendarDays}
          active={onCalendar}
        />
      </ul>
    </nav>
  );
};

const RailLink = ({
  to,
  label,
  icon: Icon,
  active,
}: {
  to: string;
  label: string;
  icon: Icon;
  active: boolean;
}) => (
  <li>
    <Link
      to={to}
      aria-label={label}
      title={label}
      aria-current={active ? "page" : undefined}
      className={itemClass(active)}
    >
      <Icon className="size-5" aria-hidden />
    </Link>
  </li>
);
