import { useState } from "react";
import { Undo2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useUndoMerge } from "../providers/local/hooks";
import type { MergeLogEntry } from "../providers/local/types";
import { formatDay } from "./donorFormat";

/** Merge history for a donor, with an inline-confirmed undo for the newest merge. */
export const MergeHistory = ({ merges }: { merges?: MergeLogEntry[] }) => {
  if (!merges || merges.length === 0) return null;
  return (
    <section
      aria-label="Merge history"
      className="space-y-3 rounded-[22px] bg-surface p-5"
    >
      <div>
        <h3 className="text-[11px] font-bold uppercase tracking-[0.12em]">
          Merge history
        </h3>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Nothing is lost: a merged record is kept whole and can be restored.
        </p>
      </div>
      <ul className="space-y-2.5">
        {merges.map((entry) => (
          <MergeRow key={entry.id} entry={entry} />
        ))}
      </ul>
    </section>
  );
};

const MergeRow = ({ entry }: { entry: MergeLogEntry }) => {
  const undo = useUndoMerge();
  const [confirming, setConfirming] = useState(false);
  const emails = entry.merged_emails.length
    ? entry.merged_emails
    : entry.merged_email
      ? [entry.merged_email]
      : [];

  return (
    <li className="space-y-2 rounded-[18px] bg-card p-3.5 text-xs shadow-xs">
      <p className="leading-relaxed">
        <span className="font-semibold">Merged {entry.merged_name}</span>
        <span className="text-muted-foreground">
          {" "}
          · {formatDay(entry.merged_at)} · {entry.gifts_moved}{" "}
          {entry.gifts_moved === 1 ? "gift" : "gifts"} moved
          {entry.approved_by ? ` · by ${entry.approved_by}` : ""}
        </span>
      </p>
      {emails.length > 0 && (
        <ul aria-label="Merged emails" className="flex flex-wrap gap-1.5">
          {emails.map((email) => (
            <li
              key={email}
              className="rounded-[7px] bg-quiet px-2 py-1 text-[11px] font-medium text-quiet-foreground"
            >
              {email}
            </li>
          ))}
        </ul>
      )}
      {entry.undone_at && (
        <span className="inline-block rounded-full bg-quiet px-2.5 py-1 text-[11px] font-semibold text-quiet-foreground">
          Undone {formatDay(entry.undone_at)}
        </span>
      )}
      {entry.can_undo && !entry.undone_at && (
        <div className="flex flex-wrap items-center gap-2 pt-1">
          {confirming ? (
            <>
              <span className="text-xs text-muted-foreground">
                Restore {entry.merged_name} as its own donor?
              </span>
              <Button
                type="button"
                className="min-h-11 rounded-[28px] bg-primary px-5 text-xs font-medium text-primary-foreground hover:bg-primary/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                disabled={undo.isPending}
                onClick={() =>
                  undo.mutate(entry.id, {
                    onSuccess: () => setConfirming(false),
                  })
                }
              >
                {undo.isPending ? "Undoing…" : "Confirm undo"}
              </Button>
              <Button
                type="button"
                variant="ghost"
                className="min-h-11 rounded-[28px] bg-quiet px-5 text-xs font-medium text-foreground hover:bg-olive focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                disabled={undo.isPending}
                onClick={() => {
                  undo.reset();
                  setConfirming(false);
                }}
              >
                Cancel
              </Button>
            </>
          ) : (
            <Button
              type="button"
              variant="outline"
              className="min-h-11 rounded-[28px] px-5 text-xs font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              onClick={() => setConfirming(true)}
            >
              <Undo2 />
              Undo merge
            </Button>
          )}
        </div>
      )}
      {undo.error && (
        <p role="alert" className="text-xs text-destructive">
          Could not undo this merge: {(undo.error as Error).message}
        </p>
      )}
    </li>
  );
};
