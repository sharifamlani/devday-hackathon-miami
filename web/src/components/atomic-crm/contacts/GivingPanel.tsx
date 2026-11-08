import { useState } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { givingSummary, isCountedGift } from "../providers/local/crmDonors";
import type { DonorDetail } from "../providers/local/types";
import { ProfileSection, Stat } from "./donorCrmUi";
import { formatDay, formatUsd } from "./donorFormat";
import { SampleHistoryBadge } from "./OutreachPanel";

const SHORT_LIST = 5;

/**
 * Giving history: totals from the gifts table, the usual timing score.py
 * found, and every gift. Used on the donor profile and in the drawer
 * (`compact` shows the newest few).
 */
export const GivingPanel = ({
  donor,
  recurring,
  compact = false,
}: {
  donor: DonorDetail;
  recurring?: boolean;
  compact?: boolean;
}) => {
  const [showAll, setShowAll] = useState(false);
  const summary = givingSummary(donor.gifts);
  const gifts = [...donor.gifts].sort((a, b) =>
    b.gift_date.localeCompare(a.gift_date),
  );
  const visible = showAll || !compact ? gifts : gifts.slice(0, SHORT_LIST);
  const timing = [
    donor.usual_cadence ? `Usually gives ${donor.usual_cadence}` : null,
    recurring ? "Recurring donor" : null,
    donor.fund_type ? `${donor.fund_type} fund` : null,
  ].filter(Boolean);

  return (
    <ProfileSection
      title="Giving history"
      caption={timing.length ? timing.join(" · ") : "No usual timing found yet"}
      actions={donor.is_sample ? <SampleHistoryBadge /> : undefined}
    >
      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="Lifetime" value={formatUsd(summary.lifetime)} />
        <Stat label="Largest gift" value={formatUsd(summary.largest)} />
        <Stat
          label="Last gift"
          value={
            summary.last_gift_date ? (
              <>
                {formatUsd(summary.last_gift_amount)}
                <span className="block text-xs font-normal text-muted-foreground">
                  {formatDay(summary.last_gift_date)}
                </span>
              </>
            ) : (
              "None yet"
            )
          }
        />
        <Stat
          label="Gifts"
          value={
            <>
              {summary.count}
              {summary.first_gift_date && (
                <span className="block text-xs font-normal text-muted-foreground">
                  since {formatDay(summary.first_gift_date)}
                </span>
              )}
            </>
          }
        />
      </dl>

      {gifts.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <caption className="sr-only">
              Gifts from {donor.full_name}, newest first
            </caption>
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted-foreground">
                <th scope="col" className="py-1.5 pr-3 font-medium">
                  Date
                </th>
                <th scope="col" className="py-1.5 pr-3 font-medium">
                  How
                </th>
                <th scope="col" className="py-1.5 text-right font-medium">
                  Amount
                </th>
              </tr>
            </thead>
            <tbody>
              {visible.map((gift) => {
                const counted = isCountedGift(gift);
                return (
                  <tr
                    key={gift.id}
                    className={cn(
                      "border-b border-border/60 last:border-0",
                      !counted && "text-muted-foreground",
                    )}
                  >
                    <td className="py-1.5 pr-3 whitespace-nowrap">
                      {formatDay(gift.gift_date)}
                    </td>
                    <td className="py-1.5 pr-3 text-muted-foreground">
                      {[gift.channel, gift.fund_type]
                        .filter(Boolean)
                        .join(" · ") || "Not recorded"}
                    </td>
                    <td className="py-1.5 text-right font-medium tabular-nums">
                      {counted ? (
                        formatUsd(gift.amount)
                      ) : (
                        <span className="inline-flex items-center gap-1.5">
                          <span className="rounded-full bg-alert px-2 py-0.5 text-[11px] font-semibold text-alert-foreground">
                            {gift.status === "failed"
                              ? "Failed"
                              : gift.status === "duplicate"
                                ? "Counted once"
                                : "Declined"}
                          </span>
                          <s
                            aria-label={
                              gift.status === "duplicate"
                                ? `${formatUsd(gift.amount)}, counted once on the merged record`
                                : `${formatUsd(gift.amount)}, not a gift`
                            }
                          >
                            {formatUsd(gift.amount)}
                          </s>
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {compact && gifts.length > SHORT_LIST && (
            <Button
              variant="link"
              size="sm"
              className="px-0"
              onClick={() => setShowAll((v) => !v)}
              aria-expanded={showAll}
            >
              {showAll ? "Show fewer gifts" : `Show all ${gifts.length} gifts`}
            </Button>
          )}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">No gifts on record.</p>
      )}

      {!compact && summary.by_year.length > 1 && (
        <div>
          <h3 className="mb-1 text-xs font-medium text-muted-foreground">
            By year
          </h3>
          <ul className="flex flex-wrap gap-1.5 text-xs">
            {summary.by_year.map((y) => (
              <li key={y.year} className="rounded-full bg-muted px-2.5 py-1">
                <span className="font-medium">{y.year}</span>{" "}
                {formatUsd(y.total)}
                <span className="text-muted-foreground">
                  {" "}
                  · {y.count} gift{y.count === 1 ? "" : "s"}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </ProfileSection>
  );
};
