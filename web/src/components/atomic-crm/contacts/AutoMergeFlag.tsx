import { useState } from "react";
import { toast } from "sonner";

import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { DATA_MODE } from "../providers/local/config";
import {
  useReviewMerge,
  usePersonMerges,
  type MergeReview,
} from "../providers/local/merges";

const pill =
  "inline-flex min-h-9 items-center justify-center rounded-full px-3.5 text-xs font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-60";

/**
 * The amber "!" next to a person merged automatically on upload (#125): exact
 * matches merge, staff can review. Opens the source records with Keep merged
 * and Split back. Renders nothing when the person wasn't auto-merged (or the
 * API doesn't send auto_merged).
 */
export const AutoMergeFlag = ({
  personId,
  name,
  autoMerged,
  mergedFrom,
}: {
  personId: number;
  name: string;
  autoMerged?: boolean | null;
  mergedFrom?: number | null;
}) => {
  const [open, setOpen] = useState(false);
  if (!autoMerged) return null;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        aria-label="Merged automatically, review"
        title="Merged automatically, review"
        className="inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-warn text-[12px] font-bold leading-none text-warn-foreground ring-1 ring-warn-foreground/30 hover:brightness-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        <span aria-hidden>!</span>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 max-w-[calc(100vw-2rem)]">
        {open && (
          <MergeReviewPanel
            personId={personId}
            name={name}
            mergedFrom={mergedFrom ?? 0}
            onDone={() => setOpen(false)}
          />
        )}
      </PopoverContent>
    </Popover>
  );
};

const MergeReviewPanel = ({
  personId,
  name,
  mergedFrom,
  onDone,
}: {
  personId: number;
  name: string;
  mergedFrom: number;
  onDone: () => void;
}) => {
  const { data, isPending, error } = usePersonMerges(personId, true);
  const review = useReviewMerge(personId);
  const [confirmSplit, setConfirmSplit] = useState(false);
  const live = DATA_MODE === "local";
  const merge = data?.merges.find((m) => m.reviewed_at == null);
  const count = data?.merged_from || mergedFrom;

  const run = (action: MergeReview) =>
    review.mutateAsync(action).then(
      (result) => {
        onDone();
        toast.success(
          action === "keep"
            ? `Kept ${name} as one person.`
            : `Split back: ${[name, ...result.restored.map((r) => r.full_name)].join(", ")}.`,
        );
      },
      (err: Error) => void toast.error(err.message),
    );

  return (
    <div className="grid gap-3">
      <div>
        <PopoverTitle className="font-semibold">
          Merged automatically from {count} records
        </PopoverTitle>
        <PopoverDescription className="text-xs text-muted-foreground">
          These looked like the same person on upload, so they were joined. Gift
          totals stay the same either way.
        </PopoverDescription>
      </div>
      {error ? (
        <p role="alert" className="text-xs text-alert-foreground">
          {error.message}
        </p>
      ) : isPending ? (
        <Skeleton className="h-20 w-full" />
      ) : (
        <ul className="grid gap-1.5" aria-label="Merged records">
          {(merge?.sources ?? []).map((src, i) => (
            <li
              key={`${src.name}-${i}`}
              className="rounded-lg bg-muted px-2.5 py-1.5 text-xs"
            >
              <p className="font-semibold">
                {src.name}
                {src.survivor && (
                  <span className="ml-1.5 font-normal text-muted-foreground">
                    (kept record)
                  </span>
                )}
              </p>
              <p className="text-muted-foreground">
                {[
                  src.email ?? src.phone,
                  src.files.join(", ") || null,
                  `${src.gift_count} gift${src.gift_count === 1 ? "" : "s"}`,
                  src.rule,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            </li>
          ))}
        </ul>
      )}
      {!live ? (
        <p className="text-xs text-muted-foreground">
          Sample data is read-only here. Review merges in the live app.
        </p>
      ) : confirmSplit ? (
        <div className="grid gap-2 rounded-lg border border-border p-2.5">
          <p className="text-xs">
            Split back into {count} people? Each gets back its own gifts.
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={review.isPending}
              onClick={() => void run("split")}
              className={cn(
                pill,
                "bg-primary text-primary-foreground hover:bg-primary/85",
              )}
            >
              {review.isPending ? "Splitting…" : "Yes, split back"}
            </button>
            <button
              type="button"
              disabled={review.isPending}
              onClick={() => setConfirmSplit(false)}
              className={cn(pill, "bg-muted hover:bg-accent")}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="flex gap-2">
          <button
            type="button"
            disabled={review.isPending || !merge}
            onClick={() => void run("keep")}
            className={cn(
              pill,
              "bg-primary text-primary-foreground hover:bg-primary/85",
            )}
          >
            {review.isPending ? "Saving…" : "Keep merged"}
          </button>
          <button
            type="button"
            disabled={review.isPending || !merge}
            onClick={() => setConfirmSplit(true)}
            className={cn(pill, "border border-border bg-card hover:bg-muted")}
          >
            Split back
          </button>
        </div>
      )}
    </div>
  );
};
