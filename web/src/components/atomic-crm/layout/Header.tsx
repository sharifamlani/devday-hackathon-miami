import { useTranslate } from "ra-core";
import { Link, matchPath, useLocation } from "react-router";
import { RefreshButton } from "@/components/admin/refresh-button";
import { ThemeModeToggle } from "@/components/admin/theme-mode-toggle";
import { UserMenu } from "@/components/admin/user-menu";

import { useConfigurationContext } from "../root/ConfigurationContext";
import { API_URL, DATA_MODE } from "../providers/local/config";
import { GlobalSearchButton } from "../search/GlobalSearchButton";

const Header = () => {
  const { darkModeLogo, lightModeLogo, title } = useConfigurationContext();
  const location = useLocation();
  const translate = useTranslate();

  let currentPath: string | boolean = "/";
  if (matchPath("/", location.pathname)) {
    currentPath = "/";
  } else if (matchPath("/contacts/*", location.pathname)) {
    currentPath = "/contacts";
  } else {
    currentPath = false;
  }

  return (
    <>
      <nav className="grow">
        <header className="bg-secondary">
          <div className="px-4">
            <div className="flex justify-between items-center flex-1">
              <div className="flex items-center gap-3">
                <Link
                  to="/"
                  className="flex items-center gap-2 text-secondary-foreground no-underline"
                >
                  <img
                    className="[.light_&]:hidden h-6"
                    src={darkModeLogo}
                    alt={title}
                  />
                  <img
                    className="[.dark_&]:hidden h-6"
                    src={lightModeLogo}
                    alt={title}
                  />
                  <h1 className="text-xl font-semibold">{title}</h1>
                </Link>
                <span className="text-sm text-secondary-foreground/80">
                  The Miami Foundation
                </span>
                <span
                  className="rounded bg-amber-400 px-2 py-0.5 text-xs font-bold tracking-wide text-amber-950"
                  title="Individual donors are fictional; gift amounts and dates are invented."
                >
                  SAMPLE DATA
                </span>
                <DataModeChip />
              </div>
              <div>
                <nav className="flex">
                  <NavigationTab
                    label={translate("crm.call_today.title", {
                      _: "Call today",
                    })}
                    to="/"
                    isActive={currentPath === "/"}
                  />
                  <NavigationTab
                    label={translate("resources.contacts.name", {
                      smart_count: 2,
                    })}
                    to="/contacts"
                    isActive={currentPath === "/contacts"}
                  />
                </nav>
              </div>
              <div className="flex items-center">
                <GlobalSearchButton />
                <ThemeModeToggle />
                <RefreshButton />
                <UserMenu />
              </div>
            </div>
          </div>
        </header>
      </nav>
    </>
  );
};

const DataModeChip = () =>
  DATA_MODE === "local" ? (
    <span
      className="rounded border border-emerald-600 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:text-emerald-400"
      title={`Live: reading the local API at ${API_URL}`}
    >
      LIVE · local API
    </span>
  ) : (
    <span
      className="rounded border border-secondary-foreground/40 px-2 py-0.5 text-xs font-medium text-secondary-foreground/80"
      title="Static snapshot of the local API. Merges, research and drafts are not saved."
    >
      SNAPSHOT · read-only
    </span>
  );

const NavigationTab = ({
  label,
  to,
  isActive,
}: {
  label: string;
  to: string;
  isActive: boolean;
}) => (
  <Link
    to={to}
    className={`px-6 py-3 text-sm font-medium transition-colors border-b-2 ${
      isActive
        ? "text-secondary-foreground border-secondary-foreground"
        : "text-secondary-foreground/70 border-transparent hover:text-secondary-foreground/80"
    }`}
  >
    {label}
  </Link>
);

export default Header;
