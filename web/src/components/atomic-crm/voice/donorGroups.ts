import type { DonorSummary } from "../providers/local/types";
import { DEMO_FALLBACK_DONOR } from "./transcriptSource";

/** The donor lists a call note can be filed to. */
export interface DonorGroup {
  id: string;
  label: string;
  matches: (donor: DonorSummary) => boolean;
}

export const DONOR_GROUPS: DonorGroup[] = [
  {
    id: "attention",
    label: "Needs attention",
    matches: (d) => d.status === "lapsing" || d.status === "lapsed",
  },
  { id: "stars", label: "Star donors", matches: (d) => d.is_star },
  { id: "lapsed", label: "Lapsed", matches: (d) => d.status === "lapsed" },
];

/**
 * The donor the demo call is with: the demo donor (DEMO_FALLBACK_DONOR) when the data has her,
 * since the script is written for her (her amount, her event); else the first one whose summary
 * mentions a failed card. Null means the demo uses the demo donor's name without a record.
 */
export const findCardFailedDonor = (
  donors: DonorSummary[] | undefined,
): DonorSummary | null =>
  donors?.find((d) => d.full_name?.trim().toLowerCase() === DEMO_FALLBACK_DONOR.toLowerCase()) ??
  donors?.find((d) => /\bcard\b/i.test(d.why_short ?? "")) ??
  null;
