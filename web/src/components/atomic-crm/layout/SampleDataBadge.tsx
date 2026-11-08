import { useQuery } from "@tanstack/react-query";

import { Badge } from "@/components/ui/badge";

import { DATA_MODE } from "../providers/local/config";
import { loadSnapshot } from "../providers/local/snapshotClient";

/**
 * The snapshot build (Vercel) always says it is sample data, so it never
 * reads as real records. Renders nothing on the laptop (local/live mode).
 */
export const SampleDataBadge = ({ mode = DATA_MODE }: { mode?: string }) => {
  const { data: asOf } = useQuery({
    queryKey: ["donor-desk", "snapshot-meta"],
    queryFn: async () => (await loadSnapshot()).meta.as_of ?? null,
    enabled: mode === "snapshot",
    meta: { persist: false },
  });
  if (mode !== "snapshot") return null;
  const title = `Read-only sample export${asOf ? ` as of ${asOf}` : ""}. Not real donor records.`;
  return (
    <Badge variant="outline" title={title} aria-label={`Sample data. ${title}`} data-testid="sample-data-badge">
      Sample data
    </Badge>
  );
};
