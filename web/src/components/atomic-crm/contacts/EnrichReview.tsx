import { useState } from "react";
import { Check } from "lucide-react";

import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import {
  type EnrichPreview,
  useAcceptEnrichment,
  useEnrichPreview,
} from "../providers/local/interests";
import type { DonorDetail } from "../providers/local/types";
import { InterestChip, tagLabel, useTagLabels } from "./InterestChips";
import { SourceLink } from "./ResearchPanel";

/* Enrich → review → Save to profile, shared by the home's Find a donor dialog and the profile's
   Enrichment panel: the agent proposes (POST /enrich/{id}?dry_run=1, nothing written), staff tick
   what to keep, and Save writes only that (POST /people/{id}/enrichment/accept). */

export const ENRICH_COPY = {
  noInfo: "No public information found: this looks like a private or fictional organization.",
  individual: "Individuals aren’t researched on the web; add tags by hand.",
  ambiguous: "More than one organization matched this name, so nothing was suggested.",
};

export const enrichBox = "rounded-xl border-l-4 border-brand bg-surface px-3.5 py-2.5 text-sm";

const contactLine = (contact: EnrichPreview["contact"]) => {
  const c = contact as Record<string, unknown>;
  const website =
    typeof c.website === "string" ? c.website.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "") : null;
  return [website, c.public_phone, c.public_email].filter(
    (v): v is string => typeof v === "string" && v.length > 0,
  );
};

const toggled = (set: Set<string>, key: string) => {
  const next = new Set(set);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  return next;
};

export const useEnrichReview = (donor: DonorDetail) => {
  const preview = useEnrichPreview();
  const accept = useAcceptEnrichment();
  const [facts, setFacts] = useState<Set<string>>(new Set());
  const [tags, setTags] = useState<Set<string>>(new Set());
  const [saved, setSaved] = useState<string | null>(null);
  const proposal = preview.data;
  const found = !!proposal && (proposal.facts.length > 0 || proposal.interests.length > 0);

  const run = () => {
    setSaved(null);
    accept.reset();
    preview.mutate(donor.id, {
      onSuccess: (p) => {
        setFacts(new Set(p.facts.map((f) => String(f.id))));
        setTags(new Set(p.interests.map((i) => i.tag)));
      },
    });
  };

  const save = () => {
    if (!proposal) return;
    accept.mutate(
      {
        personId: donor.id,
        fact_ids: proposal.facts.filter((f) => facts.has(String(f.id))).map((f) => f.id),
        tags: [...tags],
      },
      {
        onSuccess: (res) => {
          const s = typeof res.saved === "number" ? { facts: res.saved } : res.saved;
          const parts = [
            s.facts ? `${s.facts} ${s.facts === 1 ? "fact" : "facts"}` : null,
            s.interests ? `${s.interests} interest ${s.interests === 1 ? "area" : "areas"}` : null,
          ].filter(Boolean);
          const skipped = "skipped_staff_tags" in s ? s.skipped_staff_tags?.length ?? 0 : 0;
          setSaved(
            `${parts.length ? `Saved ${parts.join(" and ")} to the profile.` : "Nothing new to save."}` +
              (skipped ? ` Kept your team’s choice for ${skipped === 1 ? "1 tag" : `${skipped} tags`}.` : ""),
          );
          preview.reset();
        },
      },
    );
  };

  return {
    donor,
    isOrg: donor.donor_type === "organization",
    preview,
    accept,
    proposal,
    found,
    facts,
    tags,
    saved,
    picked: facts.size + tags.size,
    toggleFact: (id: string) => setFacts((s) => toggled(s, id)),
    toggleTag: (tag: string) => setTags((s) => toggled(s, tag)),
    run,
    save,
  };
};

export type EnrichReviewState = ReturnType<typeof useEnrichReview>;

/** The proposal under review, plus the searching / nothing found / saved / error states. */
export const EnrichProposal = ({ review }: { review: EnrichReviewState }) => {
  const labels = useTagLabels();
  const { donor, preview, accept, proposal, found, facts, tags, saved } = review;
  const contact = proposal ? contactLine(proposal.contact) : [];
  return (
    <>
      {preview.isPending && (
        <p className={cn(enrichBox, "flex items-center gap-2")} aria-live="polite">
          <Spinner /> Searching public sources for {donor.full_name}…
        </p>
      )}
      {proposal && !found && (
        <p className={cn(enrichBox, "text-muted-foreground")} aria-live="polite">
          {proposal.identity_match === "not_researched"
            ? ENRICH_COPY.individual
            : proposal.identity_match === "ambiguous"
              ? ENRICH_COPY.ambiguous
              : ENRICH_COPY.noInfo}
        </p>
      )}
      {proposal && found && (
        <section className={enrichBox} aria-label="Enrichment suggestions">
          <p className="font-semibold">Enrichment agent found (public web, review before saving):</p>
          {proposal.interests.length > 0 && (
            <>
              <p className="mt-2 text-xs font-semibold text-muted-foreground">Interest areas</p>
              <ul className="mt-1 flex flex-wrap gap-1.5" aria-label="Suggested interest areas">
                {proposal.interests.map((interest) => (
                  <InterestChip
                    key={`${interest.tag}:${interest.sub_tag ?? ""}`}
                    interest={interest}
                    label={tagLabel(interest, labels)}
                    selected={tags.has(interest.tag)}
                    onToggle={() => review.toggleTag(interest.tag)}
                  />
                ))}
              </ul>
            </>
          )}
          {proposal.facts.length > 0 && (
            <>
              <p className="mt-2 text-xs font-semibold text-muted-foreground">Facts</p>
              <ul className="mt-1 grid gap-1.5">
                {proposal.facts.map((fact) => {
                  const id = String(fact.id);
                  const inputId = `fact-${donor.id}-${id}`;
                  return (
                    <li key={id} className="flex items-start gap-2">
                      <input
                        type="checkbox"
                        id={inputId}
                        checked={facts.has(id)}
                        onChange={() => review.toggleFact(id)}
                        className="mt-1 size-4 shrink-0 accent-foreground"
                      />
                      <label htmlFor={inputId} className={cn(!facts.has(id) && "text-muted-foreground line-through")}>
                        {fact.fact}
                      </label>
                      <SourceLink href={fact.source_url} />
                    </li>
                  );
                })}
              </ul>
            </>
          )}
          {contact.length > 0 && (
            <p className="mt-2 text-xs text-muted-foreground">
              Public contact (shown only, not saved): {contact.join(" · ")}
            </p>
          )}
        </section>
      )}
      {saved && (
        <p className="flex items-center gap-1.5 text-sm font-medium" role="status">
          <Check className="size-4" aria-hidden="true" /> {saved}
        </p>
      )}
      {(preview.isError || accept.isError) && (
        <p role="alert" className="text-sm text-alert-foreground">
          {(preview.error ?? accept.error)?.message}
        </p>
      )}
    </>
  );
};
