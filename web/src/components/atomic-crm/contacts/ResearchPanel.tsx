import { Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { useEnrichDonor } from "../providers/local/hooks";
import type { DonorDetail } from "../providers/local/types";
import { formatDay } from "./donorFormat";
import { PanelHeading } from "./ScoreWhyPanel";

/** RESEARCH: sourced public facts from the enrich agent. */
export const ResearchPanel = ({ donor }: { donor: DonorDetail }) => {
  const enrich = useEnrichDonor(donor.id);
  return (
    <section aria-label="Research" className="space-y-3">
      <PanelHeading
        title="Research"
        caption="Enrich agent · public, professional sources only"
      >
        <Button
          size="sm"
          variant="outline"
          onClick={() => enrich.mutate()}
          disabled={enrich.isPending}
        >
          {enrich.isPending ? <Spinner /> : <Search />}
          {enrich.isPending
            ? "Researching…"
            : donor.research.length
              ? "Research again"
              : "Run research"}
        </Button>
      </PanelHeading>
      {donor.research.length > 0 ? (
        <ul className="space-y-2 text-sm">
          {donor.research.map((fact) => (
            <li key={fact.id} className="flex gap-2">
              <span aria-hidden>•</span>
              <span>
                {fact.fact}{" "}
                <SourceLink href={fact.source_url} />
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
            ? "No public facts found for this donor."
            : "No research yet. Run research to look up public sources."}
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
    className="text-xs font-medium text-primary underline underline-offset-2"
  >
    [src]
  </a>
);
