import { useEffect, useState } from "react";
import { AlertTriangle, CircleX, Merge } from "lucide-react";
import { useNotify } from "ra-core";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import {
  useDismissDuplicate,
  useDuplicates,
  useMergeDuplicate,
} from "../providers/local/hooks";
import type { DuplicateDonor, DuplicatePair } from "../providers/local/types";
import { formatUsd } from "./donorFormat";

/**
 * "We found this donor twice." Banner + review dialog fed by GET /duplicates.
 * Built from ContactMergeButton's dialog (same Dialog/Alert layout and merge
 * wording), but driven by suggested pairs instead of a contact picker.
 */
export const DuplicateBanner = () => {
  const { data: duplicates } = useDuplicates();
  const [open, setOpen] = useState(false);
  const pending = duplicates ?? [];

  useEffect(() => {
    if (open && pending.length === 0) setOpen(false);
  }, [open, pending.length]);

  if (pending.length === 0) return null;

  return (
    <>
      <div
        role="status"
        className="flex items-center justify-between gap-4 rounded-md border border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100"
      >
        <span className="flex items-center gap-2">
          <AlertTriangle className="h-4 w-4" />
          {pending.length} possible duplicate
          {pending.length === 1 ? "" : "s"} found
        </span>
        <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
          Review merges →
        </Button>
      </div>
      {open && (
        <DuplicateMergeDialog
          pair={pending[0]}
          remaining={pending.length}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
};

const DuplicateMergeDialog = ({
  pair,
  remaining,
  onClose,
}: {
  pair: DuplicatePair;
  remaining: number;
  onClose: () => void;
}) => {
  const notify = useNotify();
  const merge = useMergeDuplicate();
  const dismiss = useDismissDuplicate();
  const isBusy = merge.isPending || dismiss.isPending;
  // Suggest keeping the record with the longer gift history.
  const suggestedKeepId = [...pair.donors].sort(
    (a, b) => b.gift_count - a.gift_count,
  )[0].id;
  const [keepId, setKeepId] = useState(suggestedKeepId);
  useEffect(() => setKeepId(suggestedKeepId), [pair.id, suggestedKeepId]);

  // mutateAsync, not mutate(..., callbacks): merging the last pair closes
  // this dialog, and react-query drops per-call callbacks on unmount.
  const handleMerge = async () => {
    try {
      await merge.mutateAsync({ pairId: pair.id, keepId });
      notify("Donors merged: one record, full gift history", {
        type: "success",
      });
    } catch (error) {
      notify(`Merge failed: ${(error as Error).message}`, { type: "error" });
    }
  };

  const handleKeepSeparate = async () => {
    try {
      await dismiss.mutateAsync(pair.id);
      notify("Kept as separate donors", { type: "info" });
    } catch (error) {
      notify(`Could not dismiss: ${(error as Error).message}`, {
        type: "error",
      });
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl md:min-w-lg">
        <DialogHeader>
          <DialogTitle>We found this donor twice</DialogTitle>
          <DialogDescription className="flex flex-wrap items-center gap-1.5">
            {pair.reasons.map((reason) => (
              <Badge key={reason} variant="outline">
                {reason}
              </Badge>
            ))}
            <span>· {Math.round(pair.confidence * 100)}% match</span>
            {remaining > 1 && <span>· {remaining - 1} more after this one</span>}
          </DialogDescription>
        </DialogHeader>

        <div role="radiogroup" aria-label="Record to keep" className="space-y-2">
          {pair.donors.map((donor) => (
            <DuplicateOption
              key={donor.id}
              donor={donor}
              isKept={donor.id === keepId}
              onSelect={() => setKeepId(donor.id)}
            />
          ))}
        </div>

        <Alert>
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>
            The other record's gifts and emails move to the one you keep, and
            its score is recomputed.
          </AlertDescription>
        </Alert>

        <DialogFooter>
          <Button
            variant="ghost"
            onClick={handleKeepSeparate}
            disabled={isBusy}
          >
            <CircleX />
            Keep separate
          </Button>
          <Button onClick={handleMerge} disabled={isBusy}>
            <Merge />
            {merge.isPending ? "Merging…" : "Merge ✓"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

const DuplicateOption = ({
  donor,
  isKept,
  onSelect,
}: {
  donor: DuplicateDonor;
  isKept: boolean;
  onSelect: () => void;
}) => (
  <button
    type="button"
    role="radio"
    aria-checked={isKept}
    onClick={onSelect}
    className={cn(
      "flex w-full items-center justify-between gap-4 rounded-lg border p-3 text-left text-sm transition-colors",
      isKept
        ? "border-primary bg-primary/5"
        : "border-border hover:bg-muted/50",
    )}
  >
    <span>
      <span className="font-medium">{donor.full_name}</span>
      <span className="ml-2 text-muted-foreground">
        {[donor.email, donor.city].filter(Boolean).join(" · ")}
      </span>
    </span>
    <span className="flex items-center gap-3 whitespace-nowrap">
      <span className="text-muted-foreground">
        {donor.gift_count} gift{donor.gift_count === 1 ? "" : "s"} ·{" "}
        {formatUsd(donor.total_given)}
      </span>
      <span
        className={cn(
          "text-xs font-medium",
          isKept ? "text-primary" : "text-muted-foreground",
        )}
      >
        {isKept ? "Keep" : "Merge in"}
      </span>
    </span>
  </button>
);
