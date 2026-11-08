import { PUBLIC_READ_ONLY } from "./config";

/**
 * Whether the API is in public mode (the tunnel, docs/public-tunnel.md). main.tsx reads GET /public-mode once
 * before the app loads (apiProbe.probePublicMode) and config.ts holds the answer as PUBLIC_READ_ONLY. Public
 * mode serves only an allow-list, so the web skips the requests it would refuse (GET /openapi.json, GET /calls,
 * the /crm reads): Chromium logs every 403 as a console error. Unit tests run as local mode.
 */
export const isPublicMode = (): Promise<boolean> =>
  Promise.resolve(PUBLIC_READ_ONLY);
