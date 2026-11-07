import type { ApiSnapshot } from "./apiTypes";
import { APPROVER_NAME, SNAPSHOT_URL } from "./config";
import { parseDonorDetail, parseDonorRow, parseDuplicate } from "./parse";
import type { DonorDeskMethods } from "./types";

/**
 * Serves `python -m service.export_snapshot` output (VITE_DATA_MODE=snapshot).
 * Same shapes and same parser as the live API. Writes change only this tab's
 * in-memory copy (scores are not recomputed), and nothing new is generated:
 * research and drafts need the local API.
 */
let snapshotPromise: Promise<ApiSnapshot> | null = null;

const loadSnapshot = () => {
  if (!snapshotPromise) {
    snapshotPromise = fetch(SNAPSHOT_URL).then(async (response) => {
      if (!response.ok) {
        throw new Error(
          `Snapshot ${SNAPSHOT_URL} failed to load: ${response.status}`,
        );
      }
      return (await response.json()) as ApiSnapshot;
    });
    snapshotPromise.catch(() => {
      snapshotPromise = null; // let the next call retry
    });
  }
  return snapshotPromise;
};

const detailOf = (snapshot: ApiSnapshot, id: number) => {
  const detail = snapshot.donor_details[String(id)];
  if (!detail) throw new Error(`Donor ${id} is not in the snapshot`);
  return detail;
};

const READ_ONLY =
  "This is a read-only snapshot. Running the agents needs the local API.";

export const snapshotMethods: DonorDeskMethods = {
  getDonors: async () => (await loadSnapshot()).donors.map(parseDonorRow),
  getDonor: async (id) =>
    parseDonorDetail(structuredClone(detailOf(await loadSnapshot(), id))),
  getDuplicates: async () =>
    (await loadSnapshot()).duplicates.map(parseDuplicate),
  mergeDuplicate: async (pairId, keepId) => {
    const snapshot = await loadSnapshot();
    const pair = snapshot.duplicates.find((p) => p.id === pairId);
    if (!pair) {
      throw new Error(`Duplicate pair ${pairId} is not in the snapshot`);
    }
    if (keepId !== pair.donor_a_id && keepId !== pair.donor_b_id) {
      throw new Error(`Donor ${keepId} is not in pair ${pairId}`);
    }
    const mergedId =
      keepId === pair.donor_a_id ? pair.donor_b_id : pair.donor_a_id;
    const kept = detailOf(snapshot, keepId);
    const merged = snapshot.donor_details[String(mergedId)];
    if (merged) {
      kept.gifts = [...kept.gifts, ...merged.gifts].sort((a, b) =>
        b.gift_date.localeCompare(a.gift_date),
      );
    }
    snapshot.donors = snapshot.donors.filter((d) => d.id !== mergedId);
    delete snapshot.donor_details[String(mergedId)];
    snapshot.duplicates = snapshot.duplicates.filter(
      (p) => p.donor_a_id !== mergedId && p.donor_b_id !== mergedId,
    );
    return { kept_id: keepId, merged_id: mergedId };
  },
  dismissDuplicate: async (pairId) => {
    const snapshot = await loadSnapshot();
    snapshot.duplicates = snapshot.duplicates.filter((p) => p.id !== pairId);
  },
  enrichDonor: async () => {
    throw new Error(READ_ONLY);
  },
  draftOutreach: async () => {
    throw new Error(READ_ONLY);
  },
  approveDraft: async (id, draftId, body) => {
    const draft = detailOf(await loadSnapshot(), id).outreach_drafts.find(
      (d) => d.id === draftId,
    );
    if (!draft) throw new Error(`Draft ${draftId} is not in the snapshot`);
    Object.assign(draft, {
      body,
      status: "approved",
      approved_by: APPROVER_NAME,
      approved_at: new Date().toISOString(),
    });
  },
  getSourceLabel: async () => (await loadSnapshot()).meta.label,
};
