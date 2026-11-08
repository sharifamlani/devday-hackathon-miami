import { useQuery } from "@tanstack/react-query";
import { Eye } from "lucide-react";

import {
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";

import { DATA_MODE } from "../providers/local/config";
import { loadSnapshot } from "../providers/local/snapshotClient";

/**
 * The snapshot build (Vercel) names its limit (rule 9: never present a mock as live) as the
 * first line of the profile menu, instead of a pill on every page. Renders nothing on the
 * laptop (local/live mode). Also said on the landing's sample dialog, the tour card and the
 * Q4 tile's "Sample goal".
 */
export const SampleDataMenuNote = ({ mode = DATA_MODE }: { mode?: string }) => {
  const { data: asOf } = useQuery({
    queryKey: ["donor-desk", "snapshot-meta"],
    queryFn: async () => (await loadSnapshot()).meta.as_of ?? null,
    enabled: mode === "snapshot",
    meta: { persist: false },
  });
  if (mode !== "snapshot") return null;
  return (
    <>
      <DropdownMenuGroup>
        <DropdownMenuLabel
          data-testid="sample-data-note"
          className="flex items-start gap-2 rounded-md bg-surface px-2 py-2 font-normal"
        >
          <Eye className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <span>
            <span className="block text-sm font-medium text-foreground">
              Sample data · read-only
            </span>
            <span className="block text-xs text-muted-foreground">
              Every name and amount is made up
              {asOf ? `, as of ${asOf}` : ""}. Changes stay in this browser.
            </span>
          </span>
        </DropdownMenuLabel>
      </DropdownMenuGroup>
      <DropdownMenuSeparator />
    </>
  );
};
