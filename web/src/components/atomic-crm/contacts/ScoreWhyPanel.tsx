import type { DonorDetail } from "../providers/local/types";
import { formatDay, formatUsd } from "./donorFormat";

/** WHY: the Python score's inputs, and the model's plain-words reading of them. */
export const ScoreWhyPanel = ({ donor }: { donor: DonorDetail }) => {
  const recentGifts = [...donor.gifts]
    .sort((a, b) => b.gift_date.localeCompare(a.gift_date))
    .slice(0, 6);
  return (
    <section aria-label="Why this donor" className="space-y-3">
      <PanelHeading
        title="Why"
        caption="Score computed in Python from gift history (score.py)"
      />
      <p className="text-sm leading-relaxed">{donor.why}</p>
      {donor.score_factors.length > 0 && (
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-md bg-muted/50 p-3 text-xs">
          {donor.score_factors.map((factor) => (
            <div key={factor.label}>
              <dt className="flex justify-between text-muted-foreground">
                <span>{factor.label}</span>
                <span className="font-medium tabular-nums text-foreground">
                  {factor.points} / {factor.max}
                </span>
              </dt>
              <dd className="mt-0.5 h-1 rounded bg-border">
                <div
                  className="h-1 rounded bg-primary"
                  style={{ width: `${(100 * factor.points) / factor.max}%` }}
                />
              </dd>
              <dd className="mt-0.5 text-muted-foreground">{factor.detail}</dd>
            </div>
          ))}
        </dl>
      )}
      {recentGifts.length > 0 && (
        <div>
          <p className="mb-1 text-xs text-muted-foreground">
            Recent gifts ({donor.gift_count} total ·{" "}
            {formatUsd(donor.total_given)})
          </p>
          <ul className="space-y-0.5 text-xs">
            {recentGifts.map((gift) => (
              <li key={gift.id} className="flex justify-between gap-2">
                <span>{formatDay(gift.gift_date)}</span>
                <span className="text-muted-foreground">
                  {gift.channel ?? "—"}
                </span>
                <span className="font-medium tabular-nums">
                  {formatUsd(gift.amount)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
};

export const PanelHeading = ({
  title,
  caption,
  children,
}: {
  title: string;
  caption: string;
  children?: React.ReactNode;
}) => (
  <div className="flex items-start justify-between gap-2">
    <div>
      <h3 className="text-xs font-bold uppercase tracking-wider">{title}</h3>
      <p className="text-xs text-muted-foreground">{caption}</p>
    </div>
    {children}
  </div>
);
