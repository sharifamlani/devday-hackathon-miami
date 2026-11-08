/**
 * Pure helpers for the Ask sidebar: whether it was open in this tab
 * (sessionStorage, so a reload keeps it but a new tab starts closed) and
 * whether the screen is wide enough to dock it beside the page.
 */
export const SIDEBAR_STORAGE_KEY = "donor-desk.ask-sidebar";

/** DOM ids: the top-bar button's aria-controls, and where focus returns on close. */
export const ASK_SIDEBAR_ID = "ask-sidebar";
export const ASK_TRIGGER_ID = "ask-sidebar-trigger";

/** Docked (page reflows) at and above this width; below it the panel overlays with a scrim. */
export const DOCK_MIN_WIDTH = 1280;

type MaybeStorage = Pick<Storage, "getItem" | "setItem"> | null | undefined;

const sessionStore = (): MaybeStorage => {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null; // storage blocked (privacy mode, sandboxed iframe)
  }
};

export const readSidebarOpen = (storage: MaybeStorage = sessionStore()) => {
  try {
    return storage?.getItem(SIDEBAR_STORAGE_KEY) === "open";
  } catch {
    return false;
  }
};

export const writeSidebarOpen = (
  open: boolean,
  storage: MaybeStorage = sessionStore(),
) => {
  try {
    storage?.setItem(SIDEBAR_STORAGE_KEY, open ? "open" : "closed");
  } catch {
    // Quota or privacy mode: the panel still works, it just won't be remembered.
  }
};

/** The /ask route with the question carried over, for "Open full page". */
export const fullPageHref = (question: string) => {
  const text = question.trim();
  return text ? `/ask?q=${encodeURIComponent(text)}` : "/ask";
};
