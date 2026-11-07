import { SNAPSHOT_URL } from "./config";
import type {
  DonorDeskMethods,
  DonorDetail,
  DonorSummary,
  Snapshot,
} from "./types";

/**
 * Serves a static export of the local API (VITE_DATA_MODE=snapshot).
 * Reads come from the file; writes change only this tab's in-memory copy, and
 * the header chip tells the audience the page is a read-only snapshot.
 */
let snapshotPromise: Promise<Snapshot> | null = null;

const loadSnapshot = () => {
  if (!snapshotPromise) {
    snapshotPromise = fetch(SNAPSHOT_URL).then(async (response) => {
      if (!response.ok) {
        throw new Error(
          `Snapshot ${SNAPSHOT_URL} failed to load: ${response.status}`,
        );
      }
      return (await response.json()) as Snapshot;
    });
    snapshotPromise.catch(() => {
      snapshotPromise = null; // let the next call retry
    });
  }
  return snapshotPromise;
};

const toSummary = ({
  phone: _phone,
  notes: _notes,
  why: _why,
  score_factors: _factors,
  gifts: _gifts,
  research: _research,
  draft: _draft,
  ...summary
}: DonorDetail): DonorSummary => summary;

const findDonor = (snapshot: Snapshot, id: number) => {
  const donor = snapshot.donors.find((d) => d.id === id);
  if (!donor) throw new Error(`Donor ${id} is not in the snapshot`);
  return donor;
};

export const snapshotMethods: DonorDeskMethods = {
  getDonors: async () =>
    (await loadSnapshot()).donors
      .map(toSummary)
      .sort((a, b) => b.score - a.score),
  getDonor: async (id) => structuredClone(findDonor(await loadSnapshot(), id)),
  getDuplicates: async () => structuredClone((await loadSnapshot()).duplicates),
  mergeDuplicate: async (pairId, keepId) => {
    const snapshot = await loadSnapshot();
    const pair = snapshot.duplicates.find((p) => p.id === pairId);
    if (!pair) {
      throw new Error(`Duplicate pair ${pairId} is not in the snapshot`);
    }
    const merged = pair.donors.find((d) => d.id !== keepId);
    if (!merged) throw new Error(`Donor ${keepId} is not in pair ${pairId}`);
    const kept = findDonor(snapshot, keepId);
    const loser = snapshot.donors.find((d) => d.id === merged.id);
    if (loser) {
      kept.gifts = [...kept.gifts, ...loser.gifts].sort((a, b) =>
        a.gift_date.localeCompare(b.gift_date),
      );
      kept.gift_count = kept.gifts.length;
      kept.total_given = kept.gifts.reduce((sum, g) => sum + g.amount, 0);
    }
    snapshot.donors = snapshot.donors.filter((d) => d.id !== merged.id);
    snapshot.duplicates = snapshot.duplicates.filter(
      (p) => !p.donors.some((d) => d.id === merged.id),
    );
    return { kept_id: keepId, merged_id: merged.id };
  },
  // The snapshot holds whatever research and drafts were exported; nothing
  // new is generated without the API.
  enrichDonor: async (id) => findDonor(await loadSnapshot(), id).research,
  draftOutreach: async (id) => {
    const draft = findDonor(await loadSnapshot(), id).draft;
    if (!draft) {
      throw new Error("No draft in this snapshot. Drafting needs the local API.");
    }
    return draft;
  },
  approveDraft: async (id, body) => {
    const donor = findDonor(await loadSnapshot(), id);
    if (!donor.draft) throw new Error(`Donor ${id} has no draft`);
    donor.draft = {
      ...donor.draft,
      body,
      status: "approved",
      approved_by: "Demo user",
      approved_at: new Date().toISOString(),
    };
    return donor.draft;
  },
};
