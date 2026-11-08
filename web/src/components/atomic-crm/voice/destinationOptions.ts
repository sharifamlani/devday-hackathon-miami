import type { DonorSummary } from "../providers/local/types";
import type { DestinationOption } from "./DestinationChips";

/**
 * The donor picker's options: people first, then organizations (foundations, businesses),
 * each under its own heading, so a foundation never reads as a person.
 */
export const donorOptions = (donors: DonorSummary[]): DestinationOption[] => {
  const toOption = (d: DonorSummary): DestinationOption => {
    const organization = d.donor_type === "organization";
    return {
      id: String(d.id),
      label: d.full_name,
      detail: d.city ?? undefined,
      section: organization ? "Organizations" : "People",
      icon: organization ? "organization" : undefined,
    };
  };
  const people = donors.filter((d) => d.donor_type !== "organization");
  const organizations = donors.filter((d) => d.donor_type === "organization");
  return [...people.map(toOption), ...organizations.map(toOption)];
};
