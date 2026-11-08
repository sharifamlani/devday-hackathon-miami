import { cn } from "@/lib/utils";

import { SAVED_IN_BROWSER } from "../providers/local/crmPersistence";

/**
 * Where a new note or task is saved, shown only in snapshot mode (Vercel, no
 * API) when this browser can store them. In local mode the service saves
 * them, and with storage turned off saving fails with its own message, so
 * nothing is shown.
 */
export const SavedInBrowserHint = ({ className }: { className?: string }) =>
  SAVED_IN_BROWSER ? (
    <p className={cn("text-xs text-muted-foreground", className)}>
      Saved in this browser
    </p>
  ) : null;
