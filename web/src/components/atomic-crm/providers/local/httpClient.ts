import type {
  ApiDonorDetail,
  ApiDonorRow,
  ApiDuplicate,
  ApiMergeResult,
} from "./apiTypes";
import { API_URL } from "./config";
import { parseDonorDetail, parseDonorRow, parseDuplicate } from "./parse";
import type { DonorDeskMethods } from "./types";

const request = async <T>(
  path: string,
  init?: { method?: "GET" | "POST"; body?: unknown },
): Promise<T> => {
  const method = init?.method ?? "GET";
  const response = await fetch(`${API_URL}${path}`, {
    method,
    headers:
      init?.body !== undefined
        ? { "Content-Type": "application/json" }
        : undefined,
    body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(
      `${method} ${path} failed: ${response.status} ${detail}`.trim(),
    );
  }
  return (await response.json()) as T;
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
  draftOutreach: async (id) => {
    await request(`/outreach/${id}`, { method: "POST" });
  },
  // Not in the API contract yet: requested from the lead.
  approveDraft: async (id, draftId, body) => {
    await request(`/outreach/${id}/approve`, {
      method: "POST",
      body: { draft_id: draftId, body },
    });
  },
  getSourceLabel: async () => null,
};
