import { HeartHandshake, PhoneCall, Send, Users } from "lucide-react";
import type { ComponentType } from "react";
import { useTranslate } from "ra-core";
import { Link, matchPath, useLocation } from "react-router";

import { cn } from "@/lib/utils";

/** Kindred's left icon rail: brand mark, then the page buttons in a white pill. */
export const Rail = () => {
  const location = useLocation();
  const translate = useTranslate();
  const onHome = !!matchPath("/", location.pathname);
  const onDonors = !!matchPath("/contacts/*", location.pathname);
  const onCampaigns =
    !!matchPath("/campaigns/*", location.pathname) ||
    !!matchPath("/outbox", location.pathname);

  return (
    <nav
      aria-label="Main"
      className="flex flex-col items-center gap-6 py-2.5"
    >
      <Link
        to="/"
        aria-label="Donor Desk home"
        className="grid size-[46px] place-items-center rounded-full bg-primary text-brand"
      >
        <HeartHandshake className="size-[27px]" aria-hidden />
      </Link>
      <ul className="flex flex-col gap-2 rounded-[30px] bg-card p-2">
        <RailButton
          to="/"
          label={translate("crm.call_today.title", { _: "Call today" })}
          icon={PhoneCall}
          active={onHome}
        />
        <RailButton
          to="/contacts"
          label={translate("resources.contacts.name", { smart_count: 2 })}
          icon={Users}
          active={onDonors}
        />
        <RailButton
          to="/campaigns"
          label={translate("crm.campaigns.title", { _: "Campaigns" })}
          icon={Send}
          active={onCampaigns}
        />
      </ul>
    </nav>
  );
};

const RailButton = ({
  to,
  label,
  icon: Icon,
  active,
}: {
  to: string;
  label: string;
  icon: ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  active: boolean;
}) => (
  <li>
    <Link
      to={to}
      aria-label={label}
      title={label}
      aria-current={active ? "page" : undefined}
      className={cn(
        "grid size-[45px] place-items-center rounded-full transition-colors",
        active
          ? "bg-primary text-brand dark:text-primary-foreground"
          : "text-muted-foreground hover:bg-accent hover:text-foreground",
      )}
    >
      <Icon className="size-5" aria-hidden />
    </Link>
  </li>
);
