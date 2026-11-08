import { RefreshButton } from "@/components/admin/refresh-button";
import { ThemeModeToggle } from "@/components/admin/theme-mode-toggle";
import { UserMenu } from "@/components/admin/user-menu";

import { useConfigurationContext } from "../root/ConfigurationContext";
import { API_URL, DATA_MODE } from "../providers/local/config";
import { useSourceLabel } from "../providers/local/hooks";
import { GlobalSearchButton } from "../search/GlobalSearchButton";
import { useOrgName } from "./useOrgName";

const Header = () => {
  const { title } = useConfigurationContext();
  const orgName = useOrgName();

  return (
    <header className="flex flex-wrap items-center justify-between gap-4 pt-3 pb-6">
      <div className="flex min-w-0 items-baseline gap-3">
        <span className="text-xl font-semibold tracking-[-0.8px]">{title}</span>
        <span className="hidden text-[13px] text-muted-foreground lg:inline">
          {orgName}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <span
          className="inline-flex items-center gap-1.5 rounded-full bg-brand-soft px-3 py-1.5 text-[11px] font-semibold text-brand-soft-foreground"
          title="Sample data: the organization, donors, gift amounts and dates are invented."
        >
          <span className="size-1.5 rounded-full bg-current" aria-hidden />
          SAMPLE DATA
        </span>
        <DataModeChip />
        <div className="flex items-center">
          <GlobalSearchButton />
          <ThemeModeToggle />
          <RefreshButton />
          <UserMenu />
        </div>
      </div>
    </header>
  );
};

const DataModeChip = () => {
  const { data: sourceLabel } = useSourceLabel();
  return DATA_MODE === "local" ? (
    <span
      className="inline-flex items-center gap-1.5 rounded-full bg-good px-3 py-1.5 text-[11px] font-semibold text-good-foreground"
      title={`Live: reading the local API at ${API_URL}`}
    >
      <span className="size-1.5 rounded-full bg-current" aria-hidden />
      LIVE · local API
    </span>
  ) : (
    <span
      className="inline-flex items-center gap-1.5 rounded-full bg-quiet px-3 py-1.5 text-[11px] font-semibold text-quiet-foreground"
      title="Static snapshot of the local API. Merges, research and drafts are not saved."
    >
      {sourceLabel ?? "Snapshot"} · read-only
    </span>
  );
};

export default Header;
