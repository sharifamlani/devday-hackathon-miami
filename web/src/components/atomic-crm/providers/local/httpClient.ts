import type {
  ApiContext,
  ApiContextRun,
  ApiDonorDetail,
  ApiDonorRow,
  ApiDuplicate,
  ApiIcpProfile,
  ApiMergeResult,
  ApiOrgProfile,
  ApiUndoMergeResult,
  ApiProspect,
  ApiTarget,
  ApiTargets,
} from "./apiTypes";
import { campaignHttpMethods } from "./campaigns";
import { parseAskResponse, type ApiAskResponse } from "./ask";
import { API_URL, APPROVER_NAME } from "./config";
import type { UploadTarget } from "./crmTypes";
import { requireWebsite } from "./validate";
import {
  parseContext,
  parseContextRun,
  parseDonorDetail,
  parseDonorRow,
  parseDuplicate,
  parseIcp,
  parseIngestResult,
  parseMergeResult,
  parseUndoMergeResult,
  parseOrgProfile,
  parseProspect,
  parseProspectDetail,
  parseTargets,
} from "./parse";
import type { BaseDonorDeskMethods, ImportMapping } from "./types";

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

export const request = async <T>(
  path: string,
  init?: { method?: "GET" | "POST" | "PATCH"; body?: unknown },
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

/** Multipart POST /ingest: every file under "files", plus an optional column mapping. */
const postIngest = async (
  files: File[],
  mapping?: ImportMapping,
  target?: UploadTarget, // plan.md §17: giver | neighbor | community | auto
) => {
  const form = new FormData();
  for (const file of files) form.append("files", file, file.name);
  if (mapping) form.append("mapping", JSON.stringify(mapping));
  if (target) form.append("target", target);
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
};

/** Talks to the Python API on the demo laptop (VITE_DATA_MODE=local). */
export const localApiMethods: BaseDonorDeskMethods = {
  getDonors: async () =>
    (await request<ApiDonorRow[]>("/donors")).map(parseDonorRow),
  getDonor: async (id) =>
    parseDonorDetail(await request<ApiDonorDetail>(`/donors/${id}`)),
  getDuplicates: async () =>
    (await request<ApiDuplicate[]>("/duplicates")).map(parseDuplicate),
  mergeDuplicate: async (pairId, keepId) => {
    const result = await request<ApiMergeResult>(
      `/duplicates/${pairId}/merge`,
      { method: "POST", body: { keep_id: keepId, approved_by: APPROVER_NAME } },
    );
    return parseMergeResult(result);
  },
  undoMerge: async (mergeId) => {
    try {
      return parseUndoMergeResult(
        await request<ApiUndoMergeResult>(`/merges/${mergeId}/undo`, {
          method: "POST",
        }),
      );
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) {
        throw new Error("This merge no longer exists, so it can't be undone.");
      }
      if (error instanceof ApiError && error.status === 409) {
        const detail = (error.body as { detail?: unknown } | null)?.detail;
        throw new Error(
          `This merge can't be undone: ${
            typeof detail === "string" && detail ? detail : "it is no longer the newest merge"
          }`,
        );
      }
      throw error;
    }
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
  getTargets: async (period) =>
    parseTargets(
      await request<ApiTargets | ApiTarget>(
        period ? `/targets?period=${period}` : "/targets",
      ),
    ),

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
  draftProspectOutreach: async (id) => {
    try {
      await postAgent(`/prospects/${id}/outreach`);
    } catch (error) {
      // PR #27: 409 for a dismissed prospect (no draft saved), 404 if unknown.
      if (error instanceof ApiError && error.status === 409) {
        throw new Error("This prospect was dismissed, so no email is drafted.");
      }
      if (error instanceof ApiError && error.status === 404) {
        throw new Error("This prospect no longer exists.");
      }
      throw error;
    }
  },
  dismissProspect: async (id) => {
    await request(`/prospects/${id}/dismiss`, { method: "POST" });
  },

  uploadFiles: (files, target = "auto") => postIngest(files, undefined, target),
  // Carlos's /ingest maps columns itself and may ignore "mapping".
  importDonors: (input) => postIngest(input.files, input.mapping),
  runContext: async (input) => {
    const website = requireWebsite(input);
    try {
      return parseContextRun(
        await request<ApiContextRun>("/context/run", {
          method: "POST",
          body: {
            website,
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
  ask: async (question, filter, intent) =>
    parseAskResponse(
      await request<ApiAskResponse>("/ask", {
        method: "POST",
        body: { question, filter: filter ?? null, intent: intent ?? null },
      }),
    ),
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
  ...campaignHttpMethods(request),
};
