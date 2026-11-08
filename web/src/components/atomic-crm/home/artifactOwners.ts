import { useQuery } from "@tanstack/react-query";

import { DATA_MODE } from "../providers/local/config";
import type { ApiCallNote } from "../providers/local/calls";
import { request } from "../providers/local/httpClient";
import { loadSnapshot } from "../providers/local/snapshotClient";

/**
 * GET /artifacts names a draft or a call note but not whose it is, so the
 * Files & drafts tile looks the donor up: drafts from the snapshot's donor
 * details, call notes from GET /calls (their saved destinations).
 */
export interface ArtifactOwners {
  /** outreach draft id → donor id */
  drafts: Record<string, number>;
  /** call note id → donor id */
  notes: Record<string, number>;
}

const NONE: ArtifactOwners = { drafts: {}, notes: {} };

const needsOwners = (artifacts?: { ref: unknown }[]) =>
  (artifacts ?? []).some((a) => /^(draft|call_note):/.test(String(a.ref)));

const loadOwners = async (): Promise<ArtifactOwners> => {
  const owners: ArtifactOwners = { drafts: {}, notes: {} };
  if (DATA_MODE === "snapshot") {
    const snapshot = await loadSnapshot();
    for (const donor of Object.values(snapshot.donor_details ?? {}))
      for (const draft of donor.outreach_drafts ?? [])
        owners.drafts[String(draft.id)] = donor.id;
    return owners;
  }
  try {
    const calls = await request<ApiCallNote[]>("/calls?limit=200");
    for (const note of calls) {
      const donor = (note.destinations ?? []).find((d) => d.kind === "donor");
      if (donor && Number.isInteger(Number(donor.id)))
        owners.notes[note.id] = Number(donor.id);
    }
  } catch {
    // no call notes to link; the rows stay plain text
  }
  return owners;
};

export const useArtifactOwners = (artifacts?: { ref: unknown }[]): ArtifactOwners => {
  const { data } = useQuery({
    queryKey: ["donor-desk", "artifact-owners", DATA_MODE],
    queryFn: loadOwners,
    enabled: needsOwners(artifacts),
    staleTime: 60_000,
  });
  return data ?? NONE;
};
