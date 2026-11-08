import { useSyncExternalStore } from "react";

import { DOCK_MIN_WIDTH } from "./askSidebarState";

const dockQuery = `(min-width: ${DOCK_MIN_WIDTH}px)`;

const subscribe = (onChange: () => void) => {
  const mql = window.matchMedia(dockQuery);
  mql.addEventListener("change", onChange);
  return () => mql.removeEventListener("change", onChange);
};

/** True at 1280px and wider: the Ask sidebar docks and the page shrinks beside it. */
export const useAskSidebarDocked = () =>
  useSyncExternalStore(
    subscribe,
    () => window.matchMedia(dockQuery).matches,
    () => false,
  );
