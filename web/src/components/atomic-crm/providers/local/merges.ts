import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { call } from "./endpoint";
import { refetchAfterAgent } from "./refetch";

/*
 * Automatic merges (#125, Sharif: exact matches merge on upload, staff can
 * review). A person with auto_merged shows a "!"; its popover lists the source
 * records and offers Keep merged or Split back.
 */

/** One record the automatic merge joined (GET /people/{id}/merges). */
export interface MergeSource {
  name: string;
  email: string | null;
  phone: string | null;
  files: string[]; // "event_signin_sheet_nov1.xlsx"
  locations: string[]; // "file: sheet:...:row 4"
  gift_ids: number[];
  gift_count: number;
  survivor: boolean; // the record the others were merged into
  rule: string | null; // why they matched, e.g. "same email"
}

export interface AutoMerge {
  id: number;
  sources: MergeSource[];
  reviewed_at: string | null;
  review_action: "keep" | "split" | null;
}

export interface PersonMerges {
  person_id: number;
  auto_merged: boolean;
  merged_from: number;
  merges: AutoMerge[];
}

export type MergeReview = "keep" | "split";

export interface MergeReviewResult {
  action: MergeReview;
  restored: { id: number; full_name: string }[];
}

export const mergeKeys = {
  person: (id: number) => ["donor-desk", "people", "merges", id] as const,
};

/** Live: the API. Vercel snapshot: snapshot.json's auto_merges (masked, read-only; Keep/Split stay live-only). */
export const getPersonMerges = (personId: number) =>
  call<PersonMerges>("Merge review", "GET", `/people/${personId}/merges`, {
    snapshot: (snap) =>
      (snap.auto_merges as Record<string, PersonMerges> | undefined)?.[String(personId)],
  });

export const reviewMerge = (personId: number, action: MergeReview) =>
  call<MergeReviewResult>(
    action === "split" ? "Splitting a merge" : "Keeping a merge",
    "POST",
    `/people/${personId}/merges/review`,
    { body: { action } },
  );

/** The source records behind one person's "!" (loaded when the popover opens). */
export const usePersonMerges = (personId: number, enabled: boolean) =>
  useQuery({
    queryKey: mergeKeys.person(personId),
    queryFn: () => getPersonMerges(personId),
    enabled,
  });

/** Keep clears the "!"; Split restores the people. Either way people, summary and tasks refetch. */
export const useReviewMerge = (personId: number) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (action: MergeReview) => reviewMerge(personId, action),
    onSuccess: () =>
      Promise.all([
        refetchAfterAgent(queryClient, ["people", "summary", "tasks"]),
        // The Givers list and the profile page read through ra-core's "contacts" keys.
        queryClient.invalidateQueries({ queryKey: ["contacts"] }),
      ]),
  });
};
