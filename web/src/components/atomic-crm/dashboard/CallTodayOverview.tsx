import type { ReactNode } from "react";
import { Copy, Star } from "lucide-react";

import { Skeleton } from "@/components/ui/skeleton";

const SEGMENTS = 8;

/** Decorative segmented bar; the number above carries the real meaning. */
const MetricLine = ({ filled }: { filled: number }) => (
  <div aria-hidden="true" className="mt-4 flex gap-1">
    {Array.from({ length: SEGMENTS }, (_, i) => (
      <span
        key={i}
        className={`h-1.5 flex-1 rounded-full ${i < filled ? "bg-brand" : "bg-quiet"}`}
      />
    ))}
  </div>
);

const Metric = ({
  label,
  value,
  note,
  icon,
  filled,
}: {
  label: string;
  value: ReactNode;
  note: string;
  icon: ReactNode;
  filled: number;
}) => (
  <div className="flex flex-col rounded-[24px] bg-card p-6 shadow-sm">
    <div className="flex items-start justify-between gap-3">
      <p className="text-sm font-medium text-muted-foreground">{label}</p>
      <span
        aria-hidden="true"
        className="flex size-9 shrink-0 items-center justify-center rounded-full bg-brand-soft text-brand-soft-foreground"
      >
        {icon}
      </span>
    </div>
    <p className="mt-3 text-4xl font-semibold tabular-nums">{value}</p>
    <p className="mt-1 text-sm text-muted-foreground">{note}</p>
    <MetricLine filled={filled} />
  </div>
);

const share = (part: number, whole: number) =>
  whole > 0 ? Math.min(SEGMENTS, Math.ceil((part / whole) * SEGMENTS)) : 0;

/** Kindred overview row: one hero card plus two metric cards. */
export const CallTodayOverview = ({
  loading,
  total,
  needCall,
  stars,
  duplicates,
}: {
  loading: boolean;
  total: number;
  needCall: number;
  stars: number;
  duplicates: number | null;
}) => (
  <section
    aria-label="Overview"
    className="grid gap-4 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)]"
  >
    <div className="flex items-center justify-between gap-6 rounded-[24px] bg-olive p-6">
      <div className="min-w-0">
        <p className="text-sm font-medium text-muted-foreground">
          Before Give Miami Day
        </p>
        <div className="mt-2 text-2xl font-semibold leading-snug">
          {loading ? (
            <Skeleton className="h-16 w-56" />
          ) : (
            <p>
              {needCall} {needCall === 1 ? "donor needs" : "donors need"} a
              call before Give Miami Day
            </p>
          )}
        </div>
      </div>
      <div
        aria-hidden="true"
        className="flex size-24 shrink-0 items-center justify-center rounded-full text-3xl font-semibold tabular-nums text-brand-foreground"
        style={{
          background:
            "radial-gradient(circle at 30% 30%, color-mix(in srgb, var(--brand) 55%, white), var(--brand) 60%)",
        }}
      >
        {loading ? "" : needCall}
      </div>
    </div>
    <Metric
      label="Star donors"
      value={loading ? "—" : stars}
      note="Marked as stars"
      icon={<Star className="size-4" />}
      filled={loading ? 0 : share(stars, total)}
    />
    <Metric
      label="Possible duplicates"
      value={duplicates == null ? "—" : duplicates}
      note="Pairs to review"
      icon={<Copy className="size-4" />}
      filled={duplicates == null ? 0 : share(duplicates, total)}
    />
  </section>
);
