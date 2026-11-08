import { ShieldCheck } from "lucide-react";

import { cn } from "@/lib/utils";
import { DATA_MODE } from "../providers/local/config";

/** Replaces the old "no message leaves this laptop" claim, which a real send makes false. */
export const SendModeNote = ({ className }: { className?: string }) => (
  <p
    className={cn(
      "flex items-start gap-2 text-xs text-muted-foreground",
      className,
    )}
  >
    <ShieldCheck className="mt-0.5 size-4 shrink-0" aria-hidden />
    <span>
      <strong className="font-semibold text-foreground">
        {DATA_MODE === "snapshot"
          ? "Cached sample: nothing is ever sent."
          : "Sending is a dry run unless email or text delivery is switched on for this deployment."}
      </strong>{" "}
      {DATA_MODE === "snapshot"
        ? "The outbox lives only in this browser tab."
        : "Every result below says what actually happened: Dry run, Sent via a provider, or Failed."}
    </span>
  </p>
);
