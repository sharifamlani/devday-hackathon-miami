import type {
  ApiDonorDetail,
  ApiDonorRow,
  ApiDuplicate,
  ApiGift,
  ApiMergeLogEntry,
  ApiSnapshot,
  ApiWhy,
} from "./apiTypes";
import { campaignSnapshotMethods } from "./campaigns";
import { askSnapshot, type ApiSnapshotWithAsk } from "./ask";
import { APPROVER_NAME, SNAPSHOT_URL } from "./config";
import { requireWebsite } from "./validate";
import {
  IMPORTED_UNSCORED,
  parseContext,
  parseDonorDetail,
  parseDonorRow,
  parseDuplicate,
  parseIcp,
  parseOrgProfile,
  parseProspect,
  parseProspectDetail,
  parseTargets,
} from "./parse";
import type { DonorDeskMethods, ImportedDonorRow } from "./types";

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

/* ---------- merge history + import (this tab's memory only) ---------- */

/** What undo needs: the removed donor whole, the kept donor's before-state, the pairs. */
interface MergeRecord {
  entry: ApiMergeLogEntry & { id: number; kept_id: number; merged_id: number };
  mergedRow: ApiDonorRow | null;
  mergedRowIndex: number;
  mergedDetail: ApiDonorDetail | null;
  keptRowBefore: ApiDonorRow | null;
  keptGiftsBefore: ApiGift[];
  duplicatesBefore: ApiDuplicate[];
}

interface TabState {
  merges: MergeRecord[];
  nextMergeId: number;
}

// Keyed by the loaded snapshot, so a reload starts with an empty log.
const tabStates = new WeakMap<ApiSnapshot, TabState>();
const stateOf = (snapshot: ApiSnapshot): TabState => {
  let state = tabStates.get(snapshot);
  if (!state) {
    state = { merges: [], nextMergeId: 1 };
    tabStates.set(snapshot, state);
  }
  return state;
};

const involves = (pair: ApiDuplicate, donorId: number) =>
  pair.donor_a_id === donorId || pair.donor_b_id === donorId;

/** Newest open merge among those touching either donor of this one. */
const isNewestOpen = (state: TabState, record: MergeRecord) =>
  !record.entry.undone_at &&
  !state.merges.some(
    (other) =>
      other.entry.id > record.entry.id &&
      !other.entry.undone_at &&
      [other.entry.kept_id, other.entry.merged_id].some((id) =>
        [record.entry.kept_id, record.entry.merged_id].includes(id),
      ),
  );

/** merges[] for GET /donors/{id}: newest first, can_undo on the newest open one. */
const mergesFor = (snapshot: ApiSnapshot, donorId: number): ApiMergeLogEntry[] => {
  const state = stateOf(snapshot);
  return state.merges
    .filter((m) => m.entry.kept_id === donorId)
    .map((m) => ({ ...m.entry, can_undo: isNewestOpen(state, m) }))
    .sort((a, b) => b.id - a.id);
};

const digitsKey = (phone: string | null | undefined) => {
  const digits = (phone ?? "").replace(/\D/g, "");
  return digits.length >= 7 ? digits.slice(-10) : null;
};

const IMPORT_DAYS_ON_TRACK = 400;
const DAY_MS = 86_400_000;

const importedWhy = (row: ImportedDonorRow, asOf: string): ApiWhy => {
  const gifts = [...row.gifts].sort((a, b) => b.gift_date.localeCompare(a.gift_date));
  const total = gifts.reduce((sum, g) => sum + g.amount, 0);
  const last = gifts[0];
  const daysSince = last
    ? Math.floor((Date.parse(asOf) - Date.parse(last.gift_date)) / DAY_MS)
    : undefined;
  const status = !last ? "no_gifts" : daysSince! <= IMPORT_DAYS_ON_TRACK ? "on_track" : "lapsed";
  return {
    status,
    reasons: last ? [IMPORTED_UNSCORED] : [IMPORTED_UNSCORED, "no_gifts"],
    as_of: asOf,
    gift_count: gifts.length,
    ...(last
      ? {
          lifetime_total: total,
          largest_gift: Math.max(...gifts.map((g) => g.amount)),
          last_gift: { date: last.gift_date, amount: last.amount, channel: last.channel },
          days_since_last_gift: daysSince,
        }
      : {}),
  };
};

