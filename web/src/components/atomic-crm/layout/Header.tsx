import { useConfigurationContext } from "../root/ConfigurationContext";
import { wordmarkText } from "../root/defaultConfiguration";
import { GlobalSearchButton } from "../search/GlobalSearchButton";
import { SampleDataBadge } from "./SampleDataBadge";

/**
 * Top bar on every page, as on Home: the wordmark and the Sample data label. The page
 * controls (live transcript, account) are in the left column (DashboardControls).
 */
const Header = () => {
  const { title } = useConfigurationContext();

  return (
    <header className="flex h-[46px] shrink-0 items-center gap-2">
      <span
        data-testid="wordmark"
        className="wordmark flex min-w-0 items-center"
      >
        <span className="truncate">{wordmarkText(title)}</span>
      </span>
      <SampleDataBadge />
      <span className="flex-1" />
      {/* No search field in the top bar; ⌘K / Ctrl+K still opens search. */}
      <span className="hidden">
        <GlobalSearchButton />
      </span>
    </header>
  );
};

export default Header;
