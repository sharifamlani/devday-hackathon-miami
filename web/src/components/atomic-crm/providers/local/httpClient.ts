import { API_URL } from "./config";
import type {
  DonorDeskMethods,
  DonorDetail,
  DonorSummary,
  DuplicatePair,
  MergeResult,
  OutreachDraft,
  ResearchFact,
} from "./types";

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
  getDonors: () => request<DonorSummary[]>("/donors"),
  getDonor: (id) => request<DonorDetail>(`/donors/${id}`),
  getDuplicates: () => request<DuplicatePair[]>("/duplicates"),
  mergeDuplicate: (pairId, keepId) =>
    request<MergeResult>(`/duplicates/${pairId}/merge`, {
      method: "POST",
      body: { keep_id: keepId },
    }),
  enrichDonor: async (id) =>
    (
      await request<{ research: ResearchFact[] }>(`/enrich/${id}`, {
        method: "POST",
      })
    ).research,
  draftOutreach: async (id) =>
    (
      await request<{ draft: OutreachDraft }>(`/outreach/${id}`, {
        method: "POST",
      })
    ).draft,
  approveDraft: async (id, body) =>
    (
      await request<{ draft: OutreachDraft }>(`/outreach/${id}/approve`, {
        method: "POST",
        body: { body },
      })
    ).draft,
};
