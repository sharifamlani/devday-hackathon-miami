import type { DonorDetail } from "../providers/local/types";
import { formatDay, formatUsd } from "./donorFormat";

/** WHY: the Python score's inputs, and the model's plain-words reading of them. */
export const ScoreWhyPanel = ({ donor }: { donor: DonorDetail }) => {
  const recentGifts = [...donor.gifts]
    .sort((a, b) => b.gift_date.localeCompare(a.gift_date))
    .slice(0, 6);
  return (
    <section aria-label="Why this donor" className="space-y-3 rounded-[22px] bg-surface p-5">
      <PanelHeading
        title="Why"
        caption="Score computed in Python from gift history (score.py)"
      />
      <p className="text-sm leading-relaxed">{donor.why}</p>
      {donor.score_factors.length > 0 && (
        <dl className="grid grid-cols-2 gap-2.5 text-xs">
          {donor.score_factors.map((factor) => (
            <div
              key={factor.label}
              className="rounded-[18px] bg-card p-3 shadow-xs"
            >
              <dt className="flex justify-between gap-2 text-muted-foreground">
                <span>{factor.label}</span>
                <span className="font-medium tabular-nums text-foreground">
                  {factor.points} / {factor.max}
                </span>
              </dt>
              <dd className="mt-1.5 h-1.5 rounded-full bg-olive">
                <div
                  className="h-1.5 rounded-full bg-primary"
                  style={{ width: `${(100 * factor.points) / factor.max}%` }}
                />
              </dd>
              <dd className="mt-1.5 text-muted-foreground">{factor.detail}</dd>
            </div>
          ))}
        </dl>
      )}
      {recentGifts.length > 0 && (
        <div>
          <p className="mb-1.5 text-xs text-muted-foreground">
            Recent gifts ({donor.gift_count} total ·{" "}
            {formatUsd(donor.total_given)})
          </p>
          <ul className="divide-y divide-border rounded-[18px] bg-card px-3 text-xs">
            {recentGifts.map((gift) => (
              <li key={gift.id} className="flex justify-between gap-2 py-1.5">
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
      <h3 className="text-[11px] font-bold uppercase tracking-[0.12em]">
        {title}
      </h3>
      <p className="text-xs text-muted-foreground">{caption}</p>
    </div>
    {children}
  </div>
);
