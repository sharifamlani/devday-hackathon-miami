import { useId, useState } from "react";
import { Check, Plus, X } from "lucide-react";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import {
  type InterestConfidence,
  type PersonInterest,
  useAddInterest,
  useInterestTags,
  usePersonInterests,
  useRemoveInterest,
} from "../providers/local/interests";
import { SourceLink } from "./ResearchPanel";

/* Interest areas (plan §21.2.6): 17 tags, each with confidence, evidence and a source.
   Chips open a popover rather than a hover tooltip, so the source link stays clickable
   and works with a keyboard or a finger. */

export const confidenceLabel: Record<InterestConfidence, string> = {
  high: "High",
  medium: "Medium",
  low: "Low",
};

const confidenceDot: Record<InterestConfidence, string> = {
  high: "bg-good-foreground",
  medium: "bg-brand",
  low: "bg-muted-foreground/50",
};

const chipBase =
  "inline-flex min-h-9 items-center gap-1.5 rounded-full px-3 text-xs font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

export const tagLabel = (interest: PersonInterest, labels: Map<string, string>) =>
  interest.label ?? labels.get(interest.tag) ?? interest.tag.replace(/_/g, " ");

export const useTagLabels = () => {
  const { data } = useInterestTags();
  return new Map((data ?? []).map((t) => [t.slug, t.label]));
};

const subTag = (s: string | null) => (s ? s.replace(/_/g, " ") : null);

/** Agent-found unless staff set it (dry-run proposals carry no set_by: they all come from the agent). */
const byAgent = (interest: PersonInterest) => interest.set_by !== "staff";

/** What a chip's popover says: who set it, how sure, the evidence and its source. */
const InterestDetails = ({ interest, label }: { interest: PersonInterest; label: string }) => (
  <div className="grid gap-1.5">
    <p className="font-semibold">
      {label}
      {interest.sub_tag && <span className="font-normal text-muted-foreground"> · {subTag(interest.sub_tag)}</span>}
    </p>
    <p className="text-xs text-muted-foreground">
      {byAgent(interest)
        ? `Found by the enrichment agent · ${confidenceLabel[interest.confidence ?? "low"]} confidence`
        : "Added by your team"}
    </p>
    {interest.evidence && <p className="text-sm">“{interest.evidence}”</p>}
    {interest.source_url && (
      <p className="text-xs">
        Source: <SourceLink href={interest.source_url} />{" "}
        <span className="break-all text-muted-foreground">{new URL(interest.source_url).hostname}</span>
      </p>
    )}
  </div>
);

/** One interest chip: label + confidence; click for evidence and source. */
export const InterestChip = ({
  interest,
  label,
  selected,
  onToggle,
  onRemove,
  removing,
}: {
  interest: PersonInterest;
  label: string;
  /** Review mode (Enrich): the chip can be ticked in or out before saving. */
  selected?: boolean;
  onToggle?: () => void;
  /** Profile mode: staff can remove the tag. */
  onRemove?: () => void;
  removing?: boolean;
}) => {
  const confidence = interest.confidence ?? "low";
  const reviewing = onToggle != null;
  return (
    <li
      className={cn(
        "inline-flex items-center rounded-full",
        reviewing && !selected ? "bg-surface text-muted-foreground line-through" : "bg-quiet text-quiet-foreground",
      )}
    >
      {reviewing && (
        <button
          type="button"
          role="checkbox"
          aria-checked={selected}
          aria-label={`${selected ? "Keep" : "Skip"} ${label}`}
          onClick={onToggle}
          className={cn(chipBase, "pr-0.5 pl-2")}
        >
          <span
            aria-hidden
            className={cn(
              "grid size-4 place-items-center rounded-full border",
              selected ? "border-foreground bg-foreground text-background" : "border-muted-foreground",
            )}
          >
            {selected && <Check className="size-3" />}
          </span>
        </button>
      )}
      <Popover>
        <PopoverTrigger className={cn(chipBase, reviewing ? "pl-1" : "")} aria-label={`${label}: details and source`}>
          <span aria-hidden className={cn("size-2 rounded-full", confidenceDot[confidence])} />
          {label}
          {byAgent(interest) && (
            <span className="font-normal opacity-75">· {confidenceLabel[confidence]}</span>
          )}
        </PopoverTrigger>
        <PopoverContent align="start" className="w-80">
          <InterestDetails interest={interest} label={label} />
        </PopoverContent>
      </Popover>
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          disabled={removing}
          aria-label={`Remove ${label}`}
          className={cn(chipBase, "-ml-1 px-2 hover:text-foreground disabled:opacity-50")}
        >
          <X className="size-3.5" aria-hidden />
        </button>
      )}
    </li>
  );
};

