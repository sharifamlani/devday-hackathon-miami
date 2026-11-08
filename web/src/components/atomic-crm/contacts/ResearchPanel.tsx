import { Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { DATA_MODE } from "../providers/local/config";
import { useEnrichDonor } from "../providers/local/hooks";
import type { DonorDetail } from "../providers/local/types";
import { formatDay } from "./donorFormat";
import { PanelHeading } from "./ScoreWhyPanel";

/**
 * RESEARCH: sourced public facts from the enrich agent (POST /enrich/{id}).
 * The snapshot can't run the agent, so it shows the research saved at export
 * and says so instead of offering a button that would fail.
 */
export const ResearchPanel = ({
  donor,
  className,
}: {
  donor: DonorDetail;
  className?: string;
}) => {
  const enrich = useEnrichDonor(donor.id);
  const live = DATA_MODE === "local";
  return (
    <section
      aria-label="Enrichment"
      className={className ?? "space-y-3 rounded-[22px] bg-surface p-5"}
    >
      <PanelHeading
        title="Enrichment"
        caption="Enrich agent · public, professional sources only"
      >
        {live && (
          <Button
            size="sm"
            variant="outline"
            className="rounded-full border-border bg-card px-4 font-semibold hover:bg-olive focus-visible:outline-2 focus-visible:outline-ring"
            onClick={() => enrich.mutate()}
            disabled={enrich.isPending}
          >
            {enrich.isPending ? <Spinner /> : <Search />}
            {enrich.isPending
              ? "Enriching…"
              : donor.research.length
                ? "Enrich again"
                : "Enrich profile"}
          </Button>
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
        <p className="text-sm text-muted-foreground">
          {enrich.isSuccess
            ? donor.donor_type === "organization"
              ? "No public information found: this looks like a private or fictional organization."
              : "Individuals aren’t researched on the web; add tags by hand."
            : live
              ? "No research yet. Enrich the profile to look up public sources."
              : "No research saved for this donor."}
        </p>
      )}
      {enrich.isError && (
        <p role="alert" className="text-sm text-destructive">
          {enrich.error.message}
        </p>
      )}
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
