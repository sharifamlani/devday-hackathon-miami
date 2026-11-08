import { createContext, useContext } from "react";

export const OVERVIEW_ID = "home-workspace-overview";
export const OverviewContext = createContext({ open: true, toggle: () => {} });
export const useOverview = () => useContext(OverviewContext);
