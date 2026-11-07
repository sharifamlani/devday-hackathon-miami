import type { ReactNode } from "react";
import { Mail, MessageSquareText, ShieldCheck } from "lucide-react";
import { Link } from "react-router";

import { buttonVariants } from "@/components/ui/button";

import { cn } from "@/lib/utils";
import { DATA_MODE } from "../providers/local/config";
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

/** "No message leaves this laptop": shown wherever something could look like a send. */
export const SimulatedNote = ({ className }: { className?: string }) => (
  <p
    className={cn(
      "flex items-start gap-2 text-xs text-muted-foreground",
      className,
    )}
  >
    <ShieldCheck className="mt-0.5 size-4 shrink-0" aria-hidden />
    <span>
      <strong className="font-semibold text-foreground">
        No message leaves this laptop.
      </strong>{" "}
      Sending writes to a simulated outbox and contact log; there is no email or
      text provider.
      {DATA_MODE === "snapshot" &&
        " In this cached sample, the outbox lives only in this browser tab."}
    </span>
  </p>
);

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
