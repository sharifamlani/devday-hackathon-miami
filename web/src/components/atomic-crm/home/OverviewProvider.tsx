import { useEffect, useMemo, useState, type ReactNode } from "react";
import { OverviewContext } from "./overviewContext";

export const OverviewProvider = ({ children }: { children: ReactNode }) => {
  const [open, setOpen] = useState(() => {
    try {
      const saved = localStorage.getItem("donor-desk-sidebar");
      if (saved !== null) return saved === "expanded";
    } catch {
      /* unavailable storage */
    }
    return window.matchMedia("(min-width: 1100px)").matches;
  });
  useEffect(() => {
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape" && open) {
        setOpen(false);
        try {
          localStorage.setItem("donor-desk-sidebar", "collapsed");
        } catch {
          /* optional preference */
        }
      }
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [open]);
  const value = useMemo(
    () => ({
      open,
      toggle: () =>
        setOpen((previous) => {
          const next = !previous;
          try {
            localStorage.setItem(
              "donor-desk-sidebar",
              next ? "expanded" : "collapsed",
            );
          } catch {
            /* preference is optional */
          }
          return next;
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
