import { NOT_RECORDED } from "../providers/local/crmParse";
import { useCommunityStats } from "../providers/local/crmHooks";

/**
 * Community breakdowns from what the nonprofit recorded (useCommunityStats).
 * "not recorded" is its own bucket, never guessed. No donation ask here.
 */
export const CommunityStatsPanel = () => {
  const stats = useCommunityStats();
  if (stats.isPending) return <p className="text-sm text-muted-foreground">Loading community stats…</p>;
  if (stats.error) return <p className="text-sm text-muted-foreground">{stats.error.message}</p>;
  const data = stats.data;
  if (!data.breakdowns.length) {
    return <p className="text-sm text-muted-foreground">{data.note ?? "No community data recorded yet."}</p>;
  }
  return (
    <section aria-labelledby="community-stats-title" className="space-y-3 rounded-[22px] bg-card p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="community-stats-title" className="font-semibold">
          Community at a glance{data.total != null ? ` · ${data.total} people` : ""}
        </h2>
        {data.note && <p className="text-xs text-muted-foreground">{data.note}</p>}
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {data.breakdowns.map((b) => {
          const max = Math.max(1, ...b.buckets.map((x) => x.count));
          return (
            <figure key={b.dimension} className="space-y-1.5">
              <figcaption className="text-sm font-medium">{b.dimension}</figcaption>
              <ul className="space-y-1">
                {b.buckets.map((bucket) => (
                  <li key={bucket.label} className="grid grid-cols-[minmax(0,7rem)_1fr_auto] items-center gap-2 text-xs">
                    <span className={`truncate ${bucket.label === NOT_RECORDED ? "italic text-muted-foreground" : ""}`}>
                      {bucket.label}
                    </span>
                    <span className="h-2 rounded-full bg-muted">
                      <span
                        className={`block h-2 rounded-full ${bucket.label === NOT_RECORDED ? "bg-muted-foreground/40" : "bg-primary"}`}
                        style={{ width: `${(100 * bucket.count) / max}%` }}
                      />
                    </span>
                    <span className="tabular-nums">{bucket.count}</span>
                  </li>
                ))}
              </ul>
            </figure>
          );
        })}
      </div>
    </section>
  );
};
