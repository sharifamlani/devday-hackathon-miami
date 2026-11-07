/**
 * Where Donor Desk reads its data from.
 *
 * - `local`: the Python API on the demo laptop (service/main.py).
 * - `snapshot`: a static JSON export of that API, served with the app. Used on
 *   Vercel, where there is no API. Writes (merge, enrich, draft, approve) stay
 *   in the browser's memory and the header says so.
 */
export type DataMode = "local" | "snapshot";

export const DATA_MODE: DataMode =
  import.meta.env.VITE_DATA_MODE === "local" ? "local" : "snapshot";

export const API_URL: string = (
  import.meta.env.VITE_API_URL ?? "http://localhost:8000"
).replace(/\/$/, "");

// Name recorded as approved_by when someone approves a draft in the demo.
export const APPROVER_NAME: string =
  import.meta.env.VITE_APPROVER_NAME ?? "Philanthropy team (demo)";

// Resolved against the page, so it works under any deployment sub-path.
export const SNAPSHOT_URL: string =
  import.meta.env.VITE_SNAPSHOT_URL ?? "./snapshot.json";
