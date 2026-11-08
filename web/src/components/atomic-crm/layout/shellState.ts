import { cn } from "@/lib/utils";

import type { PaneMode } from "../ask/askSessionContext";

/** The header's live-transcript button; focus returns here when the transcript closes. */
export const VOICE_TRIGGER_ID = "live-transcript-trigger";

/** Round top-bar button look (Kindred): thin border, white fill, 40px. */
export const roundButton =
  "tile relative grid size-10 shrink-0 place-items-center rounded-full text-foreground transition-colors hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

/**
 * The UserMenu avatar at the top-bar size, in the yellow-lime gradient. The
 * menu component is shared (components/admin), so it is sized from here.
 */
export const avatarSlot = (size: "size-10" | "size-9") =>
  cn(
    "flex shrink-0 [&>button]:ml-0 [&>button]:rounded-full [&>button]:p-0 [&_[data-slot=avatar-fallback]]:bg-linear-to-br [&_[data-slot=avatar-fallback]]:from-brand [&_[data-slot=avatar-fallback]]:to-[#cfe08f] [&_[data-slot=avatar-fallback]]:text-[13px] [&_[data-slot=avatar-fallback]]:font-bold [&_[data-slot=avatar-fallback]]:text-[#242728]",
    size === "size-10"
      ? "[&>button]:size-10 [&_[data-slot=avatar]]:size-10"
      : "[&>button]:size-9 [&_[data-slot=avatar]]:size-9",
  );

/**
 * Where the right pane (Ask or Live transcript) sits in the desktop shell.
 *   - wide screens (`dockable`): a column beside the workspace; expanded, it
 *     takes the workspace's place (the workspace stays mounted but hidden).
 *   - narrower: an overlay with a scrim; the page behind it is inert.
 */
export interface ShellState {
  /** The pane is a column in the shell. */
  docked: boolean;
  /** The pane floats over the page. */
  overlay: boolean;
  /** The pane fills the workspace's place, so the workspace is hidden. */
  workspaceHidden: boolean;
}

export const shellState = ({
  open,
  dockable,
  expanded,
}: {
  open: boolean;
  dockable: boolean;
  expanded: boolean;
}): ShellState => ({
  docked: open && dockable,
  overlay: open && !dockable,
  workspaceHidden: open && dockable && expanded,
});

/**
 * The header's live-transcript button: opens the pane in voice mode (or
 * switches it from Ask), and closes it when the transcript is already showing.
 */
export const voiceButtonAction = (
  open: boolean,
  mode: PaneMode,
): "open" | "close" => (open && mode === "voice" ? "close" : "open");
