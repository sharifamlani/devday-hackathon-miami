import { TAB_LABELS, TABS } from "../providers/local/crmTypes";
import { usePeople } from "../providers/local/crmHooks";
import { useDuplicates } from "../providers/local/hooks";
import type { IngestResult } from "../providers/local/types";

/**
 * After an import: people per tab, how many need a person's call, and the
 * possible duplicates, read back from the CRM itself (not from the upload's
 * own claim). Falls back to what ingest reported if /people isn't served yet.
 */
export const ImportSummary = ({ result }: { result: IngestResult | null }) => {
  const people = usePeople("giver"); // its counts cover every tab
  const duplicates = useDuplicates();
  const counts = people.data?.counts;
  const dupes = duplicates.data?.length ?? result?.duplicates ?? null;

  return (
    <div className="space-y-2" aria-live="polite">
      {counts ? (
        <ul className="flex flex-wrap gap-2" aria-label="People by tab">
          {TABS.map((tab) => (
            <li key={tab} className="rounded-full bg-muted px-3 py-1 text-sm">
              <strong>{counts[tab] ?? "—"}</strong> {TAB_LABELS[tab]}
            </li>
          ))}
        </ul>
      ) : (
        result && (
          <p className="text-sm">
            {[
              result.donors != null ? `${result.donors} people` : null,
              result.gifts != null ? `${result.gifts} gifts` : null,
            ]
              .filter(Boolean)
              .join(" · ") || result.message || "Your files were imported."}
          </p>
        )
      )}
      <ul className="flex flex-wrap gap-2 text-sm">
        {people.data && people.data.needs_review > 0 && (
          <li className="rounded-full bg-amber-100 px-3 py-1 text-amber-950 dark:bg-amber-950 dark:text-amber-100">
            <strong>{people.data.needs_review}</strong> need your call
          </li>
        )}
        {dupes != null && dupes > 0 && (
          <li className="rounded-full bg-amber-100 px-3 py-1 text-amber-950 dark:bg-amber-950 dark:text-amber-100">
            <strong>{dupes}</strong> possible duplicate{dupes === 1 ? "" : "s"}
          </li>
        )}
      </ul>
      {people.error && !result && (
        <p className="text-sm text-muted-foreground">{people.error.message}</p>
      )}
    </div>
  );
};
