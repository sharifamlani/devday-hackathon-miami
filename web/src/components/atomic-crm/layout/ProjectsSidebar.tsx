import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type ReactNode,
} from "react";
import {
  ChevronRight,
  Folder,
  FolderOpen,
  Heart,
  MessageCircleQuestion,
  Moon,
  PanelLeft,
  Plus,
  Search,
  Send,
  Sparkles,
  X,
} from "lucide-react";
import { Link, useLocation } from "react-router";

import { cn } from "@/lib/utils";
import { EXAMPLE_QUESTIONS } from "../providers/local/ask";
import { useCampaigns, useDonors } from "../providers/local/hooks";
import {
  OVERLAY_QUERY,
  ProjectsSidebarContext,
  SIDEBAR_ID,
  SIDEBAR_STORAGE_KEY,
  SIDEBAR_TOGGLE_ID,
  useProjectsSidebar,
} from "./projectsSidebarContext";

/* ---------- State provider (see projectsSidebarContext.ts) ---------- */

/**
 * Wide screens remember open/closed in localStorage; below 1280px it starts
 * collapsed; below 1024px (and on phones) it is an overlay that starts closed.
 */
const readStored = (): boolean | null => {
  try {
    const value = window.localStorage.getItem(SIDEBAR_STORAGE_KEY);
    return value === "open" ? true : value === "closed" ? false : null;
  } catch {
    return null;
  }
};

const store = (open: boolean) => {
  try {
    window.localStorage.setItem(SIDEBAR_STORAGE_KEY, open ? "open" : "closed");
  } catch {
    // Private mode: the choice lasts for this page only.
  }
};

const initialOpen = (forceOverlay: boolean) => {
  if (typeof window === "undefined" || forceOverlay) return false;
  if (window.matchMedia?.(OVERLAY_QUERY).matches) return false;
  return readStored() ?? window.innerWidth >= 1280;
};

