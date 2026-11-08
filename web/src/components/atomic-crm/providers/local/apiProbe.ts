/**
 * Startup health check for the live API (docs/public-tunnel.md). When the app was built for `local` mode but
 * the API (e.g. the Cloudflare tunnel) is unreachable, main.tsx sets FALLBACK_FLAG before the app loads and
 * config.ts then resolves DATA_MODE to "snapshot", so the app shows sample data instead of a blank page.
 * This file must not import config.ts (it runs before it).
 */
export const FALLBACK_FLAG = "__DONOR_DESK_API_UNREACHABLE__";
export const PROBE_TIMEOUT_MS = 2000;

/** True when GET <apiUrl>/health answers 2xx within the timeout. Never throws. */
export const apiReachable = async (
  apiUrl: string,
  timeoutMs = PROBE_TIMEOUT_MS,
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(`${apiUrl.replace(/\/$/, "")}/health`, { signal: controller.signal });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
};

/** Mark the page so config.ts picks snapshot mode. Returns true when it fell back. */
export const probeAndFlag = async (
  mode: string | undefined,
  apiUrl: string,
  target: Record<string, unknown> = globalThis as unknown as Record<string, unknown>,
  fetchImpl: typeof fetch = fetch,
  timeoutMs = PROBE_TIMEOUT_MS,
): Promise<boolean> => {
  if (mode !== "local" && mode !== "live") return false;
  if (await apiReachable(apiUrl, timeoutMs, fetchImpl)) return false;
  target[FALLBACK_FLAG] = true;
  return true;
};
