import type {
  ApiContext,
  ApiContextRun,
  ApiDonorDetail,
  ApiDonorRow,
  ApiDuplicate,
  ApiIcpProfile,
  ApiMergeResult,
  ApiOrgProfile,
  ApiProspect,
} from "./apiTypes";
import { API_URL, APPROVER_NAME } from "./config";
import {
  parseContext,
  parseContextRun,
  parseDonorDetail,
  parseDonorRow,
  parseDuplicate,
  parseIcp,
  parseIngestResult,
  parseOrgProfile,
  parseProspect,
  parseProspectDetail,
} from "./parse";
import type { DonorDeskMethods } from "./types";

/** A non-2xx response, keeping the status and the parsed JSON body. */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: unknown,
  ) {
    super(message);
  }
}

const request = async <T>(
  path: string,
  init?: { method?: "GET" | "POST"; body?: unknown },
): Promise<T> => {
  const method = init?.method ?? "GET";
  const isForm = init?.body instanceof FormData;
  const response = await fetch(`${API_URL}${path}`, {
    method,
    // FormData sets its own multipart boundary header.
    headers:
      init?.body !== undefined && !isForm
        ? { "Content-Type": "application/json" }
        : undefined,
    body:
      init?.body === undefined
        ? undefined
        : isForm
          ? (init.body as FormData)
          : JSON.stringify(init.body),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    let body: unknown = null;
    try {
      body = JSON.parse(detail);
    } catch {
      // not JSON: keep the text in the message
    }
    throw new ApiError(
      `${method} ${path} failed: ${response.status} ${detail}`.trim(),
      response.status,
      body,
    );
  }
  return (await response.json()) as T;
};

/**
 * POST an agent route that may time out. The service answers 504
 * {"error": "agent_timeout", "cached_draft": {...} | null}; the cached draft
 * is the newest saved row, so the caller's refetch shows it.
 */
const postAgent = async (path: string) => {
  try {
    await request(path, { method: "POST" });
  } catch (error) {
    const body = error instanceof ApiError ? error.body : null;
    if (
      error instanceof ApiError &&
      error.status === 504 &&
      (body as { error?: string } | null)?.error === "agent_timeout"
    ) {
      throw new Error(
        (body as { cached_draft?: unknown }).cached_draft
          ? "Draft took too long, showing the last saved draft."
          : "Draft took too long and there is no saved draft yet. Try again.",
      );
    }
    throw error;
  }
};

/** Talks to the Python API on the demo laptop (VITE_DATA_MODE=local). */
export const localApiMethods: DonorDeskMethods = {
  getDonors: async () =>
    (await request<ApiDonorRow[]>("/donors")).map(parseDonorRow),
  getDonor: async (id) =>
    parseDonorDetail(await request<ApiDonorDetail>(`/donors/${id}`)),
  getDuplicates: async () =>
    (await request<ApiDuplicate[]>("/duplicates")).map(parseDuplicate),
  mergeDuplicate: async (pairId, keepId) => {
    const result = await request<ApiMergeResult>(
      `/duplicates/${pairId}/merge`,
      { method: "POST", body: { keep_id: keepId } },
    );
    return { kept_id: result.kept_donor_id, merged_id: result.removed_donor_id };
  },
  dismissDuplicate: async (pairId) => {
    await request(`/duplicates/${pairId}/dismiss`, { method: "POST" });
  },
  enrichDonor: async (id) => {
    await request(`/enrich/${id}`, { method: "POST" });
  },
  draftOutreach: (id) => postAgent(`/outreach/${id}`),
  approveDraft: async (draftId, body) => {
    await request(`/drafts/${draftId}/approve`, {
      method: "POST",
      body: { body, approved_by: APPROVER_NAME },
    });
  },
  getSourceLabel: async () => null,

  // "Not built yet" may come as 200 null (preferred: no console error) or
  // as 404 (PR #15 today, which Chromium logs as a console error).
  getIcp: async () => {
    try {
      const icp = await request<ApiIcpProfile | null>("/icp");
      return icp ? parseIcp(icp) : null;
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) return null;
      throw error;
    }
  },
  runIcp: async () => {
    await request("/icp/run", { method: "POST" });
  },
  getProspects: async () =>
    (await request<ApiProspect[]>("/prospects"))
      .map(parseProspect)
      .sort((a, b) => b.fit_score - a.fit_score),
  getProspect: async (id) =>
    parseProspectDetail(await request<ApiProspect>(`/prospects/${id}`)),
  draftProspectOutreach: (id) => postAgent(`/prospects/${id}/outreach`),
  dismissProspect: async (id) => {
    await request(`/prospects/${id}/dismiss`, { method: "POST" });
  },

  uploadFiles: async (files) => {
    const form = new FormData();
    for (const file of files) form.append("files", file, file.name);
    try {
      return parseIngestResult(
        await request<unknown>("/ingest", { method: "POST", body: form }),
      );
    } catch (error) {
      // /ingest is mounted only once Carlos's router exists.
      if (
        error instanceof ApiError &&
        (error.status === 404 || error.status === 503)
      ) {
        throw new Error(
          "Upload isn't available yet: the ingest service is not running.",
        );
      }
      throw error;
    }
  },
  runContext: async (input) => {
    try {
      return parseContextRun(
        await request<ApiContextRun>("/context/run", {
          method: "POST",
          body: {
            website: input.website || null,
            x_url: input.x_url || null,
            linkedin_url: input.linkedin_url || null,
            instagram_url: input.instagram_url || null,
            refresh: input.refresh ?? false,
          },
        }),
      );
    } catch (error) {
      if (error instanceof ApiError && error.status === 503) {
        throw new Error(
          "Website research isn't available yet: the context service is not running.",
        );
      }
      throw error;
    }
  },
  getContext: async () => parseContext(await request<ApiContext>("/context")),
  // 200 null (preferred) or 404 both mean "no profile yet".
  getOrgProfile: async () => {
    try {
      const profile = await request<ApiOrgProfile | null>("/org-profile");
      return profile ? parseOrgProfile(profile) : null;
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) return null;
      throw error;
    }
  },
};
