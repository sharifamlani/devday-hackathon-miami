import type { ReactNode } from "react";
import { ChevronDown } from "lucide-react";

import { cn } from "@/lib/utils";
import { focusRing } from "./tile";

/**
 * The chevron left of an overview tile's title: folds the tile to its title row and back.
 * The title link keeps opening the tile's panel.
 */
export const CollapseToggle = ({
  collapsed,
  onToggle,
  bodyId,
  label,
}: {
  collapsed: boolean;
  onToggle: () => void;
  bodyId: string;
  /** The tile's name, e.g. "Tasks". */
  label: string;
}) => (
  <button
    type="button"
    onClick={onToggle}
    aria-expanded={!collapsed}
    aria-controls={bodyId}
    aria-label={`${collapsed ? "Expand" : "Collapse"} ${label}`}
    title={collapsed ? `Expand ${label}` : `Collapse ${label}`}
    className={cn(
      "tile-collapse-toggle -ml-1 grid size-7 shrink-0 place-items-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground",
      focusRing,
    )}
  >
    <ChevronDown className="size-4" aria-hidden="true" />
  </button>
);

/**
 * Everything under a tile's title. Folding animates its height (grid rows 0fr <-> 1fr) on the
 * shared motion variables; a folded body is inert, so keyboard focus skips it.
 */
export const TileBody = ({
  id,
  collapsed,
  className,
  children,
}: {
  id: string;
  collapsed: boolean;
  className?: string;
  children: ReactNode;
}) => (
  <div id={id} className="tile-body" inert={collapsed}>
    <div className={cn("tile-body-inner", className)}>{children}</div>
  </div>
);
