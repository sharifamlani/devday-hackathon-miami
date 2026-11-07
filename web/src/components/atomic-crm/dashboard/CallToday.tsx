import { useState } from "react";
import { ChevronRight } from "lucide-react";

import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { DonorDrawer } from "../contacts/DonorDrawer";
import {
  formatMonthYear,
  formatUsd,
  scoreClass,
  statusClass,
  statusLabel,
  tierLabel,
} from "../contacts/donorFormat";
import { DuplicateBanner } from "../contacts/DuplicateMerge";
import { useDonors } from "../providers/local/hooks";

/** Home screen: every donor, ranked by propensity score, highest first. */
export const CallToday = () => {
  const { data: donors, isPending, error } = useDonors();
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const ranked = [...(donors ?? [])].sort((a, b) => b.score - a.score);

  return (
    <div className="space-y-4 pt-2">
      <DuplicateBanner />
      <div>
        <h2 className="text-2xl font-semibold">Call today</h2>
        <p className="text-sm text-muted-foreground">
          Ranked by propensity: recency, frequency, amount and the gap since
          each donor's usual gift. Click a donor to see why, research and a
          draft.
        </p>
      </div>

      {error ? (
        <p role="alert" className="text-sm text-destructive">
          Could not load donors: {error.message}
        </p>
      ) : isPending ? (
        <div className="space-y-2">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      ) : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">#</TableHead>
                <TableHead>Donor</TableHead>
                <TableHead>Tier</TableHead>
                <TableHead>Last gift</TableHead>
                <TableHead>Usual</TableHead>
                <TableHead className="text-right">Score</TableHead>
                <TableHead>Why</TableHead>
                <TableHead className="w-8">
                  <span className="sr-only">Open</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {ranked.map((donor, index) => (
                <TableRow
                  key={donor.id}
                  onClick={() => setSelectedId(donor.id)}
                  className="cursor-pointer"
                  data-donor-id={donor.id}
                >
                  <TableCell className="text-muted-foreground tabular-nums">
                    {index + 1}
                  </TableCell>
                  <TableCell className="font-medium">
                    {donor.is_star && (
                      <span className="mr-1 text-amber-500" aria-label="Star donor">
                        ★
                      </span>
                    )}
                    {donor.full_name}
                  </TableCell>
                  <TableCell>{tierLabel[donor.tier]}</TableCell>
                  <TableCell>
                    {formatMonthYear(donor.last_gift_date)}
                    <span className="ml-1 text-xs text-muted-foreground">
                      {formatUsd(donor.last_gift_amount)}
                    </span>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {donor.usual_cadence ?? "—"}
                  </TableCell>
                  <TableCell
                    className={cn(
                      "text-right text-base font-bold tabular-nums",
                      scoreClass(donor.score),
                    )}
                  >
                    {donor.score}
                  </TableCell>
                  <TableCell className="max-w-80 whitespace-normal">
                    <span
                      className={cn(
                        "mr-2 rounded px-1.5 py-0.5 text-xs font-medium",
                        statusClass[donor.status],
                      )}
                    >
                      {statusLabel[donor.status]}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {donor.why_short}
                    </span>
                  </TableCell>
                  <TableCell>
                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      <DonorDrawer donorId={selectedId} onClose={() => setSelectedId(null)} />
    </div>
  );
};
