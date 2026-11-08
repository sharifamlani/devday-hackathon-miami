import type { ReactNode } from "react";
import { Mail, MessageSquareText } from "lucide-react";
import { Link } from "react-router";

import { buttonVariants } from "@/components/ui/button";

import { cn } from "@/lib/utils";
import type { CampaignChannel } from "../providers/local/campaignTypes";
import { pillButton } from "./campaignFormat";

export const ChannelLabel = ({ channel }: { channel: CampaignChannel }) => {
  const Icon = channel === "email" ? Mail : MessageSquareText;
  return (
    <span className="inline-flex items-center gap-1.5">
      <Icon className="size-4" aria-hidden />
      {channel === "email" ? "Email" : "Text"}
    </span>
  );
};

export const PageShell = ({
  eyebrow,
  title,
  caption,
  actions,
  children,
}: {
  eyebrow: string;
  title: string;
  caption?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}) => (
  <div className="mx-auto w-full max-w-4xl space-y-5 px-4 py-6 sm:px-6">
    <header className="flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0 space-y-1">
        <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
          {eyebrow}
        </p>
        <h1 className="text-2xl font-semibold tracking-tight [overflow-wrap:anywhere]">
          {title}
        </h1>
        {caption && (
          <div className="text-sm text-muted-foreground">{caption}</div>
        )}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </header>
    {children}
  </div>
);

/** A router link that looks like the outline pill button. */
export const LinkPill = ({
  to,
  children,
}: {
  to: string;
  children: ReactNode;
}) => (
  <Link
    to={to}
    className={cn(
      buttonVariants({ variant: "outline" }),
      pillButton,
      "border-border bg-card",
    )}
  >
    {children}
  </Link>
);
