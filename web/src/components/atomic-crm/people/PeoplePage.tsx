import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router";

import { Input } from "@/components/ui/input";
import { DATA_MODE } from "../providers/local/config";
import { usePeople, useSetTab } from "../providers/local/crmHooks";
import { TAB_LABELS, TABS, type Person, type Tab } from "../providers/local/crmTypes";
import { useChatHost } from "../shell/chatHostContext";
import { ContextStatusLine } from "../shell/ContextStatusLine";
import { useServes } from "../shell/useServes";
import { CommunityStatsPanel } from "./CommunityStatsPanel";
import { PeopleTable } from "./PeopleTable";
import { PersonDrawer } from "./PersonDrawer";

const isTab = (value: string | null): value is Tab => TABS.includes(value as Tab);

/** People: Givers · Neighbors · Community (plan.md §17). */
export const PeoplePage = () => {
  const serves = useServes("GET", "/people");
  return (
    <div className="space-y-4 py-2">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-2xl font-semibold">People</h1>
        <ContextStatusLine />
      </div>
      {serves === false ? (
        <p className="rounded-[22px] bg-card p-6 text-sm text-muted-foreground">
          The people list isn’t available yet on this API build (GET /people). It appears here once the three-tab
          routes are running.
        </p>
      ) : serves ? (
        <PeopleTabs />
      ) : null}
    </div>
  );
};

const PeopleTabs = () => {
  const [params, setParams] = useSearchParams();
  const raw = params.get("tab");
  const tab: Tab = isTab(raw) ? raw : "giver";
  const people = usePeople(tab);
  const move = useSetTab();
  // The snapshot is read-only; live, the move needs PATCH /people/{id}.
  const servesMove = useServes("PATCH", "/people/1");
  const canMove = DATA_MODE === "local" && servesMove === true;
  const { setContext, selection, setSelection } = useChatHost();
  const [query, setQuery] = useState("");
  const [reviewOnly, setReviewOnly] = useState(false);
  const [dogsOnly, setDogsOnly] = useState(false);
  const [open, setOpen] = useState<Person | null>(null);

  // The chat panel follows the tab and the selection.
  useEffect(() => setContext({ screen: tab }), [tab, setContext]);
  useEffect(() => setSelection([]), [tab, setSelection]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (people.data?.people ?? []).filter(
      (p) =>
        (!q || `${p.name} ${p.org_name ?? ""} ${p.tags.join(" ")}`.toLowerCase().includes(q)) &&
        (!reviewOnly || p.needs_review) &&
        (!dogsOnly || p.has_dog),
    );
  }, [people.data, query, reviewOnly, dogsOnly]);

  const counts = people.data?.counts;

  return (
    <>
      <nav aria-label="Tabs" className="flex flex-wrap gap-2">
        {TABS.map((t) => (
          <button
            key={t}
            type="button"
            aria-current={t === tab ? "page" : undefined}
            onClick={() => setParams({ tab: t })}
            className={`rounded-full px-4 py-1.5 text-sm ${t === tab ? "bg-primary text-primary-foreground" : "bg-card"}`}
          >
            {TAB_LABELS[t]}
            {counts?.[t] != null && <span className="ml-1.5 tabular-nums opacity-80">{counts[t]}</span>}
          </button>
        ))}
        {people.data && people.data.needs_review > 0 && (
          <span className="self-center rounded-full bg-amber-100 px-3 py-1 text-xs text-amber-950 dark:bg-amber-950 dark:text-amber-100">
            {people.data.needs_review} need your call
          </span>
        )}
      </nav>

      {tab === "community" && <CommunityStatsPanel />}

      <div className="flex flex-wrap items-center gap-3 text-sm">
        <Input
          type="search"
          aria-label="Search people"
          placeholder="Search name, organization or interest"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="max-w-xs"
        />
        <label className="flex items-center gap-1.5">
          <input type="checkbox" checked={reviewOnly} onChange={(e) => setReviewOnly(e.target.checked)} />
          Needs your call
        </label>
        <label className="flex items-center gap-1.5">
          <input type="checkbox" checked={dogsOnly} onChange={(e) => setDogsOnly(e.target.checked)} />
          Has a dog
        </label>
        {selection.length > 0 && (
          <span className="text-muted-foreground">
            {selection.length} selected · ask the assistant to draft for them
          </span>
        )}
      </div>

      {move.isError && <p role="alert" className="text-sm text-destructive">{move.error.message}</p>}
      {people.isPending && <p className="text-sm text-muted-foreground">Loading…</p>}
      {people.error && <p className="text-sm text-muted-foreground">{people.error.message}</p>}
      {people.data &&
        (rows.length ? (
          <PeopleTable
            tab={tab}
            people={rows}
            selected={selection}
            onSelect={setSelection}
            onOpen={setOpen}
            onMove={(person, to) => move.mutate({ personId: person.id, tab: to })}
            movingId={move.isPending ? (move.variables?.personId ?? null) : null}
            canMove={canMove}
          />
        ) : (
          <p className="rounded-[22px] bg-card p-6 text-sm text-muted-foreground">
            {people.data.people.length ? "No one matches these filters." : `No one in ${TAB_LABELS[tab]} yet.`}
          </p>
        ))}

      <PersonDrawer person={open} onClose={() => setOpen(null)} />
    </>
  );
};
