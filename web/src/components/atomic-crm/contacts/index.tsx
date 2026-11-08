import type { DonorContact } from "../providers/local/crmDonors";
import { DonorList } from "./DonorList";
import { DonorShow } from "./DonorShow";

/**
 * The Donors tab: Atomic CRM's contacts resource on the donor data
 * (providers/local/crmResources.ts). Donors come from the service or the
 * snapshot, so there is no create or edit screen: Import donors adds them.
 * ContactList/ContactShow/ContactEdit stay for Atomic's own stories and tests.
 */
export default {
  list: DonorList,
  show: DonorShow,
  recordRepresentation: (record: DonorContact) => record?.full_name ?? "",
};
