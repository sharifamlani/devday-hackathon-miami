import { useId, useState } from "react";
import {
  ChevronRight,
  Folder,
  Heart,
  MessageCircleQuestion,
  Moon,
  Plus,
  Search,
  Send,
  Sparkles,
} from "lucide-react";
import { Link } from "react-router";
import { useCampaigns, useDonors } from "../providers/local/hooks";
import { EXAMPLE_QUESTIONS } from "../providers/local/ask";
import { useAskSession } from "../ask/askSessionContext";
import { tile, focusRing } from "./tile";
import { cn } from "@/lib/utils";

/** Inline project shortcuts; actual campaigns and donor counts use existing providers. */
export const ProjectsTile = () => {
  const campaigns = useCampaigns();
  const donors = useDonors();
  const session = useAskSession();
  const headingId = useId();
  const searchId = useId();
  const [query, setQuery] = useState("");
  const [closed, setClosed] = useState<string[]>([]);
  const count = (
    test: (donor: NonNullable<typeof donors.data>[number]) => boolean,
  ) => donors.data?.filter(test).length;
  const groups = [
    {
      id: "campaigns",
      title: "Campaigns",
      pending: campaigns.isPending,
      error: campaigns.error,
      items: (campaigns.data ?? []).map((c) => ({
        key: String(c.id),
        title: c.name,
        to: `/campaigns/${c.id}`,
        icon: Send,
        count: c.counts.draft || undefined,
        question: undefined as string | undefined,
      })),
    },
    {
      id: "questions",
      title: "Saved Ask questions",
      pending: false,
      error: null,
      items: EXAMPLE_QUESTIONS.map((q, i) => ({
        key: String(i),
        title: q,
        to: "/",
        icon: MessageCircleQuestion,
        count: undefined,
        question: q,
      })),
    },
    {
      id: "lists",
      title: "Donor lists",
      pending: donors.isPending,
      error: donors.error,
      items: [
        {
          key: "attention",
          title: "Needs attention",
          to: "/inbox?view=attention",
          icon: Heart,
          count: count((d) => d.status === "lapsing" || d.status === "lapsed"),
          question: undefined,
        },
        {
          key: "stars",
          title: "Star donors",
          to: "/inbox?view=stars",
          icon: Sparkles,
          count: count((d) => d.is_star),
          question: undefined,
        },
        {
          key: "lapsed",
          title: "Lapsed",
          to: "/inbox?view=lapsed",
          icon: Moon,
          count: count((d) => d.status === "lapsed"),
          question: undefined,
        },
      ],
    },
  ];
  const needle = query.trim().toLocaleLowerCase();
  const filtered = groups.map((group) => ({
    ...group,
    items: group.items.filter((item) =>
      item.title.toLocaleLowerCase().includes(needle),
    ),
  }));
  return (
    <section className={cn(tile, "home-shortcuts")} aria-labelledby={headingId}>
      <h2 id={headingId}>Projects</h2>
      <div className="home-shortcut-search">
        <Search size={14} aria-hidden="true" />
        <label htmlFor={searchId} className="sr-only">
          Filter projects
        </label>
        <input
          id={searchId}
          type="search"
          placeholder="Search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      {needle && !filtered.some((group) => group.items.length) && (
        <p role="status" className="text-xs text-muted-foreground">
          No matching projects.
        </p>
      )}
      {filtered.map((group) => {
        if (needle && !group.items.length) return null;
        const expanded = !!needle || !closed.includes(group.id);
        const listId = `${headingId}-${group.id}`;
        return (
          <div key={group.id} className="home-shortcut-group">
            <button
              type="button"
              className={cn("home-project-toggle", focusRing)}
              aria-expanded={expanded}
              aria-controls={listId}
              onClick={() =>
                setClosed((previous) =>
                  previous.includes(group.id)
                    ? previous.filter((id) => id !== group.id)
                    : [...previous, group.id],
                )
              }
            >
              <ChevronRight
                size={12}
                className={expanded ? "rotate-90" : ""}
                aria-hidden="true"
              />
              <Folder size={14} aria-hidden="true" />
              <span className="flex-1 text-left">{group.title}</span>
              <span>{group.items.length}</span>
            </button>
            <ul id={listId} hidden={!expanded} className="home-project-threads">
              {group.pending ? (
                <li className="text-xs text-muted-foreground">Loading…</li>
              ) : group.error ? (
                <li className="text-xs text-muted-foreground">
                  Couldn’t load this group.
                </li>
              ) : !group.items.length && !needle ? (
                <li className="text-xs text-muted-foreground">
                  No projects yet.
                </li>
              ) : (
                group.items.map((item) => (
                  <li key={item.key}>
                    <Link
                      to={item.to}
                      title={item.title}
                      onClick={() => {
                        if (item.question) session.setDraft(item.question);
                      }}
                      className={cn("home-project-thread", focusRing)}
                    >
                      <item.icon
                        className="size-3.5 shrink-0 text-muted-foreground"
                        aria-hidden="true"
                      />
                      <span className="min-w-0 flex-1 truncate">
                        {item.title}
                      </span>
                      {item.count != null && (
                        <span className="text-xs text-muted-foreground">
                          {item.count}
                        </span>
                      )}
                    </Link>
                  </li>
                ))
              )}
              {group.id === "campaigns" && (
                <li>
                  <Link
                    to="/campaigns/new"
                    className={cn("home-project-thread", focusRing)}
                  >
                    <Plus size={14} aria-hidden="true" />
                    New campaign
                  </Link>
                </li>
              )}
            </ul>
          </div>
        );
      })}
    </section>
  );
};
