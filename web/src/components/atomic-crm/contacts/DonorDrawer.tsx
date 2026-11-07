import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { useDonor } from "../providers/local/hooks";
import {
  scoreClass,
  statusClass,
  statusLabel,
  tierLabel,
} from "./donorFormat";
import { OutreachPanel, SampleHistoryBadge } from "./OutreachPanel";
import { ResearchPanel } from "./ResearchPanel";
import { ScoreWhyPanel } from "./ScoreWhyPanel";

/** Right-hand drawer: where the AI's work is visible (why · research · draft). */
export const DonorDrawer = ({
  donorId,
  onClose,
}: {
  donorId: number | null;
  onClose: () => void;
}) => {
  const { data: donor, isPending, error } = useDonor(donorId);
  return (
    <Sheet open={donorId != null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent
        side="right"
        className="w-full overflow-y-auto data-[side=right]:sm:max-w-xl"
      >
        {donor ? (
          <>
            <SheetHeader className="pb-0">
              <div className="flex items-start justify-between gap-4 pr-10">
                <div>
                  <SheetTitle className="text-lg">
                    {donor.is_star && (
                      <span className="mr-1 text-amber-500" aria-label="Star donor">
                        ★
                      </span>
                    )}
                    {donor.full_name}
                  </SheetTitle>
                  <SheetDescription className="flex flex-wrap items-center gap-1.5">
                    <Badge variant="outline">{tierLabel[donor.tier]} donor</Badge>
                    {donor.is_sample && <SampleHistoryBadge />}
                    <span
                      className={cn(
                        "rounded px-1.5 py-0.5 text-xs font-medium",
                        statusClass[donor.status],
                      )}
                    >
                      {statusLabel[donor.status]}
                    </span>
                    <span className="text-xs">
                      {[
                        donor.donor_type === "organization"
                          ? "Organization"
                          : "Individual",
                        donor.fund_type,
                        donor.city,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  </SheetDescription>
                </div>
                <div className="text-right">
                  <div className="text-xs text-muted-foreground">Score</div>
                  <div
                    className={cn(
                      "text-3xl font-bold tabular-nums",
                      scoreClass(donor.score),
                    )}
                  >
                    {donor.score}
                  </div>
                </div>
              </div>
            </SheetHeader>
            <div className="space-y-5 px-4 pb-6">
              <ScoreWhyPanel donor={donor} />
              <Separator />
              <ResearchPanel donor={donor} />
              <Separator />
              <OutreachPanel donor={donor} />
            </div>
          </>
        ) : (
          <div className="space-y-3 p-4">
            <SheetTitle className="sr-only">Donor</SheetTitle>
            {error ? (
              <p role="alert" className="text-sm text-destructive">
                Could not load this donor: {error.message}
              </p>
            ) : (
              isPending && (
                <>
                  <Skeleton className="h-8 w-2/3" />
                  <Skeleton className="h-24 w-full" />
                  <Skeleton className="h-24 w-full" />
                </>
              )
            )}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
};
