import {
  donorsFromRows,
  defaultMapping,
  parseCSV,
  validateImport,
} from "./domain";
import type { Donor } from "./domain";
export const SAMPLE_CSV = `donor_id,name,email,gift_id,gift_date,amount,source
rosa,Rosa Delgado,rosa.delgado@example.org,R-104,2026-09-30,100,Online giving
rosa,Rosa Delgado,rosa.delgado@example.org,R-103,2026-08-30,100,Online giving
rosa,Rosa Delgado,rosa.delgado@example.org,R-102,2026-07-30,100,Mailed check
rosa-alt,R. Delgado,rosa.delgado@example.org,R-101,2026-06-30,100,Gala export
elena,Elena Moreno,elena.moreno@example.org,E-303,2026-10-04,250,Online giving
elena,Elena Moreno,elena.moreno@example.org,E-302,2026-06-04,250,Online giving
elena,Elena Moreno,elena.moreno@example.org,E-301,2026-02-04,250,Gala export
jules,Jules Bennett,jules.bennett@example.org,J-503,2026-09-15,75,Online giving
jules,Jules Bennett,jules.bennett@example.org,J-502,2026-08-15,75,Online giving
jules,Jules Bennett,jules.bennett@example.org,J-501,2026-07-15,75,Online giving
mara,Mara Chen,mara.chen@example.org,M-603,2026-10-28,150,Online giving
mara,Mara Chen,mara.chen@example.org,M-602,2026-09-28,150,Online giving
mara,Mara Chen,mara.chen@example.org,M-601,2026-08-28,150,Online giving
sam,Sam Ellis,sam.ellis@example.org,S-703,2026-10-03,50,Online giving
sam,Sam Ellis,sam.ellis@example.org,S-702,2026-09-03,50,Online giving
sam,Sam Ellis,sam.ellis@example.org,S-701,2026-08-03,50,Online giving
dev,Devon Brooks,devon.brooks@example.org,D-803,2026-10-20,200,Online giving
nora,Nora Silva,nora.silva@example.org,N-903,2026-10-31,125,Mailed check
`;
export function withSampleScenario(donors: Donor[]): Donor[] {
  return donors.map((d) =>
    d.id === "elena" &&
    d.name === "Elena Moreno" &&
    d.email === "elena.moreno@example.org"
      ? {
          ...d,
          priority: true,
          call: {
            seconds: 402,
            reason:
              "Elena asked to speak with a staff member. Call duration is 6:42, above the 5-minute review threshold.",
          },
          note: "Interested in volunteering at the next family resource day.",
        }
      : d.id === "rosa"
        ? {
            ...d,
            note: "Prefers a personal check-in. Supports the family resource program.",
          }
        : d.id === "nora"
          ? {
              ...d,
              status: "done" as const,
              outcome: "Thank-you note approved for staff follow-up.",
            }
          : d,
  );
}

export function sampleDonors() {
  const csv = parseCSV(SAMPLE_CSV);
  const { rows } = validateImport(csv, defaultMapping(csv[0]));
  return withSampleScenario(donorsFromRows(rows, "fictional-donors.csv"));
}
