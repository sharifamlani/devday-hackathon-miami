import { RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { DATA_MODE } from "../providers/local/config";
import { useContextStatus, useRefreshContext } from "../providers/local/crmHooks";
import { useServes } from "./useServes";

/** "Context updated today 7:00 AM · 2 new events" + Refresh now (plan.md §17 amendment). */
export const ContextStatusLine = () => {
  const servesStatus = useServes("GET", "/context/status");
  if (servesStatus === undefined) return null;
  if (!servesStatus) {
    return (
      <p className="text-sm text-muted-foreground">
        Context status isn’t available yet on this API build.
      </p>
    );
  }
  return <ContextStatusLoaded />;
};

const ContextStatusLoaded = () => {
  const status = useContextStatus();
  const refresh = useRefreshContext();
  const servesRefresh = useServes("POST", "/context/refresh");
  const label = status.data?.label ?? (status.isPending ? "Checking context…" : null);
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground" aria-live="polite">
      {label && <span>{label}</span>}
      {status.error && <span>{status.error.message}</span>}
      {!!status.data?.errors.length && (
        <span title={status.data.errors.join("\n")}>
          · {status.data.errors.length} source{status.data.errors.length === 1 ? "" : "s"} couldn’t be read
        </span>
      )}
      {DATA_MODE === "local" && servesRefresh && !status.error && (
        <Button
          size="sm"
          variant="outline"
          onClick={() => refresh.mutate()}
          disabled={refresh.isPending}
        >
          <RefreshCw className={refresh.isPending ? "animate-spin" : ""} aria-hidden />
          {refresh.isPending ? "Refreshing…" : "Refresh now"}
        </Button>
      )}
      {refresh.isError && <span role="alert">{refresh.error.message}</span>}
    </div>
  );
};
