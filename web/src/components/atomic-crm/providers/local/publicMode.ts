import { API_URL } from "./config";

/**
 * Whether the API is in public mode (the tunnel to the laptop, docs/public-tunnel.md), read once from
 * GET /public-mode, which answers any origin. Public mode serves only an allow-list, so the web skips the
 * requests it would refuse (GET /openapi.json, GET /calls): Chromium logs every 403 as a console error.
 * With PUBLIC_SHOW_ALL the API serves every read ({"redacted": false}), so this answers false and the web loads
 * everything; writes are still refused server-side.
 *
 * Unknown (unreadable) means "not public": local mode keeps its probes.
 */
export const readPublicMode = (fetchImpl: typeof fetch = fetch): Promise<boolean> =>
  fetchImpl(`${API_URL}/public-mode`)
    .then(async (response) => {
      if (!response.ok) return false;
      const body = (await response.json()) as { enabled?: unknown; redacted?: unknown };
      return body.enabled === true && body.redacted !== false;
    })
    .catch(() => false);

let modePromise: Promise<boolean> | null = null;

/** Cached for the session. Unit tests mock fetch call by call, so they read it via readPublicMode. */
export const isPublicMode = (): Promise<boolean> => {
  if (import.meta.env.MODE === "test") return Promise.resolve(false);
  if (!modePromise) modePromise = readPublicMode();
  return modePromise;
};
