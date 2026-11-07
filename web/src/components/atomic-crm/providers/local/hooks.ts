import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useDonorDesk } from "./index";

const ROOT = "donor-desk";

export const donorDeskKeys = {
  all: [ROOT] as const,
  donors: [ROOT, "donors"] as const,
  donor: (id: number) => [ROOT, "donor", id] as const,
  duplicates: [ROOT, "duplicates"] as const,
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
    onSuccess: invalidateAll,
  });
};

export const useApproveDraft = (id: number) => {
  const dataProvider = useDonorDesk();
  const invalidateAll = useInvalidateAll();
  return useMutation({
    mutationFn: ({ draftId, body }: { draftId: number; body: string }) =>
      dataProvider.approveDraft(id, draftId, body),
    onSuccess: invalidateAll,
  });
};