const importRows = (snapshot: ApiSnapshot, rows: ImportedDonorRow[]) => {
  const state = stateOf(snapshot);
  const asOf = snapshot.meta.as_of ?? new Date().toISOString().slice(0, 10);

  // Ids stay above anything that can come back via undo.
  const allDetails = [
    ...Object.values(snapshot.donor_details),
    ...state.merges.flatMap((m) => (m.mergedDetail ? [m.mergedDetail] : [])),
  ];
  let nextDonorId =
    Math.max(
      0,
      ...snapshot.donors.map((d) => d.id),
      ...state.merges.map((m) => m.entry.merged_id),
    ) + 1;
  let nextGiftId =
    Math.max(0, ...allDetails.flatMap((d) => d.gifts.map((g) => g.id))) + 1;
  let nextPairId =
    Math.max(
      0,
      ...snapshot.duplicates.map((p) => p.id),
      ...state.merges.flatMap((m) => m.duplicatesBefore.map((p) => p.id)),
    ) + 1;

  // Contact keys of every donor we compare against (existing, then imported).
  const known: { row: ApiDonorRow; emails: string[]; phone: string | null }[] =
    snapshot.donors.map((row) => ({
      row,
      emails: [row.email, ...(row.emails_all ?? [])]
        .filter((e): e is string => !!e)
        .map((e) => e.trim().toLowerCase()),
      phone: digitsKey(snapshot.donor_details[String(row.id)]?.phone ?? row.phone),
    }));

  let giftTotal = 0;
  let duplicateTotal = 0;
  for (const raw of rows) {
    const gifts: ApiGift[] = raw.gifts.map((g) => ({
      id: nextGiftId++,
      donor_id: 0,
      amount: g.amount,
      gift_date: g.gift_date,
      channel: g.channel,
      fund_type: g.fund_type,
    }));
    gifts.sort((a, b) => b.gift_date.localeCompare(a.gift_date));
    const id = nextDonorId++;
    gifts.forEach((g) => (g.donor_id = id));
    const total = gifts.reduce((sum, g) => sum + g.amount, 0);
    const email = raw.email?.trim() || null;
    const row: ApiDonorRow = {
      id,
      full_name:
        raw.full_name?.trim() ||
        raw.org_name?.trim() ||
        [raw.first_name, raw.last_name].filter(Boolean).join(" ") ||
        "Unnamed donor",
      first_name: raw.first_name,
      last_name: raw.last_name,
      org_name: raw.org_name,
      donor_type: raw.donor_type,
      email,
      emails_all: email ? [email] : [],
      phone: raw.phone,
      city: raw.city,
      state: raw.state,
      fund_type: gifts[0]?.fund_type ?? null,
      notes: raw.notes,
      score: 0,
      tier: total >= 100000 ? "big" : total >= 10000 ? "mid" : "small",
      is_star: false,
      is_sample: false,
      status: null,
      why: importedWhy(raw, asOf),
      score_as_of: null,
    };
    row.status = row.why!.status;
    snapshot.donors.push(row);
    snapshot.donor_details[String(id)] = {
      ...row,
      gifts,
      research_facts: [],
      outreach_drafts: [],
    };
    giftTotal += gifts.length;

    // Same lower-cased email or same last-10 phone digits as anyone before it.
    const mine = {
      emails: email ? [email.toLowerCase()] : [],
      phone: digitsKey(raw.phone),
    };
    for (const other of known) {
      const reasons: string[] = [];
      for (const e of mine.emails) {
        if (other.emails.includes(e)) reasons.push(`same email: ${e}`);
      }
      if (mine.phone && mine.phone === other.phone) {
        reasons.push(`same phone: ${raw.phone}`);
      }
      if (!reasons.length) continue;
      const otherDetail = snapshot.donor_details[String(other.row.id)];
      snapshot.duplicates.push({
        id: nextPairId++,
        donor_a_id: other.row.id,
        donor_b_id: id,
        reasons,
        confidence: 0.9,
        status: "pending",
        donor_a: other.row,
        donor_b: row,
        donor_a_gift_count: otherDetail?.gifts.length ?? other.row.why?.gift_count ?? 0,
        donor_b_gift_count: gifts.length,
      });
      duplicateTotal++;
    }
    known.push({ row, emails: mine.emails, phone: mine.phone });
  }
  return { donors: rows.length, gifts: giftTotal, duplicates: duplicateTotal };
};

