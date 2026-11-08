import { useSearchParams } from "react-router";

import { TABS, type Tab } from "../providers/local/crmTypes";

const isTab = (v: string | null): v is Tab => TABS.includes(v as Tab);

/** The People tab in the URL (?tab=neighbor), so a reload or a link keeps it. Givers by default. */
export const usePeopleTab = (): [Tab, (tab: Tab) => void] => {
  const [params, setParams] = useSearchParams();
  const raw = params.get("tab");
  const tab = isTab(raw) ? raw : "giver";
  const setTab = (next: Tab) =>
    setParams(
      (prev) => {
        const out = new URLSearchParams(prev);
        if (next === "giver") out.delete("tab");
        else out.set("tab", next);
        return out;
      },
      { replace: true },
    );
  return [tab, setTab];
};
