import { useQuery } from "@tanstack/react-query";

import { call, qs } from "./endpoint";

/* plan.md §21.2.3 / §21.5: the context store, newest first (owner 86, C1). */

export type ContextKind =
  | "success_story"
  | "program_update"
  | "use_of_funds"
  | "org_health"
  | "event"
  | "news"
  | "other"
  | (string & {});

export interface ContextItem {
  id: number;
  kind: ContextKind;
  title: string;
  text: string;
  source_url: string; // every row keeps its URL
  posted_at: string | null;
  score: number | null; // similarity × recency; null when browsing by kind
}

export interface ContextSearchParams {
  q?: string;
  kinds?: ContextKind[];
  k?: number;
}

export const contextSearchKeys = {
  search: (p: ContextSearchParams) => ["donor-desk", "context", "search", p] as const,
};

export const searchContext = ({ q, kinds, k }: ContextSearchParams = {}) =>
  call<ContextItem[]>(
    "Context search",
    "GET",
    `/context/search${qs({ q, kinds: kinds?.join(","), k })}`,
    { snapshotValue: [] },
  );

/** No q returns the newest items of the asked kinds (§21.2.3). */
export const useContextSearch = (params: ContextSearchParams = {}, enabled = true) =>
  useQuery({
    queryKey: contextSearchKeys.search(params),
    queryFn: () => searchContext(params),
    enabled,
  });

// parseSources lives in sources.ts (no imports), so campaigns.ts can use it
// without an import cycle through endpoint.ts → httpClient.ts → campaigns.ts.
export { parseSources } from "./sources";
