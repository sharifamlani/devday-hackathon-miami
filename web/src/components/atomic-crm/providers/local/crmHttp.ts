import {
  parseChatResponse,
  parseCommunityStats,
  parseEvent,
  parseEventDetail,
  parsePeople,
  parseSendResult,
} from "./crmParse";
import type {
  ApiChatResponse,
  ApiCommunityStats,
  ApiEvent,
  ApiEventDetail,
  ApiPeopleResponse,
  ApiSendResult,
  CrmMethods,
} from "./crmTypes";
import { ApiError, request } from "./httpClient";

/**
 * A route that hasn't landed answers 503, or FastAPI's bare 404
 * {"detail": "Not Found"} when it isn't mounted. A real "person 9 not found"
 * 404 keeps its own message.
 */
const notLanded = (error: unknown) =>
  error instanceof ApiError &&
  (error.status === 503 ||
    (error.status === 404 &&
      (error.body as { detail?: unknown } | null)?.detail === "Not Found"));

const guard = async <T>(feature: string, call: () => Promise<T>): Promise<T> => {
  try {
    return await call();
  } catch (error) {
    if (notLanded(error)) {
      throw new Error(`${feature} isn't available yet: that part of the service is not running.`);
    }
    throw error;
  }
};

/** Approvals always name a person (plan.md §17: nothing sends without one). */
export const requireApprover = (approvedBy: string) => {
  const who = approvedBy.trim();
  if (!who) throw new Error("Add who is approving before sending.");
  return who;
};

export const crmHttpMethods: CrmMethods = {
  getPeople: (tab) =>
    guard("The people list", async () =>
      parsePeople(await request<ApiPeopleResponse>(`/people?type=${tab}`), tab),
    ),
  setTab: (personId, tab) =>
    guard("Moving people between tabs", async () => {
      await request(`/people/${personId}`, {
        method: "PATCH",
        body: { contact_type: tab },
      });
    }),
  getEvents: () =>
    guard("The calendar", async () =>
      (await request<ApiEvent[]>("/events"))
        .map(parseEvent)
        .sort((a, b) => a.starts_at.localeCompare(b.starts_at)),
    ),
  getEvent: (id) =>
    guard("The calendar", async () =>
      parseEventDetail(await request<ApiEventDetail>(`/events/${id}`)),
    ),
  getCommunityStats: () =>
    guard("Community stats", async () =>
      parseCommunityStats(await request<ApiCommunityStats>("/community/stats")),
    ),
  chat: (history, text, context) =>
    guard("The chat agent", async () =>
      parseChatResponse(
        await request<ApiChatResponse>("/chat", {
          method: "POST",
          body: {
            message: text,
            history: history.map((m) => ({ role: m.role, content: m.text })),
            context,
          },
        }),
      ),
    ),
  // async, so a missing approver rejects the promise instead of throwing.
  approveSendBatch: async (batchId, approvedBy, perItem) => {
    const who = requireApprover(approvedBy);
    return guard("Sending", async () =>
      parseSendResult(
        await request<ApiSendResult>("/send", {
          method: "POST",
          body: { batch_id: batchId, approved_by: who, items: perItem ?? null },
        }),
      ),
    );
  },
};
