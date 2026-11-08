import { Check, Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { useTheme } from "@/components/admin/use-theme";

/**
 * Toggle button that lets users switch between light, dark, and system UI themes.
 *
 * User's selection is persisted using the store.
 * Automatically included in the default Layout component header.
 *
 * @see {@link https://marmelab.com/shadcn-admin-kit/docs/thememodetoggle ThemeModeToggle documentation}
 */
export function ThemeModeToggle() {
  const { theme, setTheme } = useTheme();

  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            className="hidden sm:inline-flex"
          />
        }
      >
        <Sun className="h-[1.2rem] w-[1.2rem] rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
        <Moon className="absolute h-[1.2rem] w-[1.2rem] rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
        <span className="sr-only">Toggle theme</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => setTheme("light")}>
          Light
          <Check className={cn("ml-auto", theme !== "light" && "hidden")} />
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => setTheme("dark")}>
          Dark
          <Check className={cn("ml-auto", theme !== "dark" && "hidden")} />
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => setTheme("system")}>
          System
          <Check className={cn("ml-auto", theme !== "system" && "hidden")} />
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

const prefersDark = () =>
  typeof window !== "undefined" &&
  !!window.matchMedia?.("(prefers-color-scheme: dark)").matches;

/**
 * One round sun/moon button that flips between light and dark (the Donor Desk
 * top bar). "System" resolves to what the device prefers right now. The icon
 * shows the current theme; the label says what pressing it does.
 */
export function ThemeToggleButton({ className }: { className?: string }) {
  const { theme, setTheme } = useTheme();
  const dark = theme === "dark" || (theme === "system" && prefersDark());
  const label = dark ? "Switch to light mode" : "Switch to dark mode";
  const Icon = dark ? Moon : Sun;
  return (
    <button
      type="button"
      onClick={() => setTheme(dark ? "light" : "dark")}
      aria-label={label}
      title={label}
      className={cn(
        "tile grid size-10 shrink-0 place-items-center rounded-full text-foreground transition-colors hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
        className,
      )}
    >
      <Icon className="size-[19px]" aria-hidden />
    </button>
  );
}