/**
 * Keep a donor's gift summary (score.py's why: count, lifetime, last and
 * largest gift) in step with its gift list after a merge or an undo, so the
 * totals correct themselves on screen. Scores are not recomputed here.
 */
const applyGiftTotals = (
  target: { why?: ApiWhy | null },
  gifts: ApiGift[],
) => {
  if (!target.why) return;
  const newest = [...gifts].sort((a, b) =>
    b.gift_date.localeCompare(a.gift_date),
  )[0];
  target.why = {
    ...target.why,
    gift_count: gifts.length,
    lifetime_total: gifts.reduce((sum, g) => sum + g.amount, 0),
    largest_gift: gifts.reduce((max, g) => Math.max(max, g.amount), 0),
    last_gift: newest
      ? { date: newest.gift_date, amount: newest.amount, channel: newest.channel }
      : undefined,
  };
};

export const snapshotMethods: DonorDeskMethods = {
  getDonors: async () => (await loadSnapshot()).donors.map(parseDonorRow),
  getDonor: async (id) => {
    const snapshot = await loadSnapshot();
    return parseDonorDetail(
      structuredClone({ ...detailOf(snapshot, id), merges: mergesFor(snapshot, id) }),
    );
  },
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
    const mergedRowIndex = snapshot.donors.findIndex((d) => d.id === mergedId);
    const keptRow = snapshot.donors.find((d) => d.id === keepId);

    // Everything needed to undo, copied before anything changes.
    const state = stateOf(snapshot);
    const mergedRow = snapshot.donors[mergedRowIndex] ?? merged ?? null;
    const record: MergeRecord = {
      entry: {
        id: state.nextMergeId++,
        kept_id: keepId,
        merged_id: mergedId,
        merged_name:
          mergedRow?.full_name ?? pair.donor_a?.full_name ?? `Donor ${mergedId}`,
        merged_email: mergedRow?.email ?? null,
        merged_emails: mergedRow
          ? [...new Set([...(mergedRow.emails_all ?? []), mergedRow.email ?? ""])].filter(
              Boolean,
            )
          : [],
        gifts_moved: merged?.gifts.length ?? 0,
        merged_at: new Date().toISOString(),
        approved_by: APPROVER_NAME,
        undone_at: null,
        can_undo: false, // computed on read
      },
      mergedRow: mergedRow ? structuredClone(mergedRow) : null,
      mergedRowIndex,
      mergedDetail: merged ? structuredClone(merged) : null,
      keptRowBefore: keptRow ? structuredClone(keptRow) : null,
      keptGiftsBefore: structuredClone(kept.gifts),
      duplicatesBefore: structuredClone(snapshot.duplicates),
    };
    state.merges.push(record);

    if (merged) {
      const moved = merged.gifts.map((g) => ({ ...g, donor_id: keepId }));
      kept.gifts = [...kept.gifts, ...moved].sort((a, b) =>
        b.gift_date.localeCompare(a.gift_date),
      );
      applyGiftTotals(kept, kept.gifts);
      if (keptRow) applyGiftTotals(keptRow, kept.gifts);
    }
    snapshot.donors = snapshot.donors.filter((d) => d.id !== mergedId);
    delete snapshot.donor_details[String(mergedId)];
    snapshot.duplicates = snapshot.duplicates.filter(
      (p) => p.donor_a_id !== mergedId && p.donor_b_id !== mergedId,
    );
    return { kept_id: keepId, merged_id: mergedId, merge_id: record.entry.id };
  },
  undoMerge: async (mergeId) => {
    const snapshot = await loadSnapshot();
    const state = stateOf(snapshot);
    const record = state.merges.find((m) => m.entry.id === mergeId);
    if (!record) throw new Error(`Merge ${mergeId} was not found in this tab.`);
    const { entry } = record;
    if (entry.undone_at) {
      throw new Error("This merge can't be undone: it was already undone.");
    }
    if (!isNewestOpen(state, record)) {
      throw new Error(
        "This merge can't be undone: a newer merge involves the same donor. Undo that one first.",
      );
    }

    // Kept donor: back to its pre-merge gifts and list row.
    const kept = snapshot.donor_details[String(entry.kept_id)];
    if (kept) {
      kept.gifts = structuredClone(record.keptGiftsBefore);
      applyGiftTotals(kept, kept.gifts);
    }
    if (record.keptRowBefore) {
      const index = snapshot.donors.findIndex((d) => d.id === entry.kept_id);
      if (index >= 0) snapshot.donors[index] = structuredClone(record.keptRowBefore);
    }

    // Merged donor: back in its original list position, with its details.
    if (record.mergedRow && !snapshot.donors.some((d) => d.id === entry.merged_id)) {
      const index = Math.min(
        Math.max(record.mergedRowIndex, 0),
        snapshot.donors.length,
      );
      snapshot.donors.splice(index, 0, structuredClone(record.mergedRow));
    }
    if (record.mergedDetail) {
      snapshot.donor_details[String(entry.merged_id)] = structuredClone(
        record.mergedDetail,
      );
    }

    // Duplicate pairs: put back every pair the merge removed, in the order
    // they had. Pairs dismissed or added since stay as they are now.
    const current = new Map(snapshot.duplicates.map((p) => [p.id, p]));
    const before = record.duplicatesBefore;
    const beforeIds = new Set(before.map((p) => p.id));
    snapshot.duplicates = [
      ...before
        .filter((p) => current.has(p.id) || involves(p, entry.merged_id))
        .map((p) => current.get(p.id) ?? structuredClone(p)),
      ...snapshot.duplicates.filter((p) => !beforeIds.has(p.id)),
    ];

    entry.undone_at = new Date().toISOString();
    return { kept_id: entry.kept_id, restored_id: entry.merged_id };
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
  // Exported totals: an in-tab merge only moves gifts between donors, so the
  // sums stay right (donors_count may be one high until the next export).
  getTargets: async (period) => {
    const all = parseTargets((await loadSnapshot()).targets);
    return period ? { [period]: all[period] } : all;
  },

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
  importDonors: async (input) => {
    const snapshot = await loadSnapshot();
    const { donors, gifts, duplicates } = importRows(snapshot, input.rows);
    return {
      donors,
      gifts,
      duplicates,
      message: `Imported ${donors} donors and ${gifts} gifts into this tab (sample mode)`,
      raw: null,
    };
  },
  runContext: async (input) => {
    requireWebsite(input); // same rule as live, so the screen behaves the same
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
    // A requested cache read, not a failed live one: the header chip already
    // says "Cached sample · read-only".
    return {
      status: "done",
      served_from: "cache",
      cached: false,
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
  ask: async (question, filter, intent) =>
    askSnapshot(
      (await loadSnapshot()) as ApiSnapshotWithAsk,
      question,
      filter,
      intent,
    ),
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
  ...campaignSnapshotMethods(loadSnapshot, APPROVER_NAME),
};
