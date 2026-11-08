import { useQuery } from "@tanstack/react-query";

import { Badge } from "@/components/ui/badge";

import {
  DATA_MODE,
  PUBLIC_READ_ONLY,
  READ_ONLY_PREVIEW,
} from "../providers/local/config";
import { loadSnapshot } from "../providers/local/snapshotClient";

/**
 * The snapshot build (Vercel) always says it is sample data, so it never
 * reads as real records. The live app in public mode (the tunnel) says it is a read-only preview. Renders
 * nothing on the laptop otherwise.
 */
export const SampleDataBadge = ({
  mode = DATA_MODE,
  readOnly = PUBLIC_READ_ONLY,
}: {
  mode?: string;
  readOnly?: boolean;
}) => {
  const { data: asOf } = useQuery({
    queryKey: ["donor-desk", "snapshot-meta"],
    queryFn: async () => (await loadSnapshot()).meta.as_of ?? null,
    enabled: mode === "snapshot",
    meta: { persist: false },
  });
  if (mode !== "snapshot") {
    if (!readOnly) return null;
    return (
      <Badge
        variant="outline"
        title={READ_ONLY_PREVIEW}
        aria-label={READ_ONLY_PREVIEW}
        data-testid="read-only-badge"
      >
        Read-only preview
      </Badge>
    );
  }
  const title = `Read-only sample export${asOf ? ` as of ${asOf}` : ""}. Not real donor records.`;
  return (
    <Badge
      variant="outline"
      title={title}
      aria-label={`Sample data. ${title}`}
      data-testid="sample-data-badge"
    >
      Sample data
    </Badge>
  );
};
