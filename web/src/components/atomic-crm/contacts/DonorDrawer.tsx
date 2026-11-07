import { Badge } from "@/components/ui/badge";
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

const initialsOf = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");

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
        className="w-full overflow-y-auto bg-card data-[side=right]:sm:max-w-xl"
      >
        {donor ? (
          <>
            <SheetHeader className="border-b border-border bg-surface px-6 pb-5 pt-6">
              <div className="flex items-start justify-between gap-4 pr-10">
                <div
                  aria-hidden
                  className="flex size-12 shrink-0 items-center justify-center rounded-full bg-brand text-base font-bold text-brand-foreground"
                >
                  {initialsOf(donor.full_name)}
                </div>
                <div className="min-w-0 flex-1">
                  <SheetTitle className="text-xl font-bold tracking-tight">
                    {donor.is_star && (
                      <span className="mr-1 text-brand-soft-foreground"
                        aria-label="Star donor">
                        ★
                      </span>
                    )}
                    {donor.full_name}
                  </SheetTitle>
                  <SheetDescription className="mt-1 flex flex-wrap items-center gap-1.5">
                    <Badge
                      variant="outline"
                      className="rounded-full border-border bg-card px-2.5 text-muted-foreground"
                    >
                      {tierLabel[donor.tier]} donor
                    </Badge>
                    {donor.is_sample && <SampleHistoryBadge />}
                    <span
                      className={cn(
                        "rounded-full px-2.5 py-0.5 text-xs font-semibold",
                        statusClass[donor.status],
                      )}
                    >
                      {statusLabel[donor.status]}
                    </span>
                    <span className="text-xs text-muted-foreground">
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
                  <div className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                    Score
                  </div>
                  <div
                    className={cn(
                      "text-4xl font-bold leading-none tabular-nums",
                      scoreClass(donor.score),
                    )}
                  >
                    {donor.score}
                  </div>
                </div>
              </div>
            </SheetHeader>
            <div className="space-y-4 px-5 pb-8 pt-5">
              <ScoreWhyPanel donor={donor} />
              <ResearchPanel donor={donor} />
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
