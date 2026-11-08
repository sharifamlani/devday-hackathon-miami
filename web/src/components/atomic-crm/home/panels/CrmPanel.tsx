import { useLocation } from "react-router";
import { OrganizationList } from "../../companies/OrganizationList";
import { DonorList } from "../../contacts/DonorList";
import { crmSubview } from "../workspaceView";

/**
 * Christian's CRM lists in embedded mode. His own Donors / Organizations switch
 * (DonorsTabs) sits at the top of each list and drives ?workspace=donors|organizations,
 * which this panel reads. Donors first (givers).
 */
export const CrmPanel = () => {
  const { search } = useLocation();
  return crmSubview(search) === "organizations" ? (
    <OrganizationList embedded />
  ) : (
    <DonorList embedded />
  );
};
