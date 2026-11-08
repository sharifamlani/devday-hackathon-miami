import { cn } from "@/lib/utils";

import { SAVED_IN_BROWSER } from "../providers/local/crmPersistence";

/**
 * Where a new note or task is saved, shown only in snapshot mode (Vercel, no
 * API): there they stay in this browser's storage. In local mode the service
 * saves them and nothing is shown.
 */
export const SavedInBrowserHint = ({ className }: { className?: string }) =>
  SAVED_IN_BROWSER ? (
    <p className={cn("text-xs text-muted-foreground", className)}>
      Saved in this browser
    </p>
  ) : null;
