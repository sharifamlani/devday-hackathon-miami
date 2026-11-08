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
// If main.tsx's startup health check found the API unreachable (tunnel off), it set a flag and the app runs
// on the snapshot, with the "Sample data" badge, instead of a blank page (apiProbe.ts).
export const resolveDataMode = (requested: string | undefined, apiUnreachable: boolean): DataMode =>
  (requested === "local" || requested === "live") && !apiUnreachable ? "local" : "snapshot";

export const DATA_MODE: DataMode = resolveDataMode(
  import.meta.env.VITE_DATA_MODE,
  Boolean((globalThis as Record<string, unknown>).__DONOR_DESK_API_UNREACHABLE__),
);

/**
 * True when the live API is in public mode (main.tsx's startup check, apiProbe.ts): it refuses every write, so
 * screens hide their write controls instead of sending one it would refuse. Keyed on the public-mode flag,
 * not on redaction (PUBLIC_SHOW_ALL shows everything but still refuses writes).
 */
export const PUBLIC_READ_ONLY: boolean =
  DATA_MODE === "local" && Boolean((globalThis as Record<string, unknown>).__DONOR_DESK_PUBLIC_MODE__);

/** Copy for the hint shown where write controls are hidden in public mode. */
export const READ_ONLY_PREVIEW = "Read-only preview: changes are made in the app on the laptop.";

/**
 * True only for the build made as the sample (Vercel): not a laptop build that fell back to the snapshot
 * because its API was unreachable. Setup state is shared with live mode, so only the real sample build may
 * mark it done (the landing's sample path).
 */
export const SAMPLE_BUILD: boolean = resolveDataMode(import.meta.env.VITE_DATA_MODE, false) === "snapshot";

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
/** The staff member Home greets ("Good afternoon, Sharif."): the demo presenter unless VITE_STAFF_NAME is set. */
export const STAFF_NAME: string = import.meta.env.VITE_STAFF_NAME ?? "Sharif";

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