/** Read-only chips for a person's saved tags (the donor drawer); nothing when there are none. */
export const SavedInterestChips = ({ personId }: { personId: number }) => {
  const { data: interests } = usePersonInterests(personId);
  const labels = useTagLabels();
  if (!interests?.length) return null;
  return (
    <div className="grid gap-1.5">
      <p className="text-sm text-muted-foreground">Interest areas</p>
      <ul className="flex flex-wrap gap-1.5" aria-label="Interest areas">
        {interests.map((interest) => (
          <InterestChip
            key={`${interest.tag}:${interest.sub_tag ?? ""}`}
            interest={interest}
            label={tagLabel(interest, labels)}
          />
        ))}
      </ul>
    </div>
  );
};

/** The donor profile's interest areas: the saved tags, with staff add and remove. */
export const InterestAreasEditor = ({ personId }: { personId: number }) => {
  const { data: interests, isPending, error } = usePersonInterests(personId);
  const { data: tags } = useInterestTags();
  const labels = new Map((tags ?? []).map((t) => [t.slug, t.label]));
  const add = useAddInterest();
  const remove = useRemoveInterest();
  const [choice, setChoice] = useState("");
  const selectId = useId();

  if (error) return <p role="alert" className="text-sm text-destructive">Couldn’t load interest areas: {error.message}</p>;
  if (isPending) return <p className="text-sm text-muted-foreground">Loading interest areas…</p>;

  const present = new Set((interests ?? []).map((i) => i.tag));
  const available = (tags ?? []).filter((t) => !present.has(t.slug));
  const busy = add.isPending || remove.isPending;

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-3">
      {interests && interests.length > 0 ? (
        <ul className="flex flex-wrap gap-1.5" aria-label="Interest areas">
          {interests.map((interest) => (
            <InterestChip
              key={`${interest.tag}:${interest.sub_tag ?? ""}`}
              interest={interest}
              label={tagLabel(interest, labels)}
              removing={busy}
              onRemove={() => remove.mutate({ personId, tag: interest.tag })}
            />
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">
          None yet. Enrich an organization, or add one your team knows about.
        </p>
      )}
      {available.length > 0 && (
        <form
          className="flex min-w-0 items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (choice) add.mutate({ personId, tag: choice }, { onSuccess: () => setChoice("") });
          }}
        >
          <label htmlFor={selectId} className="sr-only">
            Add an interest area
          </label>
          <select
            id={selectId}
            value={choice}
            onChange={(e) => setChoice(e.target.value)}
            className="min-h-9 min-w-0 flex-1 rounded-full border border-border bg-card px-3 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            <option value="">Add an interest area…</option>
            {available.map((t) => (
              <option key={t.slug} value={t.slug} title={t.definition}>
                {t.label}
              </option>
            ))}
          </select>
          <button
            type="submit"
            disabled={!choice || busy}
            className={cn(chipBase, "bg-primary text-primary-foreground hover:bg-primary/85 disabled:opacity-50")}
          >
            <Plus className="size-3.5" aria-hidden />
            Add
          </button>
        </form>
      )}
      {(add.isError || remove.isError) && (
        <p role="alert" className="text-sm text-destructive">
          {(add.error ?? remove.error)?.message}
        </p>
      )}
      <p className="text-xs text-muted-foreground">
        Tags your team adds or removes are never changed by the agent.
      </p>
    </div>
  );
};
