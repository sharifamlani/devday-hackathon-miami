import { useCallback, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type {
  ChatContext,
  ChatMessage,
  PerItemApproval,
  SendBatch,
  Tab,
} from "./crmTypes";
import { donorDeskKeys } from "./hooks";
import { useDonorDesk } from "./index";

const crmKeys = {
  people: (tab: Tab) => [...donorDeskKeys.all, "people", tab] as const,
  events: [...donorDeskKeys.all, "events"] as const,
  event: (id: number) => [...donorDeskKeys.all, "event", id] as const,
  communityStats: [...donorDeskKeys.all, "community-stats"] as const,
};

const useInvalidateAll = () => {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: donorDeskKeys.all });
};

/** One tab's people, plus the count for every tab (for the tab badges). */
export const usePeople = (tab: Tab) => {
  const dataProvider = useDonorDesk();
  return useQuery({
    queryKey: crmKeys.people(tab),
    queryFn: () => dataProvider.getPeople(tab),
  });
};

/** Move a person to another tab in one click. */
export const useSetTab = () => {
  const dataProvider = useDonorDesk();
  const invalidateAll = useInvalidateAll();
  return useMutation({
    mutationFn: ({ personId, tab }: { personId: number; tab: Tab }) =>
      dataProvider.setTab(personId, tab),
    onSuccess: invalidateAll,
  });
};

/** Upcoming events, soonest first, each with its source link. */
export const useEvents = () => {
  const dataProvider = useDonorDesk();
  return useQuery({
    queryKey: crmKeys.events,
    queryFn: () => dataProvider.getEvents(),
  });
};

/** One event with its audience (and why each person) and pre-drafted invites. */
export const useEvent = (id: number | null) => {
  const dataProvider = useDonorDesk();
  return useQuery({
    queryKey: crmKeys.event(id ?? -1),
    queryFn: () => dataProvider.getEvent(id as number),
    enabled: id != null,
  });
};

export const useCommunityStats = () => {
  const dataProvider = useDonorDesk();
  return useQuery({
    queryKey: crmKeys.communityStats,
    queryFn: () => dataProvider.getCommunityStats(),
  });
};

/**
 * The chat panel. Keeps the conversation in component state; each send posts
 * the history and the screen context. `pendingBatch` is the newest batch still
 * waiting for approval: nothing is sent until approveSendBatch runs.
 */
export const useChat = (context: ChatContext) => {
  const dataProvider = useDonorDesk();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [resolvedBatches, setResolvedBatches] = useState<string[]>([]);

  const mutation = useMutation({
    mutationFn: ({ history, text }: { history: ChatMessage[]; text: string }) =>
      dataProvider.chat(history, text, context),
    onSuccess: (reply) => setMessages((current) => [...current, reply]),
  });

  const send = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || mutation.isPending) return;
      const userMessage: ChatMessage = {
        role: "user",
        text: trimmed,
        steps: [],
        batch: null,
        demo: false,
      };
      const history = messages;
      setMessages((current) => [...current, userMessage]);
      mutation.mutate({ history, text: trimmed });
    },
    [messages, mutation],
  );

  const pendingBatch: SendBatch | null =
    [...messages]
      .reverse()
      .find((m) => m.batch && !resolvedBatches.includes(m.batch.id))?.batch ?? null;

  return {
    messages,
    send,
    isPending: mutation.isPending, // show the agent "thinking" with its steps
    error: mutation.error,
    pendingBatch,
    /** Call after approving or discarding a batch so the panel stops offering it. */
    resolveBatch: (batchId: string) =>
      setResolvedBatches((ids) => [...ids, batchId]),
    reset: () => {
      setMessages([]);
      setResolvedBatches([]);
      mutation.reset();
    },
  };
};

/**
 * Approve a send batch. Without perItem, only items that need no individual
 * approval and have no flags go out; star/big/org items must be listed in
 * perItem one by one, and flagged items never go until edited.
 */
export const useApproveSendBatch = () => {
  const dataProvider = useDonorDesk();
  const invalidateAll = useInvalidateAll();
  return useMutation({
    mutationFn: ({
      batchId,
      approvedBy,
      perItem,
    }: {
      batchId: string;
      approvedBy: string;
      perItem?: PerItemApproval;
    }) => dataProvider.approveSendBatch(batchId, approvedBy, perItem),
    onSuccess: invalidateAll,
  });
};
