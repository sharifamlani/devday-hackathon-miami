import type { ContextItem } from "./contextSearch";

/**
 * A campaign draft's sources[] (C2): the context items it cites by id. Accepts
 * full items or {id, kind, title, url}; drops any without a URL.
 */
export const parseSources = (raw: unknown): ContextItem[] =>
  (Array.isArray(raw) ? raw : [])
    .map((s: Record<string, unknown>) => ({
      id: Number(s?.id),
      kind: String(s?.kind ?? "other"),
      title: String(s?.title ?? s?.fact ?? ""),
      text: String(s?.text ?? s?.fact ?? ""),
      source_url: String(s?.source_url ?? s?.url ?? ""),
      posted_at: (s?.posted_at as string | null | undefined) ?? (s?.date as string | null | undefined) ?? null,
      score: typeof s?.score === "number" ? s.score : null,
    }))
    .filter((s) => s.source_url);
