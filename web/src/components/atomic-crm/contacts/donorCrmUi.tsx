import type { ReactNode } from "react";
import { NavLink } from "react-router";

import { cn } from "@/lib/utils";
import {
  DONOR_TAG_CLASS,
  DONOR_TAG_LABELS,
  type DonorTag,
} from "../providers/local/crmDonors";

/** The tile look until the shell's shared `tile` class lands: card + border. */
export const tileClass = "rounded-2xl border border-border bg-card";

export const DonorTagBadge = ({
  tag,
  className,
}: {
  tag: DonorTag;
  className?: string;
}) => (
  <span
    className={cn(
      "inline-flex shrink-0 items-center whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold",
      DONOR_TAG_CLASS[tag],
      className,
    )}
  >
    {DONOR_TAG_LABELS[tag]}
  </span>
);

export const DonorTagList = ({ tags }: { tags: DonorTag[] }) =>
  tags.length ? (
    <span className="flex flex-wrap gap-1">
      {tags.map((tag) => (
        <DonorTagBadge key={tag} tag={tag} />
      ))}
    </span>
  ) : null;

const initialsOf = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");

export const InitialsAvatar = ({
  name,
  size = "md",
}: {
  name: string;
  size?: "sm" | "md" | "lg";
}) => (
  <span
    aria-hidden
    className={cn(
      "flex shrink-0 items-center justify-center rounded-full bg-olive font-semibold text-foreground",
      size === "sm" && "size-8 text-xs",
      size === "md" && "size-10 text-sm",
      size === "lg" && "size-14 text-lg",
    )}
  >
    {initialsOf(name)}
  </span>
);

/** People | Organizations, shown above both Donors lists. */
export const DonorsTabs = () => (
  <nav
    aria-label="Donors views"
    className="flex gap-1 rounded-full bg-muted p-1"
  >
    {[
      { to: "/contacts", label: "People" },
      { to: "/companies", label: "Organizations" },
    ].map(({ to, label }) => (
      <NavLink
        key={to}
        to={to}
        end={false}
        className={({ isActive }) =>
          cn(
            "rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
            isActive
              ? "bg-card text-foreground shadow-xs"
              : "text-muted-foreground hover:text-foreground",
          )
        }
      >
        {label}
      </NavLink>
    ))}
  </nav>
);

/** A labeled section of the donor profile. */
export const ProfileSection = ({
  title,
  caption,
  actions,
  children,
  className,
  id,
}: {
  title: string;
  caption?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  id?: string;
}) => {
  const headingId = id ?? `section-${title.toLowerCase().replace(/\W+/g, "-")}`;
  return (
    <section
      aria-labelledby={headingId}
      className={cn(tileClass, "space-y-3 p-4 sm:p-5", className)}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 id={headingId} className="text-sm font-semibold">
            {title}
          </h2>
          {caption && (
            <p className="text-xs text-muted-foreground">{caption}</p>
          )}
        </div>
        {actions}
      </div>
      {children}
    </section>
  );
};

/** One labeled value in a small grid (Lifetime $250, Gifts 1, ...). */
export const Stat = ({ label, value }: { label: string; value: ReactNode }) => (
  <div className="rounded-xl bg-muted/60 px-3 py-2">
    <dt className="text-xs text-muted-foreground">{label}</dt>
    <dd className="mt-0.5 font-semibold tabular-nums">{value}</dd>
  </div>
);
