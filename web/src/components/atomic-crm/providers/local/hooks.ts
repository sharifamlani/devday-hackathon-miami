import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useDonorDesk } from "./index";
import type { UploadTarget } from "./crmTypes";
import type { ContextRunInput } from "./types";

const ROOT = "donor-desk";

export const donorDeskKeys = {
  all: [ROOT] as const,
  donors: [ROOT, "donors"] as const,
  donor: (id: number) => [ROOT, "donor", id] as const,
  duplicates: [ROOT, "duplicates"] as const,
  icp: [ROOT, "icp"] as const,
  prospects: [ROOT, "prospects"] as const,
  prospect: (id: number) => [ROOT, "prospect", id] as const,
  context: [ROOT, "context"] as const,
  orgProfile: [ROOT, "org-profile"] as const,
};

export const useDonors = () => {
  const dataProvider = useDonorDesk();
  return useQuery({
    queryKey: donorDeskKeys.donors,
    queryFn: () => dataProvider.getDonors(),
  });
};

export const useDonor = (id: number | null) => {
  const dataProvider = useDonorDesk();
  return useQuery({
    queryKey: donorDeskKeys.donor(id ?? -1),
    queryFn: () => dataProvider.getDonor(id as number),
    enabled: id != null,
  });
};

export const useDuplicates = () => {
  const dataProvider = useDonorDesk();
  return useQuery({
    queryKey: donorDeskKeys.duplicates,
    queryFn: () => dataProvider.getDuplicates(),
  });
};

/** Every write can change ranks, counts and panels, so refetch everything. */
const useInvalidateAll = () => {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: donorDeskKeys.all });
};

export const useMergeDuplicate = () => {
  const dataProvider = useDonorDesk();
  const invalidateAll = useInvalidateAll();
  return useMutation({
    mutationFn: ({ pairId, keepId }: { pairId: number; keepId: number }) =>
      dataProvider.mergeDuplicate(pairId, keepId),
    onSuccess: invalidateAll,
  });
};

export const useDismissDuplicate = () => {
  const dataProvider = useDonorDesk();
  const invalidateAll = useInvalidateAll();
  return useMutation({
    mutationFn: (pairId: number) => dataProvider.dismissDuplicate(pairId),
    onSuccess: invalidateAll,
  });
};

export const useSourceLabel = () => {
  const dataProvider = useDonorDesk();
  return useQuery({
    queryKey: [ROOT, "source-label"],
    queryFn: () => dataProvider.getSourceLabel(),
  });
};

export const useEnrichDonor = (id: number) => {
  const dataProvider = useDonorDesk();
  const invalidateAll = useInvalidateAll();
  return useMutation({
    mutationFn: () => dataProvider.enrichDonor(id),
    onSuccess: invalidateAll,
  });
};

export const useDraftOutreach = (id: number) => {
  const dataProvider = useDonorDesk();
  const invalidateAll = useInvalidateAll();
  return useMutation({
    mutationFn: () => dataProvider.draftOutreach(id),
    // Refetch on failure too: a timed-out draft falls back to the saved one.
    onSettled: invalidateAll,
  });
};

/** Approves any draft, donor or prospect. */
export const useApproveDraft = () => {
  const dataProvider = useDonorDesk();
  const invalidateAll = useInvalidateAll();
  return useMutation({
    mutationFn: ({ draftId, body }: { draftId: number; body: string }) =>
      dataProvider.approveDraft(draftId, body),
    onSuccess: invalidateAll,
  });
};

/* ---------- ICP + prospects ---------- */

export const useIcp = () => {
  const dataProvider = useDonorDesk();
  return useQuery({
    queryKey: donorDeskKeys.icp,
    queryFn: () => dataProvider.getIcp(),
  });
};

export const useRunIcp = () => {
  const dataProvider = useDonorDesk();
  const invalidateAll = useInvalidateAll();
  return useMutation({
    mutationFn: () => dataProvider.runIcp(),
    onSettled: invalidateAll,
  });
};

export const useProspects = () => {
  const dataProvider = useDonorDesk();
  return useQuery({
    queryKey: donorDeskKeys.prospects,
    queryFn: () => dataProvider.getProspects(),
  });
};

export const useProspect = (id: number | null) => {
  const dataProvider = useDonorDesk();
  return useQuery({
    queryKey: donorDeskKeys.prospect(id ?? -1),
    queryFn: () => dataProvider.getProspect(id as number),
    enabled: id != null,
  });
};

export const useDraftProspectOutreach = (id: number) => {
  const dataProvider = useDonorDesk();
  const invalidateAll = useInvalidateAll();
  return useMutation({
    mutationFn: () => dataProvider.draftProspectOutreach(id),
    // Refetch on failure too: a timed-out draft falls back to the saved one.
    onSettled: invalidateAll,
  });
};

export const useDismissProspect = () => {
  const dataProvider = useDonorDesk();
  const invalidateAll = useInvalidateAll();
  return useMutation({
    mutationFn: (id: number) => dataProvider.dismissProspect(id),
    onSuccess: invalidateAll,
  });
};

/* ---------- Onboarding (plan.md §15) ---------- */

/** Screen 1. On success everything refetches: new donors, scores, duplicates. */
export const useUploadFiles = () => {
  const dataProvider = useDonorDesk();
  const invalidateAll = useInvalidateAll();
  return useMutation({
    // target: "giver" | "neighbor" | "community" | "auto" (the agent sorts)
    mutationFn: ({ files, target = "auto" }: { files: File[]; target?: UploadTarget }) =>
      dataProvider.uploadFiles(files, target),
    onSuccess: invalidateAll,
  });
};

/**
 * Screen 2: one synchronous call (up to 30 s). Use isPending as the
 * "researching your website" state; data is the full result.
 */
export const useRunContext = () => {
  const dataProvider = useDonorDesk();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: ContextRunInput) => dataProvider.runContext(input),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: donorDeskKeys.context });
      queryClient.invalidateQueries({ queryKey: donorDeskKeys.orgProfile });
    },
  });
};

export const useOrgContext = () => {
  const dataProvider = useDonorDesk();
  return useQuery({
    queryKey: donorDeskKeys.context,
    queryFn: () => dataProvider.getContext(),
  });
};

export const useOrgProfile = () => {
  const dataProvider = useDonorDesk();
  return useQuery({
    queryKey: donorDeskKeys.orgProfile,
    queryFn: () => dataProvider.getOrgProfile(),
  });
};
