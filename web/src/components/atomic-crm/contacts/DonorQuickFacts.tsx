import { useDonorProjects } from "../providers/local/campaignHooks";
import type { DonorContactDetail } from "../providers/local/crmResources";
import { EmailLink, PhoneLink } from "./ContactLinks";
import { Stat } from "./donorCrmUi";

/**
 * The donor's four quick facts — Email · Phone · Organization · Project — shared by the quick
 * view (DonorDrawer) and the full record (DonorShow), so the two always match.
 * Where the record came from (Source) is on the full record's Details card only.
 */
export const DonorQuickFacts = ({
  record,
}: {
  record: Pick<DonorContactDetail, "id" | "email" | "phone" | "company_name">;
}) => {
  const projects = useDonorProjects(record.id);
  return (
    <dl className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
      <Stat
        label="Email"
        value={
          // Always fully visible (Sharif): a long address wraps instead of truncating.
          <span className="block [overflow-wrap:anywhere]">
            <EmailLink email={record.email} />
          </span>
        }
      />
      <Stat label="Phone" value={<PhoneLink phone={record.phone} />} />
      <Stat label="Organization" value={record.company_name ?? "None linked"} />
      <Stat
        label="Project"
        value={
          projects.isPending
            ? "…"
            : projects.isError
              ? "Couldn't load"
              : projects.projects.length
                ? projects.projects.map((p) => p.name).join(", ")
                : "None yet"
        }
      />
    </dl>
  );
};
