import {
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";

import type {
  CreateCampaignInput,
  UpdateCampaignMessageInput,
} from "./campaignTypes";
import { useDonorDesk } from "./index";

// Under the shared "donor-desk" root, so any Donor Desk write refetches these too.
export const campaignKeys = {
  all: ["donor-desk", "campaigns"] as const,
  list: ["donor-desk", "campaigns", "list"] as const,
  detail: (id: number) => ["donor-desk", "campaigns", "detail", id] as const,
  outbox: ["donor-desk", "campaigns", "outbox"] as const,
};

const useInvalidateCampaigns = () => {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: campaignKeys.all });
};

export const useCampaigns = () => {
  const dataProvider = useDonorDesk();
  return useQuery({
    queryKey: campaignKeys.list,
    queryFn: () => dataProvider.getCampaigns(),
  });
};

export const useCampaign = (id: number | null) => {
  const dataProvider = useDonorDesk();
  return useQuery({
    queryKey: campaignKeys.detail(id ?? -1),
    queryFn: () => dataProvider.getCampaign(id as number),
    enabled: id != null,
  });
};

/**
 * The projects (campaigns) a donor is in: every campaign whose messages include them.
 * Reads each campaign's detail (cached per campaign), so it's cheap for a team's handful.
 */
export const useDonorProjects = (donorId: number | null) => {
  const dataProvider = useDonorDesk();
  const list = useCampaigns();
  const details = useQueries({
    queries: (donorId == null ? [] : (list.data ?? [])).map((c) => ({
      queryKey: campaignKeys.detail(c.id),
      queryFn: () => dataProvider.getCampaign(c.id),
    })),
  });
  const projects = details
    .map((q) => q.data)
    .filter(
      (c): c is NonNullable<typeof c> =>
        !!c && c.messages.some((m) => m.donor_id === donorId),
    )
    .map((c) => ({ id: c.id, name: c.name }));
  return {
    projects,
    isPending: list.isPending || details.some((q) => q.isPending),
  };
};

/** One draft per donor; live with a key this is about 11 s per donor (4 at a time). */
export const useCreateCampaign = () => {
  const dataProvider = useDonorDesk();
  const invalidate = useInvalidateCampaigns();
  return useMutation({
    mutationFn: (input: CreateCampaignInput) =>
      dataProvider.createCampaign(input),
    onSuccess: invalidate,
  });
};

export const useUpdateCampaignMessage = (campaignId: number) => {
  const dataProvider = useDonorDesk();
  const invalidate = useInvalidateCampaigns();
  return useMutation({
    mutationFn: ({
      messageId,
      input,
    }: {
      messageId: number;
      input: UpdateCampaignMessageInput;
    }) => dataProvider.updateCampaignMessage(campaignId, messageId, input),
    onSettled: invalidate,
  });
};

export const useApproveSmallDrafts = (campaignId: number) => {
  const dataProvider = useDonorDesk();
  const invalidate = useInvalidateCampaigns();
  return useMutation({
    mutationFn: () => dataProvider.approveSmallDrafts(campaignId),
    onSettled: invalidate,
  });
};

/** Simulated: approved messages go to the outbox; nothing leaves the laptop. */
export const useSendCampaign = (campaignId: number) => {
  const dataProvider = useDonorDesk();
  const invalidate = useInvalidateCampaigns();
  return useMutation({
    mutationFn: () => dataProvider.sendCampaign(campaignId),
    onSettled: invalidate,
  });
};

export const useOutbox = () => {
  const dataProvider = useDonorDesk();
  return useQuery({
    queryKey: campaignKeys.outbox,
    queryFn: () => dataProvider.getOutbox(),
  });
};
