import { useQuery } from "@tanstack/react-query";

import { DATA_MODE, MOCK_ENDPOINTS } from "./config";
import { ApiError, request } from "./httpClient";
import { knownRoutes, routeExists } from "./routes";
import { loadSnapshot } from "./snapshotClient";

/**
 * One call path for every plan.md §21.5 endpoint (B9). Where a call goes:
 *
 * - "real": the running API build serves the route (or the route table can't
 *   be read): call it.
 * - "mock": the route isn't served yet AND the developer opted in with
 *   VITE_MOCK_ENDPOINTS=1. Answers come from a contract-shaped mock
 *   (mocks.ts), are logged once, and screens can label them via
 *   useEndpointSource. Never on by default: a mock is never presented as live.
 * - "unavailable": not served and no mock opt-in: a friendly "isn't
 *   available yet" error, without a request (so no console error).
 * - "snapshot": VITE_DATA_MODE=snapshot (Vercel). These endpoints are live
 *   only: reads return their empty value, writes refuse with a message.
 */
export type EndpointSource = "real" | "mock" | "unavailable" | "snapshot";

export type Method = "GET" | "POST" | "PATCH" | "DELETE";

export interface MockRequest {
  method: Method;
  path: string; // without the query string
  query: URLSearchParams;
  body: unknown;
}

type MockHandler = (req: MockRequest) => unknown;

const mockHandlers: { method: Method; pattern: RegExp; handler: MockHandler }[] = [];

const templateToRegex = (template: string) =>
  new RegExp(
    `^${template
      .split(/\{[^}]+\}/)
      .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
      .join("([^/]+)")}$`,
  );

/** Register a contract-shaped mock for one route template, e.g. "/tasks/{id}". */
export const registerMock = (method: Method, template: string, handler: MockHandler) => {
  mockHandlers.push({ method, pattern: templateToRegex(template), handler });
};

export const findMock = (method: Method, path: string): MockHandler | null => {
  const bare = path.split("?")[0];
  return mockHandlers.find((m) => m.method === method && m.pattern.test(bare))?.handler ?? null;
};

/** Run a mock directly (tests, and the "mock" source). */
export const runMock = (method: Method, path: string, body?: unknown): unknown => {
  const handler = findMock(method, path);
  if (!handler) throw new Error(`No mock for ${method} ${path}`);
  const [bare, qs = ""] = path.split("?");
  return structuredClone(handler({ method, path: bare, query: new URLSearchParams(qs), body }));
};

// The mocks load only when opted in, and stay out of the bundle otherwise.
const mocksReady: Promise<unknown> = MOCK_ENDPOINTS ? import("./mocks") : Promise.resolve();

export const sourceOf = async (method: Method, path: string): Promise<EndpointSource> => {
  if (DATA_MODE === "snapshot") return "snapshot";
  const routes = await knownRoutes();
  if (!routes || routeExists(routes, method, path)) return "real";
  if (MOCK_ENDPOINTS) {
    await mocksReady;
    if (findMock(method, path)) return "mock";
  }
  return "unavailable";
};

const loggedMocks = new Set<string>();

export const LIVE_ONLY = "This needs the live API; the snapshot build doesn’t have it.";

export interface CallOptions<T> {
  body?: unknown;
  /** Snapshot builds return this for reads instead of calling. */
  snapshotValue?: T;
  /**
   * Snapshot builds read the answer from snapshot.json (export_snapshot.py);
   * returning undefined (key missing in an older export) falls back to
   * snapshotValue.
   */
  snapshot?: (snap: Record<string, unknown>) => T | undefined;
}

/**
 * Call one §21.5 endpoint. `feature` names it in messages ("Tasks").
 * Mutations pass no snapshotValue, so the snapshot build refuses them.
 */
export const call = async <T>(
  feature: string,
  method: Method,
  path: string,
  options: CallOptions<T> = {},
): Promise<T> => {
  const source = await sourceOf(method, path);
  if (source === "snapshot") {
    if (options.snapshot) {
      const value = options.snapshot((await loadSnapshot()) as unknown as Record<string, unknown>);
      if (value !== undefined) return value;
    }
    if ("snapshotValue" in options) return options.snapshotValue as T;
    throw new Error(LIVE_ONLY);
  }
  if (source === "mock") {
    const key = `${method} ${path.split("?")[0]}`;
    if (!loggedMocks.has(key)) {
      loggedMocks.add(key);
      console.warn(`[mock] ${key}: contract-shaped mock (VITE_MOCK_ENDPOINTS=1)`);
    }
    return runMock(method, path, options.body) as T;
  }
  if (source === "unavailable") {
    throw new Error(`${feature} isn’t available yet: that part of the service isn’t running.`);
  }
  try {
    return await request<T>(path, { method, body: options.body });
  } catch (error) {
    if (error instanceof ApiError) {
      const detail = (error.body as { detail?: unknown } | null)?.detail;
      // Not mounted (FastAPI's bare 404) or a stub 503: same friendly message.
      if (error.status === 503 || (error.status === 404 && detail === "Not Found")) {
        throw new Error(
          typeof detail === "string" && detail !== "Not Found"
            ? detail
            : `${feature} isn’t available yet: that part of the service isn’t running.`,
        );
      }
      if (error.status === 504 && (error.body as { error?: string } | null)?.error === "agent_timeout") {
        throw new Error(`${feature} took too long. Try again.`);
      }
    }
    throw error;
  }
};

/** Where this endpoint is answered from right now; label "mock" data on screen. */
export const useEndpointSource = (method: Method, path: string) =>
  useQuery({
    queryKey: ["donor-desk", "endpoint-source", method, path.split("?")[0]],
    queryFn: () => sourceOf(method, path),
    staleTime: 60_000,
  }).data;

/** Query-string helper: drops undefined/null/empty values. */
export const qs = (params: Record<string, string | number | boolean | undefined | null>) => {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : "";
};
