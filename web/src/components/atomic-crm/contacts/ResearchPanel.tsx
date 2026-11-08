import { Check, Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { DATA_MODE, PUBLIC_READ_ONLY } from "../providers/local/config";
import type { DonorDetail } from "../providers/local/types";
import { formatDay } from "./donorFormat";
import { ENRICH_COPY, EnrichProposal, useEnrichReview } from "./EnrichReview";
import { PanelHeading } from "./ScoreWhyPanel";

/**
 * RESEARCH: sourced public facts from the enrich agent. Enrich proposes (dry run: nothing is written),
 * staff review the facts and interest tags, and "Save to profile" writes only what they kept: the same
 * flow as the home's Find a donor dialog. Organizations only. The snapshot can't run the agent, so it
 * shows the research saved at export and says so instead of offering a button that would fail.
 */
export const ResearchPanel = ({
  donor,
  className,
}: {
  donor: DonorDetail;
  className?: string;
}) => {
  const review = useEnrichReview(donor);
  const { isOrg, found, preview, accept, picked } = review;
  const live = DATA_MODE === "local" && !PUBLIC_READ_ONLY; // public mode refuses /enrich*
  return (
    <section
      aria-label="Enrichment"
      className={className ?? "space-y-3 rounded-[22px] bg-surface p-5"}
    >
      <PanelHeading
        title="Enrichment"
        caption="Enrich agent · public, professional sources only"
      >
        {live && isOrg && found ? (
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="ghost"
              className="rounded-full px-3 font-semibold focus-visible:outline-2 focus-visible:outline-ring"
              onClick={review.discard}
              disabled={accept.isPending}
            >
              Discard
            </Button>
            <Button
              size="sm"
              className="rounded-full px-4 font-semibold focus-visible:outline-2 focus-visible:outline-ring"
              onClick={review.save}
              disabled={accept.isPending || picked === 0}
            >
              {accept.isPending ? <Spinner /> : <Check />}
              {accept.isPending ? "Saving…" : "Save to profile"}
            </Button>
          </div>
        ) : (
          live &&
          isOrg && (
            <Button
              size="sm"
              variant="outline"
              className="rounded-full border-border bg-card px-4 font-semibold hover:bg-olive focus-visible:outline-2 focus-visible:outline-ring"
              onClick={review.run}
              disabled={preview.isPending}
            >
              {preview.isPending ? <Spinner /> : <Search />}
              {preview.isPending
                ? "Enriching…"
                : donor.research.length
                  ? "Enrich again"
                  : "Enrich profile"}
            </Button>
          )
        )}
      </PanelHeading>
      {!live && (
        <p className="rounded-xl bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
          Enrichment runs on the live service. This sample shows research saved
          earlier
          {donor.research.length ? "" : ", and there is none for this donor"}.
        </p>
      )}
      {donor.research.length > 0 ? (
        <ul className="space-y-2 text-sm">
          {donor.research.map((fact) => (
            <li
              key={fact.id}
              className="flex gap-2 rounded-[18px] bg-card px-3.5 py-2.5"
            >
              <span aria-hidden className="text-brand-soft-foreground">
                •
              </span>
              <span>
                {fact.fact} <SourceLink href={fact.source_url} />
                <span className="ml-1 text-xs text-muted-foreground">
                  retrieved {formatDay(fact.retrieved_at)}
                </span>
              </span>
            </li>
          ))}
        </ul>
      ) : (
        !review.proposal && (
          <p className="text-sm text-muted-foreground">
            {live && !isOrg
              ? ENRICH_COPY.individual
              : live
                ? "No research yet. Enrich the profile to look up public sources."
                : "No research saved for this donor."}
          </p>
        )
      )}
      <EnrichProposal review={review} />
    </section>
  );
};

export const SourceLink = ({ href }: { href: string }) => (
  <a
    href={href}
    target="_blank"
    rel="noreferrer"
    title={href}
    className="rounded-sm text-xs font-semibold text-primary underline underline-offset-2 hover:decoration-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
  >
    [src]
  </a>
);
