import { AlertTriangle, Dog, Star } from "lucide-react";

import { NOT_RECORDED } from "../providers/local/crmParse";
import { TAB_LABELS, TABS, type Person, type Tab } from "../providers/local/crmTypes";

const demo = (person: Person, label: string) =>
  person.demographics.find((d) => d.label === label)?.value ?? NOT_RECORDED;

/** The people list for one tab: select rows, move between tabs, open a person. */
export const PeopleTable = ({
  tab,
  people,
  selected,
  onSelect,
  onOpen,
  onMove,
  movingId,
  canMove,
}: {
  tab: Tab;
  people: Person[];
  selected: number[];
  onSelect: (ids: number[]) => void;
  onOpen: (person: Person) => void;
  onMove: (person: Person, tab: Tab) => void;
  movingId: number | null;
  /** false in the read-only snapshot, or when PATCH /people/{id} isn't served */
  canMove: boolean;
}) => {
  const allSelected = people.length > 0 && people.every((p) => selected.includes(p.id));
  const toggle = (id: number) =>
    onSelect(selected.includes(id) ? selected.filter((s) => s !== id) : [...selected, id]);

  return (
    <div className="overflow-x-auto rounded-[22px] bg-card">
      <table className="w-full text-sm">
        <thead className="text-left text-xs text-muted-foreground">
          <tr className="border-b">
            <th className="w-10 p-3">
              <input
                type="checkbox"
                aria-label="Select all"
                checked={allSelected}
                onChange={() => onSelect(allSelected ? [] : people.map((p) => p.id))}
              />
            </th>
            <th className="p-3">Name</th>
            {tab === "giver" && (
              <>
                <th className="p-3">Score</th>
                <th className="p-3">Status</th>
                <th className="p-3">Tier</th>
              </>
            )}
            {tab === "neighbor" && (
              <>
                <th className="p-3">City</th>
                <th className="p-3">Interests</th>
              </>
            )}
            {tab === "community" && (
              <>
                <th className="p-3">Programs</th>
                <th className="p-3">Language</th>
                <th className="p-3">Age range</th>
              </>
            )}
            <th className="p-3">Tab</th>
          </tr>
        </thead>
        <tbody>
          {people.map((person) => (
            <tr key={person.id} className="border-b last:border-0 hover:bg-muted/40">
              <td className="p-3">
                <input
                  type="checkbox"
                  aria-label={`Select ${person.name}`}
                  checked={selected.includes(person.id)}
                  onChange={() => toggle(person.id)}
                />
              </td>
              <td className="p-3">
                <button
                  type="button"
                  onClick={() => onOpen(person)}
                  className="inline-flex items-center gap-1.5 text-left font-medium underline-offset-2 hover:underline"
                >
                  {person.is_star && <Star className="size-3.5 fill-amber-400 text-amber-500" aria-label="Star donor" />}
                  {person.name}
                </button>
                {person.org_name && person.org_name !== person.name && (
                  <span className="ml-1 text-muted-foreground">· {person.org_name}</span>
                )}
                {person.has_dog && <Dog className="ml-1.5 inline size-3.5 text-muted-foreground" aria-label="Has a dog" />}
                {person.needs_review && (
                  <span
                    className="ml-2 inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-950 dark:bg-amber-950 dark:text-amber-100"
                    title={person.review_reason ?? "Needs your call"}
                  >
                    <AlertTriangle className="size-3" aria-hidden />
                    Needs your call
                  </span>
                )}
              </td>
              {tab === "giver" && (
                <>
                  <td className="p-3 tabular-nums">{person.score ?? "—"}</td>
                  <td className="p-3">{person.status?.replace("_", " ") ?? "—"}</td>
                  <td className="p-3">{person.tier ?? "—"}</td>
                </>
              )}
              {tab === "neighbor" && (
                <>
                  <td className="p-3">{person.city ?? "—"}</td>
                  <td className="p-3">{person.tags.join(", ") || "—"}</td>
                </>
              )}
              {tab === "community" && (
                <>
                  <td className="p-3">{demo(person, "Programs")}</td>
                  <td className="p-3">{demo(person, "Language")}</td>
                  <td className="p-3">{demo(person, "Age range")}</td>
                </>
              )}
              <td className="p-3">
                <label className="sr-only" htmlFor={`move-${person.id}`}>Move {person.name} to</label>
                <select
                  id={`move-${person.id}`}
                  value={person.tab}
                  disabled={!canMove || movingId === person.id}
                  title={canMove ? undefined : "Moving people needs the live API"}
                  onChange={(e) => onMove(person, e.target.value as Tab)}
                  className="rounded-full border bg-background px-2 py-1 text-xs"
                >
                  {TABS.map((t) => (
                    <option key={t} value={t}>{TAB_LABELS[t]}</option>
                  ))}
                </select>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};
