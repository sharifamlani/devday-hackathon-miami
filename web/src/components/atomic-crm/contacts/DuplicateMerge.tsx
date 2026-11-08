import { useEffect, useState } from "react";
import { AlertTriangle, CircleX, Merge } from "lucide-react";
import { useNotify } from "ra-core";
import { useNavigate } from "react-router";

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
import { sendToAgent } from "../home/agentChat";
import { DATA_MODE } from "../providers/local/config";
import { useAgentRefetch } from "../providers/local/refetch";
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
export const DuplicateBanner = ({ donorId }: { donorId?: number } = {}) => {
  const { data: duplicates } = useDuplicates();
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const refetch = useAgentRefetch();
  // On a donor profile, only the pairs that include this donor.
  const pending = (duplicates ?? []).filter(
    (pair) =>
      donorId == null || pair.donors.some((donor) => donor.id === donorId),
  );

  useEffect(() => {
    if (open && pending.length === 0) setOpen(false);
  }, [open, pending.length]);

  if (pending.length === 0) return null;

  return (
    <>
      <div
        role="status"
        className="flex flex-wrap items-center justify-between gap-3 rounded-[24px] bg-brand-soft px-5 py-3.5 text-sm text-brand-soft-foreground"
      >
        <span className="flex items-center gap-3 font-medium">
          <span className="grid size-9 shrink-0 place-items-center rounded-full bg-card text-brand-soft-foreground">
            <AlertTriangle className="size-[18px]" aria-hidden />
          </span>
          {donorId != null
            ? `This donor may also be on file as ${pending
                .flatMap((pair) => pair.donors)
                .filter((donor) => donor.id !== donorId)
                .map((donor) => donor.full_name)
                .join(", ")}`
            : `${pending.length} possible duplicate${pending.length === 1 ? "" : "s"} found`}
        </span>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            className="min-h-11 rounded-[28px] bg-primary px-5 text-xs font-medium text-primary-foreground hover:bg-primary/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            onClick={() => setOpen(true)}
          >
            Review merges →
          </Button>
          {donorId == null && DATA_MODE === "local" && (
            <Button
              size="sm"
              variant="outline"
              className="min-h-11 rounded-[28px] px-5 text-xs font-medium"
              onClick={() => {
                navigate("/");
                void sendToAgent("Fix the duplicate records", refetch);
              }}
            >
              Ask the agent to fix
            </Button>
          )}
        </div>
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
      <DialogContent className="max-h-[90vh] max-w-2xl gap-0 overflow-y-auto rounded-[26px] border-0 bg-card p-0 md:min-w-lg">
        <DialogHeader className="border-b border-border px-5 py-5 text-left sm:px-7 sm:py-6">
          <DialogTitle className="text-[17px] font-semibold sm:text-[19px]">
            We found this donor twice
          </DialogTitle>
          <DialogDescription className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
            {pair.reasons.map((reason) => (
              <Badge
                key={reason}
                variant="outline"
                className="rounded-[7px] border-0 bg-quiet px-2 py-1 text-[11px] font-medium text-quiet-foreground"
              >
                {reason}
              </Badge>
            ))}
            <span>· {Math.round(pair.confidence * 100)}% match</span>
            {remaining > 1 && (
              <span>· {remaining - 1} more after this one</span>
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="px-5 py-5 sm:px-7 sm:py-6">
          <div
            role="radiogroup"
            aria-label="Record to keep"
            className="grid grid-cols-1 gap-3 sm:grid-cols-2"
          >
            {pair.donors.map((donor) => (
              <DuplicateOption
                key={donor.id}
                donor={donor}
                isKept={donor.id === keepId}
                onSelect={() => setKeepId(donor.id)}
              />
            ))}
          </div>

          <Alert className="mt-4 flex items-start gap-3 rounded-[13px] border-0 bg-quiet px-4 py-3 text-xs leading-relaxed text-quiet-foreground">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
            <AlertDescription className="text-xs leading-relaxed text-quiet-foreground">
              The other record's gifts and emails move to the one you keep, and
              its score is recomputed.
            </AlertDescription>
          </Alert>

          <DialogFooter className="mt-5 flex-wrap justify-end gap-2 sm:flex-row">
            <Button
              variant="ghost"
              className="min-h-11 rounded-[28px] bg-quiet px-5 text-xs font-medium text-foreground hover:bg-olive focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              onClick={handleKeepSeparate}
              disabled={isBusy}
            >
              <CircleX />
              Keep separate
            </Button>
            <Button
              className="min-h-11 rounded-[28px] bg-primary px-5 text-xs font-medium text-primary-foreground hover:bg-primary/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              onClick={handleMerge}
              disabled={isBusy}
            >
              <Merge />
              {merge.isPending ? "Merging…" : "Merge ✓"}
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
};

const FieldLabel = ({ children }: { children: React.ReactNode }) => (
  <span className="mb-0.5 block text-[10px] font-medium uppercase tracking-[0.6px] text-muted-foreground">
    {children}
  </span>
);

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
      "flex min-h-11 w-full flex-col gap-3 rounded-[13px] border-2 p-3.5 text-left text-xs leading-relaxed [overflow-wrap:anywhere] transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
      isKept
        ? "border-primary bg-card"
        : "border-transparent bg-surface hover:bg-olive",
    )}
  >
    <span className="flex items-center justify-between gap-2">
      <span className="text-sm font-semibold">{donor.full_name}</span>
      <span
        className={cn(
          "shrink-0 rounded-[7px] px-2 py-1 text-[11px] font-medium",
          isKept
            ? "bg-primary text-primary-foreground"
            : "bg-quiet text-quiet-foreground",
        )}
      >
        {isKept ? "✓ Keep" : "Merge in"}
      </span>
    </span>
    <span>
      <FieldLabel>Email</FieldLabel>
      {donor.email || "—"}
    </span>
    <span>
      <FieldLabel>City</FieldLabel>
      {donor.city || "—"}
    </span>
    <span>
      <FieldLabel>Giving</FieldLabel>
      {donor.gift_count} gift{donor.gift_count === 1 ? "" : "s"} ·{" "}
      {formatUsd(donor.total_given)}
    </span>
  </button>
);
