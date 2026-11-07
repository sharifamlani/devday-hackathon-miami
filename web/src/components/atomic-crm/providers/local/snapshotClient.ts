import type { ApiSnapshot } from "./apiTypes";
import { APPROVER_NAME, SNAPSHOT_URL } from "./config";
import {
  parseContext,
  parseDonorDetail,
  parseDonorRow,
  parseDuplicate,
  parseIcp,
  parseOrgProfile,
  parseProspect,
  parseProspectDetail,
} from "./parse";
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

/** prospect_details[id] carries the drafts; the list row is the fallback. */
const prospectOf = (snapshot: ApiSnapshot, id: number) => {
  const prospect =
    snapshot.prospect_details?.[String(id)] ??
    snapshot.prospects?.find((p) => p.id === id);
  if (!prospect) throw new Error(`Prospect ${id} is not in the snapshot`);
  return prospect;
};

/** The snapshot's context run is simulated: instantly done, labeled cached. */
const contextOf = (snapshot: ApiSnapshot) =>
  parseContext(snapshot.context, {
    cached: true,
    profile: snapshot.org_profile ?? null,
  });

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
  approveDraft: async (draftId, body) => {
    const snapshot = await loadSnapshot();
    const draft = [
      ...Object.values(snapshot.donor_details),
      ...Object.values(snapshot.prospect_details ?? {}),
    ]
      .flatMap((owner) => owner.outreach_drafts ?? [])
      .find((d) => d.id === draftId);
    if (!draft) throw new Error(`Draft ${draftId} is not in the snapshot`);
    Object.assign(draft, {
      body,
      status: "approved",
      approved_by: APPROVER_NAME,
      approved_at: new Date().toISOString(),
    });
  },
  getSourceLabel: async () => (await loadSnapshot()).meta.label,

  getIcp: async () => {
    const icp = (await loadSnapshot()).icp;
    return icp ? parseIcp(icp) : null;
  },
  runIcp: async () => {
    throw new Error(READ_ONLY);
  },
  // Like GET /prospects: dismissed rows drop out of the list.
  getProspects: async () =>
    ((await loadSnapshot()).prospects ?? [])
      .filter((p) => p.status !== "dismissed")
      .map(parseProspect)
      .sort((a, b) => b.fit_score - a.fit_score),
  getProspect: async (id) =>
    parseProspectDetail(structuredClone(prospectOf(await loadSnapshot(), id))),
  draftProspectOutreach: async () => {
    throw new Error(READ_ONLY);
  },
  uploadFiles: async () => {
    throw new Error(READ_ONLY);
  },
  runContext: async (input) => {
    const context = contextOf(await loadSnapshot());
    const website = context.facts.filter((f) => f.source === "website");
    const social = (source: "x" | "linkedin" | "instagram", label: string, url?: string | null) => ({
      source,
      label,
      state: url ? ("saved_not_connected" as const) : ("not_provided" as const),
      status_text: url ? "saved, not connected" : "not provided",
      fact_count: 0,
      detail: url || null,
    });
    return {
      status: "done",
      cached: true,
      detail: "Cached sample: the snapshot cannot run live research.",
      sources: [
        // Never report "done" for facts the snapshot doesn't have.
        website.length
          ? {
              source: "website",
              label: "Website",
              state: "done" as const,
              status_text: "done",
              fact_count: website.length,
              detail: null,
            }
          : {
              source: "website",
              label: "Website",
              state: "failed" as const,
              status_text: "no saved context",
              fact_count: 0,
              detail: "This snapshot has no saved website context.",
            },
        social("x", "X", input.x_url),
        social("linkedin", "LinkedIn", input.linkedin_url),
        social("instagram", "Instagram", input.instagram_url),
      ],
      profile: context.profile,
      facts: context.facts,
      finished_at: null,
    };
  },
  getContext: async () => contextOf(await loadSnapshot()),
  getOrgProfile: async () => {
    const snapshot = await loadSnapshot();
    if (snapshot.org_profile) return parseOrgProfile(snapshot.org_profile);
    return contextOf(snapshot).profile;
  },
  dismissProspect: async (id) => {
    const snapshot = await loadSnapshot();
    prospectOf(snapshot, id).status = "dismissed";
    const row = snapshot.prospects?.find((p) => p.id === id);
    if (row) row.status = "dismissed";
  },
};
