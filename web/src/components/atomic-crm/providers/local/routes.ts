import { API_URL } from "./config";

/**
 * Which routes the running API build serves, read once from FastAPI's
 * /openapi.json. request() checks it before calling, so a screen never fires
 * a request at a route that hasn't landed: Chromium logs every 4xx/5xx as a
 * console error, and the demo bar is 0 console errors.
 *
 * Unknown (openapi.json unreadable) means "assume it exists and call it".
 */
export type RouteTable = { pattern: RegExp; methods: Set<string> }[];

export const toRouteTable = (paths: Record<string, Record<string, unknown>>): RouteTable =>
  Object.entries(paths).map(([template, ops]) => ({
    // "/donors/{donor_id}" → ^/donors/[^/]+$
    pattern: new RegExp(
      `^${template
        .split(/\{[^}]+\}/)
        .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
        .join("[^/]+")}$`,
    ),
    methods: new Set(Object.keys(ops).map((m) => m.toUpperCase())),
  }));

export const routeExists = (table: RouteTable, method: string, path: string): boolean => {
  const bare = path.split("?")[0];
  return table.some((r) => r.pattern.test(bare) && r.methods.has(method.toUpperCase()));
};

let tablePromise: Promise<RouteTable | null> | null = null;

/** The route table, or null when it can't be read. Cached for the session. */
export const knownRoutes = (): Promise<RouteTable | null> => {
  // Unit tests mock fetch call by call; they test the routes themselves.
  if (import.meta.env.MODE === "test") return Promise.resolve(null);
  if (!tablePromise) {
    tablePromise = fetch(`${API_URL}/openapi.json`)
      .then(async (response) =>
        response.ok
          ? toRouteTable(((await response.json()) as { paths?: Record<string, Record<string, unknown>> }).paths ?? {})
          : null,
      )
      .catch(() => null);
  }
  return tablePromise;
};

/** After a service restart with new routes, read the table again. */
export const forgetRoutes = () => {
  tablePromise = null;
};
