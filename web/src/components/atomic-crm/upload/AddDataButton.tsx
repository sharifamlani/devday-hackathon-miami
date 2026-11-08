import { useState } from "react";
import { Plus } from "lucide-react";

import { DATA_MODE } from "../providers/local";
import { AddDataDialog } from "./AddDataDialog";

export const ADD_DATA_TOOLTIP = "Add data: spreadsheets, notes, sign-in sheets";
export const ADD_DATA_DISABLED_TOOLTIP = "Uploads need the local service";

/**
 * The "+" in Home's left control strip, above the dictation icon. Opens the Add data dialog.
 * Outside local mode there is no service to upload to, so it is disabled and says why.
 */
export const AddDataButton = ({
  local = DATA_MODE === "local",
}: {
  local?: boolean;
}) => {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={!local}
        aria-label="Add data"
        aria-haspopup="dialog"
        title={local ? ADD_DATA_TOOLTIP : ADD_DATA_DISABLED_TOOLTIP}
        className="grid size-10 shrink-0 place-items-center rounded-full border border-border bg-transparent text-foreground transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent"
      >
        <Plus className="size-[18px]" strokeWidth={1.6} aria-hidden="true" />
      </button>
      {open && <AddDataDialog open={open} onOpenChange={setOpen} />}
    </>
  );
};
