import { ThemeToggleButton } from "@/components/admin/theme-mode-toggle";
import { useConfigurationContext } from "../root/ConfigurationContext";
import { GlobalSearchButton } from "../search/GlobalSearchButton";

/** Page identity and appearance; workspace actions live in the shared left rail. */
const Header = () => {
  const { title } = useConfigurationContext();
  return (
    <header className="flex h-[46px] shrink-0 items-center gap-2">
      <span className="min-w-0 truncate text-xl font-bold tracking-[-0.02em]">
        {title}
      </span>
      <span className="flex-1" />
      <ThemeToggleButton />
      <span className="hidden">
        <GlobalSearchButton />
      </span>
    </header>
  );
};
export default Header;