export const ProjectsSidebarProvider = ({
  children,
  forceOverlay = false,
}: {
  children: ReactNode;
  /** Phones (MobileLayout): always an overlay. */
  forceOverlay?: boolean;
}) => {
  const [open, setOpen] = useState(() => initialOpen(forceOverlay));
  const [narrow, setNarrow] = useState(
    () =>
      typeof window !== "undefined" &&
      !!window.matchMedia?.(OVERLAY_QUERY).matches,
  );
  const overlay = forceOverlay || narrow;

  useEffect(() => {
    const query = window.matchMedia?.(OVERLAY_QUERY);
    if (!query) return;
    const onChange = () => {
      setNarrow(query.matches);
      // Going narrow closes the overlay so it never covers the page by surprise.
      if (query.matches) setOpen(false);
    };
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  const toggle = useCallback(() => {
    setOpen((was) => {
      if (!overlay) store(!was);
      return !was;
    });
  }, [overlay]);

  const close = useCallback(() => {
    setOpen(false);
    if (!overlay) store(false);
  }, [overlay]);

  const value = useMemo(
    () => ({ open, overlay, toggle, close }),
    [open, overlay, toggle, close],
  );
  return (
    <ProjectsSidebarContext.Provider value={value}>
      {children}
    </ProjectsSidebarContext.Provider>
  );
};

/* ---------- Toggle button (top bar, left) ---------- */

export const ProjectsSidebarToggle = ({
  className,
}: {
  className?: string;
}) => {
  const sidebar = useProjectsSidebar();
  if (!sidebar) return null;
  return (
    <button
      id={SIDEBAR_TOGGLE_ID}
      type="button"
      onClick={sidebar.toggle}
      aria-expanded={sidebar.open}
      aria-controls={SIDEBAR_ID}
      aria-label="Projects sidebar"
      title={sidebar.open ? "Hide projects" : "Show projects"}
      className={cn(
        "grid size-11 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
        sidebar.open && "bg-card text-foreground",
        className,
      )}
    >
      <PanelLeft className="size-5" aria-hidden="true" />
    </button>
  );
};

/* ---------- The sidebar ---------- */

interface ProjectItem {
  key: string;
  label: string;
  to: string;
  icon: ComponentType<{ className?: string }>;
  count?: number;
}

interface ProjectGroup {
  id: string;
  label: string;
  items: ProjectItem[];
  empty: string;
  action?: { label: string; to: string };
}

/** Is this item the screen we're on? Compares path and query. */
const isCurrent = (to: string, pathname: string, search: string) => {
  const [path, query = ""] = to.split("?");
  if (path !== pathname) return false;
  const want = new URLSearchParams(query);
  const have = new URLSearchParams(search);
  return [...want.entries()].every(([k, v]) => have.get(k) === v);
};

const useGroups = (): ProjectGroup[] => {
  const campaigns = useCampaigns();
  const donors = useDonors();
  const list = donors.data ?? [];
  const count = (test: (d: (typeof list)[number]) => boolean) =>
    donors.data ? list.filter(test).length : undefined;
  return [
    {
      id: "campaigns",
      label: "Campaigns",
      empty: campaigns.isPending ? "Loading campaigns…" : "No campaigns yet",
      action: { label: "New campaign", to: "/campaigns/new" },
      items: (campaigns.data ?? []).map((c) => ({
        key: `campaign-${c.id}`,
        label: c.name,
        to: `/campaigns/${c.id}`,
        icon: Send,
        count: c.counts.draft || undefined,
      })),
    },
    {
      id: "ask",
      label: "Saved Ask questions",
      empty: "No saved questions",
      items: EXAMPLE_QUESTIONS.map((question, i) => ({
        key: `ask-${i}`,
        label: question,
        to: `/ask?${new URLSearchParams({ q: question }).toString()}`,
        icon: MessageCircleQuestion,
      })),
    },
    {
      id: "lists",
      label: "Donor lists",
      empty: "No lists",
      items: [
        {
          key: "attention",
          label: "Needs attention",
          to: "/inbox?view=attention",
          icon: Heart,
          count: count((d) => d.status === "lapsing" || d.status === "lapsed"),
        },
        {
          key: "stars",
          label: "Star donors",
          to: "/inbox?view=stars",
          icon: Sparkles,
          count: count((d) => d.is_star),
        },
        {
          key: "lapsed",
          label: "Lapsed",
          to: "/inbox?view=lapsed",
          icon: Moon,
          count: count((d) => d.status === "lapsed"),
        },
      ],
    },
  ];
};

/**
 * Codex-style secondary sidebar: "Projects" folders (campaigns, saved Ask
 * questions, donor lists) that open the right screen, with a filter box on
 * top. Inline next to the rail on wide screens, an overlay on narrow ones.
 */
export const ProjectsSidebar = () => {
  const sidebar = useProjectsSidebar();
  const groups = useGroups();
  const location = useLocation();
  const searchId = useId();
  const searchRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [collapsed, setCollapsed] = useState<string[]>([]);
  const open = !!sidebar?.open;
  const overlay = !!sidebar?.overlay;
  const close = sidebar?.close;

  // Overlay: focus the filter on open, Escape closes, focus returns to the toggle.
  useEffect(() => {
    if (!open || !overlay) return;
    searchRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        close?.();
        document.getElementById(SIDEBAR_TOGGLE_ID)?.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, overlay, close]);

  if (!sidebar || !open) return null;

  const needle = query.trim().toLocaleLowerCase();
  const filtered = groups.map((group) => ({
    ...group,
    items: needle
      ? group.items.filter((item) =>
          item.label.toLocaleLowerCase().includes(needle),
        )
      : group.items,
  }));
  const matches = filtered.reduce((sum, g) => sum + g.items.length, 0);
  const onNavigate = () => {
    if (overlay) sidebar.close();
  };

  const panel = (
    <nav
      id={SIDEBAR_ID}
      aria-label="Projects"
      className={cn(
        "flex w-[264px] shrink-0 flex-col gap-4 overflow-y-auto rounded-[24px] bg-card p-3 shadow-sm",
        overlay
          ? "fixed inset-y-3 left-3 z-50 max-w-[calc(100vw-24px)] shadow-[0_20px_70px_#24272833]"
          : "sticky top-4 max-h-[calc(100vh-4rem)] self-start",
      )}
    >
      <div className="flex items-center justify-between gap-2 px-1 pt-1">
        <p className="text-sm font-semibold">Projects</p>
        {overlay && (
          <button
            type="button"
            onClick={() => {
              sidebar.close();
              document.getElementById(SIDEBAR_TOGGLE_ID)?.focus();
            }}
            aria-label="Close projects"
            className="grid size-11 place-items-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        )}
      </div>
      <div className="relative">
        <Search
          className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden="true"
        />
        <label htmlFor={searchId} className="sr-only">
          Filter projects
        </label>
        <input
          ref={searchRef}
          id={searchId}
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search"
          className="min-h-11 w-full rounded-full border border-border bg-surface pr-3 pl-9 text-sm placeholder:text-muted-foreground focus-visible:outline-2 focus-visible:outline-ring"
        />
      </div>
      <p role="status" aria-live="polite" className="sr-only">
        {needle ? `${matches} ${matches === 1 ? "match" : "matches"}` : ""}
      </p>
      {needle && matches === 0 ? (
        <p className="px-2 text-sm text-muted-foreground">
          Nothing matches “{query.trim()}”.
        </p>
      ) : null}
      {filtered.map((group) =>
        needle && group.items.length === 0 ? null : (
          <Group
            key={group.id}
            group={group}
            // Searching opens every group with a match.
            expanded={!!needle || !collapsed.includes(group.id)}
            onToggle={() =>
              setCollapsed((was) =>
                was.includes(group.id)
                  ? was.filter((id) => id !== group.id)
                  : [...was, group.id],
              )
            }
            pathname={location.pathname}
            search={location.search}
            onNavigate={onNavigate}
          />
        ),
      )}
    </nav>
  );

  if (!overlay) return panel;
  return (
    <>
      <div
        aria-hidden="true"
        onClick={sidebar.close}
        className="fixed inset-0 z-40 bg-primary/20 backdrop-blur-[2px]"
      />
      {panel}
    </>
  );
};

const Group = ({
  group,
  expanded,
  onToggle,
  pathname,
  search,
  onNavigate,
}: {
  group: ProjectGroup;
  expanded: boolean;
  onToggle: () => void;
  pathname: string;
  search: string;
  onNavigate: () => void;
}) => {
  const listId = useId();
  const FolderIcon = expanded ? FolderOpen : Folder;
  return (
    <section className="flex flex-col gap-0.5">
      <h2>
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={expanded}
          aria-controls={listId}
          className="flex min-h-11 w-full items-center gap-2 rounded-full px-2 text-left text-[13px] font-semibold text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
        >
          <ChevronRight
            className={cn(
              "size-4 transition-transform",
              expanded && "rotate-90",
            )}
            aria-hidden="true"
          />
          <FolderIcon className="size-4" aria-hidden="true" />
          <span className="flex-1">{group.label}</span>
          <span className="text-xs font-normal tabular-nums">
            {group.items.length}
          </span>
        </button>
      </h2>
      <ul id={listId} hidden={!expanded} className="flex flex-col gap-0.5 pl-3">
        {group.items.length === 0 ? (
          <li className="px-3 py-2 text-sm text-muted-foreground">
            {group.empty}
          </li>
        ) : (
          group.items.map((item) => {
            const current = isCurrent(item.to, pathname, search);
            const Icon = item.icon;
            return (
              <li key={item.key}>
                <Link
                  to={item.to}
                  onClick={onNavigate}
                  aria-current={current ? "page" : undefined}
                  title={item.label}
                  className={cn(
                    "flex min-h-11 items-center gap-2.5 rounded-2xl px-3 text-sm transition-colors focus-visible:outline-2 focus-visible:outline-ring",
                    current
                      ? "bg-primary text-primary-foreground"
                      : "hover:bg-accent",
                  )}
                >
                  <Icon className="size-4 shrink-0 opacity-80" />
                  <span className="min-w-0 flex-1 truncate">{item.label}</span>
                  {item.count != null && (
                    <span className="text-xs tabular-nums opacity-80">
                      {item.count}
                      <span className="sr-only">
                        {" "}
                        {group.id === "campaigns" ? "drafts" : "donors"}
                      </span>
                    </span>
                  )}
                </Link>
              </li>
            );
          })
        )}
        {group.action && (
          <li>
            <Link
              to={group.action.to}
              onClick={onNavigate}
              className="flex min-h-11 items-center gap-2.5 rounded-2xl px-3 text-sm text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
            >
              <Plus className="size-4" aria-hidden="true" />
              {group.action.label}
            </Link>
          </li>
        )}
      </ul>
    </section>
  );
};
