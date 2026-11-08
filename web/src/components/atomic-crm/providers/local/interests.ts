import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { call } from "./endpoint";

/* plan.md §21.5: interest tags and enrichment (owner 42, build B1). */

export interface InterestTag {
  slug: string;
  label: string;
  definition: string;
}

export interface PersonInterest {
  tag: string; // a slug from GET /interest-tags
  sub_tag: string | null;
  confidence: number | null; // 0-1 for agent-found tags; null when a person set it
  evidence: string | null;
  source_url: string | null;
  set_by: string; // "agent" | a staff name
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
  contact: Record<string, string | null>; // e.g. {email, phone, employer}
}

export interface AcceptEnrichmentInput {
  fact_ids: (number | string)[];
  tags: string[];
}

/** {saved}: a count, or {facts, interests, contact} counts (docs/ui-integration.md §2). */
export type AcceptEnrichmentResult = {
  saved: number | { facts?: number; interests?: number; contact?: number | boolean };
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
  call<{ removed: true }>(
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
