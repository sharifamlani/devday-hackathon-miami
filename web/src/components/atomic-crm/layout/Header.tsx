import { useLocation, useNavigate } from "react-router";
import { X } from "lucide-react";
import { useConfigurationContext } from "../root/ConfigurationContext";
import { wordmarkText } from "../root/defaultConfiguration";
import { GlobalSearchButton } from "../search/GlobalSearchButton";
import { SampleDataBadge } from "./SampleDataBadge";
import { HOME, isHomePath } from "../home/homePath";

/**
 * Top bar on every page, as on Home: the wordmark and the Sample data label. The page
 * controls (live transcript, account) are in the left column (DashboardControls).
 */
const Header = () => {
  const { title } = useConfigurationContext();
  const navigate = useNavigate();
  const onHome = isHomePath(useLocation().pathname);

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
      {/* Every full-screen page closes back to Home, like Home's panels do. */}
      {!onHome && (
        <button
          type="button"
          onClick={() => navigate(HOME)}
          aria-label="Close and go to Home"
          title="Close"
          className="grid size-10 place-items-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          <X className="size-5" aria-hidden="true" />
        </button>
      )}
      {/* No search field in the top bar; ⌘K / Ctrl+K still opens search. */}
      <span className="hidden">
        <GlobalSearchButton />
      </span>
    </header>
  );
};

export default Header;
