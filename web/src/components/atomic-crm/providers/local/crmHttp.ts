import {
  parseCampaignBatch,
  parseChatResponse,
  parseContextStatus,
  parseCommunityStats,
  parseEvent,
  parseEventDetail,
  parsePeople,
  parsePlanResult,
  parseSendResult,
} from "./crmParse";
import type {
  ApiCampaign,
  ApiChatResponse,
  ApiCommunityStats,
  ApiContextStatus,
  ApiEvent,
  ApiEventDetail,
  ApiPeopleResponse,
  ApiPlanResult,
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

const detailOf = (error: ApiError) => {
  const detail = (error.body as { detail?: unknown } | null)?.detail;
  return typeof detail === "string" && detail !== "Not Found" ? detail : null;
};

/** GET /context/refresh (service/main.py refresh_job_state). */
interface RefreshJobState {
  status?: string | null; // idle | refreshing | done | failed
  detail?: string | null;
  changes?: { facts?: { failed_sources?: string[] | null } | null } | null;
}

/** How often and how long to poll the pass (tests set pollMs to 0). */
export const refreshTiming = { pollMs: 2000, waitMs: 5 * 60_000 };

/** Poll the background pass until it stops; a failed pass says why. Returns the finished job. */
const waitForRefresh = async (job: RefreshJobState | null): Promise<RefreshJobState | null> => {
  const deadline = Date.now() + refreshTiming.waitMs;
  let current = job;
  while (current?.status === "refreshing") {
    if (Date.now() > deadline) {
      throw new Error("The refresh is still running. Check back in a few minutes.");
    }
    await new Promise((resolve) => setTimeout(resolve, refreshTiming.pollMs));
    current = await request<RefreshJobState>("/context/refresh");
  }
  if (current?.status === "failed") {
    throw new Error(`The refresh failed: ${current.detail ?? "no detail from the service"}.`);
  }

  return current;
};

const guard = async <T>(feature: string, call: () => Promise<T>): Promise<T> => {
  try {
    return await call();
  } catch (error) {
    if (notLanded(error)) {
      // A 503 says why (a stub's "<feature> isn't available yet", or
      // "OPENAI_API_KEY is not set in .env"); the bare 404 doesn't.
      throw new Error(
        detailOf(error as ApiError) ??
          `${feature} isn't available yet: that part of the service is not running.`,
      );
    }
    if (
      error instanceof ApiError &&
      error.status === 504 &&
      (error.body as { error?: string } | null)?.error === "agent_timeout"
    ) {
      throw new Error(`${feature} took too long. Try again, or ask something narrower.`);
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
      // The server orders them: upcoming soonest first, then past.
      (await request<ApiEvent[]>("/events")).map(parseEvent),
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
  getContextStatus: () =>
    guard("Context status", async () =>
      parseContextStatus(await request<ApiContextStatus>("/context/status")),
    ),
  // The POST starts a background pass and answers {status: "refreshing"} at
  // once; wait for it (GET /context/refresh), then read the status.
  refreshContext: () =>
    guard("Refreshing context", async () => {
      const response = await request<(ApiContextStatus & RefreshJobState) | null>(
        "/context/refresh",
        { method: "POST" },
      );
      if (response && (response.last_refreshed_at || response.refreshed_at)) {
        return parseContextStatus(response);
      }
      const finished = await waitForRefresh(response);
      const status = parseContextStatus(await request<ApiContextStatus>("/context/status"));
      // "done" can still mean the site or news couldn't be read: say so instead of showing success
      const unread = finished?.changes?.facts?.failed_sources ?? [];
      return unread.length ? { ...status, unread_sources: unread } : status;
    }),
  planEventOutreach: (eventId) =>
    guard("Planning event outreach", async () =>
      parsePlanResult(
        await request<ApiPlanResult>(`/events/${eventId}/plan`, { method: "POST" }),
      ),
    ),
  getSendBatch: (batchId) =>
    guard("Loading the batch", async () =>
      parseCampaignBatch(await request<ApiCampaign>(`/campaigns/${encodeURIComponent(batchId)}`)),
    ),
  // async, so a missing approver rejects the promise instead of throwing.
  approveSendBatch: async (batchId, approvedBy, perItem) => {
    const who = requireApprover(approvedBy);
    return guard("Sending", async () =>
      parseSendResult(
        await request<ApiSendResult>("/send", {
          method: "POST",
          // The service's batch ids are integers; keep non-numeric ids as sent.
          body: {
            batch_id: /^\d+$/.test(batchId) ? Number(batchId) : batchId,
            approved_by: who,
            items: perItem ?? null,
          },
        }),
      ),
    );
  },
};
