import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { call } from "./endpoint";

/* plan.md §21.5: interest tags and enrichment (owner 42, build B1). */

export interface InterestTag {
  slug: string;
  label: string;
  definition: string;
}

/** How sure the agent is (docs/research/interest-areas.md §3); staff-set tags come back "high". */
export type InterestConfidence = "high" | "medium" | "low";

export interface PersonInterest {
  tag: string; // one of the 17 slugs from GET /interest-tags
  sub_tag: string | null;
  confidence: InterestConfidence | null;
  evidence: string | null;
  source_url: string | null; // always set for agent tags; null for staff tags
  set_by?: string; // "agent" | "staff"; absent on dry-run proposals (all agent-found)
  label?: string; // the tag's label, when the service includes it
  source_type?: string | null; // board_seat, named_gift, statement, ...
}

export interface EnrichFact {
  id: number | string;
  fact: string;
  source_url: string;
  retrieved_at?: string | null;
}

/** POST /enrich/{id}?dry_run=1: what enrichment found; nothing is written. */
export interface EnrichPreview {
  facts: EnrichFact[];
  interests: PersonInterest[];
  contact: Record<string, unknown>; // {website, public_phone, employer, location, source_urls, ...}
  /** confirmed | probable | ambiguous | not_found, or not_researched for individuals */
  identity_match?: string;
  /** What matched; ["name"] alone means a name-only match (shown as ambiguous, with the service's note). */
  identity_basis?: string[];
  notes?: string | null; // e.g. "individual donors are not researched in the demo"
}

export interface AcceptEnrichmentInput {
  fact_ids: (number | string)[];
  tags: string[];
}

/** {saved}: a count, or {facts, interests, contact} (docs/ui-integration.md §2). */
export type AcceptEnrichmentResult = {
  saved:
    | number
    | {
        facts?: number;
        interests?: number;
        contact?: unknown; // echoed for display; never stored (contact_persisted: false)
        skipped_staff_tags?: string[]; // tags staff set or removed: the agent never overrides them
      };
  undo?: string;
};

export const interestKeys = {
  tags: ["donor-desk", "interest-tags"] as const,
  person: (id: number) => ["donor-desk", "interests", id] as const,
  all: ["donor-desk", "interests"] as const,
};

/* ---------- API ---------- */

export const getInterestTags = () =>
  call<InterestTag[]>("Interest tags", "GET", "/interest-tags", { snapshotValue: [] });

export const getPersonInterests = (personId: number) =>
  call<PersonInterest[]>("Interests", "GET", `/people/${personId}/interests`, { snapshotValue: [] });

export const addInterest = (personId: number, input: { tag: string; sub_tag?: string | null }) =>
  call<PersonInterest[]>("Adding an interest", "POST", `/people/${personId}/interests`, { body: input });

/** The row is kept (marked removed); the response says so. */
export const removeInterest = (personId: number, tag: string) =>
  call<{ removed: boolean; undo?: string }>(
    "Removing an interest",
    "DELETE",
    `/people/${personId}/interests/${encodeURIComponent(tag)}`,
  );

export const enrichPreview = (personId: number) =>
  call<EnrichPreview>("Enrichment", "POST", `/enrich/${personId}?dry_run=1`);

export const acceptEnrichment = (personId: number, input: AcceptEnrichmentInput) =>
  call<AcceptEnrichmentResult>("Saving enrichment", "POST", `/people/${personId}/enrichment/accept`, {
    body: input,
  });

/* ---------- Hooks ---------- */

export const useInterestTags = () =>
  useQuery({ queryKey: interestKeys.tags, queryFn: getInterestTags, staleTime: Infinity });

export const usePersonInterests = (personId: number | null) =>
  useQuery({
    queryKey: interestKeys.person(personId ?? -1),
    queryFn: () => getPersonInterests(personId as number),
    enabled: personId != null,
  });

const useRefreshPerson = () => {
  const queryClient = useQueryClient();
  return (personId: number) =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: interestKeys.person(personId) }),
      queryClient.invalidateQueries({ queryKey: ["donor-desk", "donor", personId] }),
      queryClient.invalidateQueries({ queryKey: ["donor-desk", "people"] }),
    ]);
};

export const useAddInterest = () => {
  const refresh = useRefreshPerson();
  return useMutation({
    mutationFn: ({ personId, tag, sub_tag }: { personId: number; tag: string; sub_tag?: string | null }) =>
      addInterest(personId, { tag, sub_tag }),
    onSuccess: (_data, { personId }) => refresh(personId),
  });
};

export const useRemoveInterest = () => {
  const refresh = useRefreshPerson();
  return useMutation({
    mutationFn: ({ personId, tag }: { personId: number; tag: string }) => removeInterest(personId, tag),
    onSuccess: (_data, { personId }) => refresh(personId),
  });
};

/** Enrich → preview (a mutation: it runs the agent; nothing is saved). */
export const useEnrichPreview = () =>
  useMutation({ mutationFn: (personId: number) => enrichPreview(personId) });

/** Enrich → Save: only the facts and tags the person ticked. */
export const useAcceptEnrichment = () => {
  const refresh = useRefreshPerson();
  return useMutation({
    mutationFn: ({ personId, ...input }: AcceptEnrichmentInput & { personId: number }) =>
      acceptEnrichment(personId, input),
    onSuccess: (_data, { personId }) => refresh(personId),
  });
};
