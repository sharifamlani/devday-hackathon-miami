import type { DonorSummary } from "../providers/local/types";

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
 * The donor the demo call is with: the first one whose summary mentions a
 * failed card, if the data has one. Null means the demo uses a made-up name.
 */
export const findCardFailedDonor = (
  donors: DonorSummary[] | undefined,
): DonorSummary | null =>
  donors?.find((d) => /\bcard\b/i.test(d.why_short ?? "")) ?? null;
