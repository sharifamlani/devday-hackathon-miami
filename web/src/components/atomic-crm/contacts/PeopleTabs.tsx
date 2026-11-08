import { useId, useMemo, useState } from "react";
import { ArrowRightLeft, Dog, Search } from "lucide-react";
import { Link, useNavigate } from "react-router";
import { toast } from "sonner";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { DATA_MODE } from "../providers/local/config";
import {
  useCommunityStats,
  usePeople,
  useSetTab,
} from "../providers/local/crmHooks";
import { NOT_RECORDED } from "../providers/local/crmParse";
import {
  TAB_LABELS,
  TABS,
  type Person,
  type Tab,
} from "../providers/local/crmTypes";
import { searchPeople } from "../home/searchPeople";
import { InitialsAvatar, tileClass } from "./donorCrmUi";
import { usePeopleTab } from "./usePeopleTab";

/* plan.md §17/§21: one CRM, three locked tabs (Givers · Neighbors · Community). */

/** Givers · Neighbors · Community, with a count on each (GET /people counts). */
export const PeopleTabBar = () => {
  const [tab, setTab] = usePeopleTab();
  const { data } = usePeople(tab);
  return (
    <div
      role="tablist"
      aria-label="People by tab"
      className="flex w-fit max-w-full gap-1 overflow-x-auto rounded-full bg-muted p-1"
    >
      {TABS.map((t) => {
        const count = data?.counts[t];
        const selected = t === tab;
        return (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={selected}
            onClick={() => setTab(t)}
            className={cn(
              "inline-flex min-h-9 items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-1.5 sm:gap-1.5 sm:px-3.5 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
              selected
                ? "bg-card text-foreground shadow-xs"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {TAB_LABELS[t]}
            {count != null && (
              <span className="tabular-nums text-xs text-muted-foreground">
                {count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
};

const matches = (person: Person, q: string) =>
  [person.name, person.org_name, person.email, person.city]
    .filter(Boolean)
    .some((v) => (v as string).toLowerCase().includes(q));

/** The Neighbors or Community list (GET /people?type=…). Givers keep the donor list. */
export const PeopleTabPanel = ({ tab }: { tab: Exclude<Tab, "giver"> }) => {
  const { data, isPending, error } = usePeople(tab);
  const [query, setQuery] = useState("");
  const searchId = useId();
  const people = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = data?.people ?? [];
    return q ? list.filter((p) => matches(p, q)) : list;
  }, [data, query]);
  const label = TAB_LABELS[tab].toLowerCase();

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1 basis-56">
          <label htmlFor={searchId} className="sr-only">
            Search {label}
          </label>
          <Search
            aria-hidden
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            id={searchId}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={`Find ${label} by name, email or city`}
            className="min-h-11 rounded-full bg-card pl-9"
          />
        </div>
        {tab === "community" && (
          <a
            href="#community-stats"
            className="rounded-sm text-sm font-medium underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            See community stats
          </a>
        )}
      </div>
      <p className="text-sm text-muted-foreground" aria-live="polite">
        {isPending
          ? `Loading ${label}…`
          : error
            ? ""
            : tab === "neighbor"
              ? `${people.length} ${people.length === 1 ? "person" : "people"} met, not yet giving or served`
              : `${people.length} ${people.length === 1 ? "person" : "people"} served · fields are self-reported on intake forms; nothing is inferred`}
      </p>
      <div className={cn(tileClass, "overflow-hidden")}>
        {isPending ? (
          <div className="space-y-2 p-3">
            {Array.from({ length: 5 }, (_, i) => (
              <Skeleton key={i} className="h-14 w-full" />
            ))}
          </div>
        ) : error ? (
          <p role="alert" className="p-4 text-sm text-destructive">
            Could not load {label}: {error.message}
          </p>
        ) : people.length === 0 ? (
          <p className="p-6 text-center font-medium">
            {query.trim()
              ? `No ${label} match “${query.trim()}”.`
              : tab === "neighbor"
                ? "No neighbors yet. Upload a sign-in sheet to add people you met."
                : "No community members yet. Upload intake forms to add the people you serve."}
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {people.map((person) => (
              <PersonRow key={person.id} person={person} />
            ))}
          </ul>
        )}
      </div>
      <AlsoFound query={query} current={tab} />
      {tab === "community" && <CommunityStatsPanel />}
    </div>
  );
};

/**
 * A search finds people in the other two tabs too: "Also found: 1 in
 * Neighbors · 1 in Community", then the names. A name switches to that tab
 * and opens the person (Back returns to the list on that tab).
 */
export const AlsoFound = ({
  query,
  current,
}: {
  query: string;
  current: Tab;
}) => {
  const q = query.trim();
  const [first, second] = TABS.filter((t) => t !== current);
  const a = usePeople(first, !!q);
  const b = usePeople(second, !!q);
  const navigate = useNavigate();
  const [, setTab] = usePeopleTab();
  if (!q) return null;
  const hits = [
    ...searchPeople(a.data?.people ?? [], q, 50),
    ...searchPeople(b.data?.people ?? [], q, 50),
  ];
  if (hits.length === 0) return null;
  const counts = [first, second]
    .map((t) => [t, hits.filter((p) => p.tab === t).length] as const)
    .filter(([, n]) => n > 0)
    .map(([t, n]) => `${n} in ${TAB_LABELS[t]}`)
    .join(" · ");
  return (
    <section
      aria-label="Matches in other tabs"
      className="rounded-2xl bg-muted px-3 py-2 text-sm"
    >
      <p className="font-medium">Also found: {counts}</p>
      <ul className="mt-1 flex flex-wrap gap-1.5">
        {hits.slice(0, 8).map((person) => (
          <li key={person.id}>
            <button
              type="button"
              onClick={() => {
                setTab(person.tab);
                navigate(`/contacts/${person.id}/show`);
              }}
              className="inline-flex min-h-9 items-center gap-1.5 rounded-full bg-card px-3 text-xs font-medium hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              {person.name}
              <span className="text-muted-foreground">
                {TAB_LABELS[person.tab]}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
};

const PersonRow = ({ person }: { person: Person }) => (
  <li className="flex items-start gap-3 px-3 py-2.5 hover:bg-muted/50">
    <InitialsAvatar name={person.name} size="sm" />
    <div className="min-w-0 flex-1 space-y-1">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <Link
          to={`/contacts/${person.id}/show`}
          className="truncate rounded-sm font-medium hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          {person.name}
        </Link>
        {person.needs_review && (
          <span
            title={person.review_reason ?? undefined}
            className="inline-flex shrink-0 items-center rounded-full bg-warn px-2 py-0.5 text-[11px] font-semibold text-warn-foreground"
          >
            Check tab
          </span>
        )}
        {person.has_dog && (
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold">
            <Dog aria-hidden className="size-3" />
            Has a dog
          </span>
        )}
      </div>
      <p className="truncate text-xs text-muted-foreground">
        {[
          person.org_name && person.org_name !== person.name
            ? person.org_name
            : null,
          person.city,
          person.email ?? person.phone,
          person.tags.length ? person.tags.join(", ") : null,
        ]
          .filter(Boolean)
          .join(" · ")}
      </p>
      {person.tab === "neighbor" ? (
        <NeighborFollowUp person={person} />
      ) : (
        <SelfReported person={person} />
      )}
      {person.needs_review && person.review_reason && (
        <p className="text-xs text-muted-foreground">{person.review_reason}</p>
      )}
    </div>
    <MoveMenu person={person} />
  </li>
);

/** What we know about following up: the agent's next step, else the source's notes. Never made up. */
const NeighborFollowUp = ({ person }: { person: Person }) => (
  <div className="space-y-0.5 text-xs">
    {person.next_step ? (
      <p>
        <span className="font-semibold">Next step:</span> {person.next_step}
      </p>
    ) : person.notes ? (
      <p>
        <span className="font-semibold">Follow-up notes:</span> {person.notes}
      </p>
    ) : (
      <p className="text-muted-foreground">No follow-up yet</p>
    )}
    {person.source && (
      <p className="text-muted-foreground">Met via {person.source}</p>
    )}
  </div>
);

/** Community: the intake form's own answers; a blank answer reads "not recorded". */
const SelfReported = ({ person }: { person: Person }) => (
  <dl
    aria-label="Self-reported on the intake form"
    className="flex flex-wrap gap-1.5 text-[11px]"
  >
    {person.demographics
      .filter((d) => d.label.toLowerCase() !== "summary")
      .map((d) => (
        <div
          key={d.label}
          className="inline-flex gap-1 rounded-full bg-muted px-2 py-0.5"
        >
          <dt className="text-muted-foreground">{d.label}</dt>
          <dd
            className={cn(
              "font-semibold",
              d.value === NOT_RECORDED && "font-normal text-muted-foreground",
            )}
          >
            {d.value}
          </dd>
        </div>
      ))}
  </dl>
);

/** One-click move to another tab (PATCH /people/{id}); Undo moves them back. */
const MoveMenu = ({ person }: { person: Person }) => {
  const move = useSetTab();
  if (DATA_MODE !== "local") return null; // the snapshot build is read-only sample data
  // mutateAsync, not mutate's callbacks: the move refetches the list and this
  // row unmounts, which would skip per-call callbacks (and the Undo toast).
  const moveTo = (to: Tab, from: Tab, undo = false): Promise<void> =>
    move.mutateAsync({ personId: person.id, tab: to }).then(
      () => {
        if (undo) {
          toast.success(`${person.name} is back in ${TAB_LABELS[to]}.`);
          return;
        }
        toast.success(`Moved ${person.name} to ${TAB_LABELS[to]}.`, {
          action: { label: "Undo", onClick: () => void moveTo(from, to, true) },
        });
      },
      (err: Error) =>
        void toast.error(`Couldn’t move ${person.name}: ${err.message}`),
    );
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={`Move ${person.name} to another tab`}
        disabled={move.isPending}
        className="inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-full border border-border bg-card px-3 text-xs font-medium hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-60"
      >
        <ArrowRightLeft aria-hidden className="size-3.5" />
        Move
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-44">
        {TABS.filter((t) => t !== person.tab).map((t) => (
          <DropdownMenuItem
            key={t}
            className="min-h-10"
            onClick={() => void moveTo(t, person.tab)}
          >
            Move to {TAB_LABELS[t]}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

/** GET /community/stats: counts from what the nonprofit recorded, "not recorded" as its own bucket. */
const CommunityStatsPanel = () => {
  const { data, isPending, error } = useCommunityStats();
  return (
    <section
      id="community-stats"
      aria-labelledby="community-stats-title"
      className={cn(tileClass, "scroll-mt-20 space-y-3 p-4")}
    >
      <div>
        <h2 id="community-stats-title" className="font-semibold">
          Community stats
        </h2>
        <p className="text-xs text-muted-foreground">
          {data?.note ??
            "Counts use only what the nonprofit recorded; nothing is inferred."}
        </p>
      </div>
      {isPending ? (
        <Skeleton className="h-24 w-full" />
      ) : error ? (
        <p role="alert" className="text-sm text-destructive">
          Could not load community stats: {error.message}
        </p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {data.breakdowns.map((b) => (
            <div key={b.dimension}>
              <h3 className="text-xs font-semibold text-muted-foreground">
                {b.dimension}
              </h3>
              <ul className="mt-1 flex flex-wrap gap-1.5 text-xs">
                {b.buckets.map((bucket) => (
                  <li
                    key={bucket.label}
                    className={cn(
                      "rounded-full bg-muted px-2 py-0.5",
                      bucket.label === NOT_RECORDED && "text-muted-foreground",
                    )}
                  >
                    {bucket.label}{" "}
                    <span className="font-semibold tabular-nums">
                      {bucket.count}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </section>
  );
};
