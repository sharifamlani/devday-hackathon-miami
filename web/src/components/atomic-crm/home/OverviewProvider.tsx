import { useMemo, useState, type ReactNode } from "react";
import { OverviewContext } from "./overviewContext";

export const OverviewProvider = ({ children }: { children: ReactNode }) => {
  const [open, setOpen] = useState(true);
  const value = useMemo(
    () => ({ open, toggle: () => setOpen((previous) => !previous) }),
    [open],
  );
  return (
    <OverviewContext.Provider value={value}>
      {children}
    </OverviewContext.Provider>
  );
};
