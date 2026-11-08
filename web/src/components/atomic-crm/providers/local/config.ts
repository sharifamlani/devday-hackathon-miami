/**
 * Where Donor Desk reads its data from.
 *
 * - `local`: the Python API on the demo laptop (service/main.py).
 * - `snapshot`: a static JSON export of that API, served with the app. Used on
 *   Vercel, where there is no API. Writes (merge, enrich, draft, approve) stay
 *   in the browser's memory and the header says so.
 */
export type DataMode = "local" | "snapshot";

// "live" (the laptop path, plan.md §21) is the same as "local".
export const DATA_MODE: DataMode =
  import.meta.env.VITE_DATA_MODE === "local" || import.meta.env.VITE_DATA_MODE === "live"
    ? "local"
    : "snapshot";

/**
 * Dev only: answer routes the API build doesn't serve yet with the
 * contract-shaped mocks in mocks.ts (plan.md §21.5), labeled as mocks.
 * Off by default; never set on the demo laptop.
 */
export const MOCK_ENDPOINTS: boolean = import.meta.env.VITE_MOCK_ENDPOINTS === "1";

export const API_URL: string = (
  import.meta.env.VITE_API_URL ?? "http://localhost:8000"
).replace(/\/$/, "");

// Name recorded as approved_by when someone approves a draft in the demo.
export const APPROVER_NAME: string =
  import.meta.env.VITE_APPROVER_NAME ?? "Philanthropy team (demo)";

// Resolved against the page, so it works under any deployment sub-path.
export const SNAPSHOT_URL: string =
  import.meta.env.VITE_SNAPSHOT_URL ?? "./snapshot.json";

/**
 * Posting to Instagram / LinkedIn / X is not built (plan.md §17 amendment).
 * Screens render those actions disabled with a "Coming soon" label while
 * this is "coming_soon"; nothing in the data layer posts anywhere.
 */
export type FeatureState = "coming_soon" | "enabled";
export const SOCIAL_POSTING: FeatureState = "coming_soon";
