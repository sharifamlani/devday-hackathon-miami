import { createContext, useContext } from "react";

/**
 * Open/closed state of the Codex-style "Projects" sidebar (the secondary
 * sidebar next to the icon rail). The provider lives in ProjectsSidebar.tsx.
 */
export const SIDEBAR_STORAGE_KEY = "donor-desk:projects-sidebar";
export const SIDEBAR_ID = "projects-sidebar";
export const SIDEBAR_TOGGLE_ID = "projects-sidebar-toggle";
export const OVERLAY_QUERY = "(max-width: 1023px)";

export interface ProjectsSidebarState {
  open: boolean;
  /** true when the sidebar floats over the page (narrow screens, phones). */
  overlay: boolean;
  toggle: () => void;
  close: () => void;
}

export const ProjectsSidebarContext =
  createContext<ProjectsSidebarState | null>(null);

/** null outside a provider, so shared components can render without it. */
export const useProjectsSidebar = () => useContext(ProjectsSidebarContext);
