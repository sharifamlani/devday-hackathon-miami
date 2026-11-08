import { useMemo, useState, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { OverviewContext } from "./overviewContext";
import { runZoomTransition } from "./zoomTransition";

export const OverviewProvider = ({ children }: { children: ReactNode }) => {
  const [open, setOpen] = useState(true);
  const value = useMemo(
    () => ({
      open,
      // Slides the overview in or out while the chat widens or narrows (zoom.css, "overview").
      toggle: () =>
        runZoomTransition({
          kind: "overview",
          update: () => flushSync(() => setOpen((previous) => !previous)),
        }),
    }),
    [open],
  );
  return (
    <OverviewContext.Provider value={value}>
      {children}
    </OverviewContext.Provider>
  );
};
