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
    <section aria-label="Research" className="space-y-3 rounded-[22px] bg-surface p-5">
      <PanelHeading
        title="Research"
        caption="Enrich agent · public, professional sources only"
      >
        <Button
          size="sm"
          variant="outline"
          className="rounded-full border-border bg-card px-4 font-semibold hover:bg-olive focus-visible:outline-2 focus-visible:outline-ring"
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
            <li
              key={fact.id}
              className="flex gap-2 rounded-[18px] bg-card px-3.5 py-2.5"
            >
              <span aria-hidden className="text-brand-soft-foreground">
                •
              </span>
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

/** A sample://<persona>/<slug> source is an invented SAMPLE fact: labelled, never linked. */
export const SourceLink = ({ href }: { href: string }) =>
  href.startsWith("sample://") ? (
    <span
      title="Invented sample fact for the demo: there is no source page."
      className="rounded-full bg-brand-soft px-2 py-0.5 text-xs font-semibold text-brand-soft-foreground"
    >
      sample
    </span>
  ) : (
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
