import { useCallback, useSyncExternalStore } from "react";
import { useGetIdentity } from "ra-core";

import { isIsoDate } from "./dates";

/**
 * The outreach plan: which donors or campaigns staff mean to contact on which
 * day, and whether it is done. Kept per viewer in this browser's localStorage
 * (local and snapshot mode alike); it never reaches the donor service.
 * FOLLOW-UP: a server table (outreach_plan: date, donor_id | campaign_id,
 * note, done, planned_by) so the plan is shared across staff and devices.
 */
export interface OutreachPlanItem {
  id: string;
  date: string; // YYYY-MM-DD, local calendar day
  donor_id: number | null;
  campaign_id: number | null;
  /** Donor or campaign name when it was planned, so the plan reads without a fetch. */
  label: string;
  note: string;
  done: boolean;
  /** "agent" when it came from a recommendation, "staff" when picked by hand. */
  source: "staff" | "agent";
  created_at: string; // ISO timestamp
}

export interface NewPlanItem {
  date: string;
  donor_id?: number | null;
  campaign_id?: number | null;
  label: string;
  note?: string;
  source?: OutreachPlanItem["source"];
}

export const PLAN_STORAGE_PREFIX = "donor-desk:outreach-plan:v1";

export const planStorageKey = (viewer: string | number | null | undefined) =>
  `${PLAN_STORAGE_PREFIX}:${viewer == null || viewer === "" ? "guest" : String(viewer)}`;

const isId = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value);

/** Keeps only well-formed items; anything else in storage is ignored, never thrown. */
export const parsePlan = (raw: string | null): OutreachPlanItem[] => {
  if (!raw) return [];
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(data)) return [];
  return data.flatMap((entry): OutreachPlanItem[] => {
    if (!entry || typeof entry !== "object") return [];
    const item = entry as Record<string, unknown>;
    const donorId = isId(item.donor_id) ? item.donor_id : null;
    const campaignId = isId(item.campaign_id) ? item.campaign_id : null;
    if (typeof item.id !== "string" || !isIsoDate(item.date)) return [];
    if ((donorId == null) === (campaignId == null)) return [];
    return [
      {
        id: item.id,
        date: item.date,
        donor_id: donorId,
        campaign_id: campaignId,
        label: typeof item.label === "string" ? item.label : "",
        note: typeof item.note === "string" ? item.note : "",
        done: item.done === true,
        source: item.source === "agent" ? "agent" : "staff",
        created_at: typeof item.created_at === "string" ? item.created_at : "",
      },
    ];
  });
};

export const readPlan = (
  storage: Pick<Storage, "getItem"> | null,
  key: string,
): OutreachPlanItem[] => {
  if (!storage) return [];
  try {
    return parsePlan(storage.getItem(key));
  } catch {
    return [];
  }
};

/** false when the browser refused (private mode, quota); the plan then lives in memory. */
export const writePlan = (
  storage: Pick<Storage, "setItem"> | null,
  key: string,
  items: OutreachPlanItem[],
): boolean => {
  if (!storage) return false;
  try {
    storage.setItem(key, JSON.stringify(items));
    return true;
  } catch {
    return false;
  }
};

const sameTarget = (
  item: Pick<OutreachPlanItem, "donor_id" | "campaign_id">,
  target: { donor_id?: number | null; campaign_id?: number | null },
) =>
  target.donor_id != null
    ? item.donor_id === target.donor_id
    : target.campaign_id != null && item.campaign_id === target.campaign_id;

let counter = 0;
const newId = (now: Date) =>
  `plan-${now.getTime().toString(36)}-${(counter += 1).toString(36)}`;

/**
 * Adds one donor or campaign to a day. Returns the same array when it is
 * already planned that day or the input names neither or both targets.
 */
export const addPlanItem = (
  items: OutreachPlanItem[],
  input: NewPlanItem,
  now: Date = new Date(),
): OutreachPlanItem[] => {
  const donorId = input.donor_id ?? null;
  const campaignId = input.campaign_id ?? null;
  if (!isIsoDate(input.date) || (donorId == null) === (campaignId == null)) {
    return items;
  }
  if (
    items.some(
      (item) =>
        item.date === input.date &&
        sameTarget(item, { donor_id: donorId, campaign_id: campaignId }),
    )
  ) {
    return items;
  }
  return [
    ...items,
    {
      id: newId(now),
      date: input.date,
      donor_id: donorId,
      campaign_id: campaignId,
      label: input.label,
      note: input.note?.trim() ?? "",
      done: false,
      source: input.source ?? "staff",
      created_at: now.toISOString(),
    },
  ];
};

export const updatePlanItem = (
  items: OutreachPlanItem[],
  id: string,
  patch: Partial<Pick<OutreachPlanItem, "note" | "done" | "date">>,
): OutreachPlanItem[] =>
  items.map((item) =>
    item.id === id
      ? {
          ...item,
          ...patch,
          date: patch.date && isIsoDate(patch.date) ? patch.date : item.date,
        }
      : item,
  );

export const removePlanItem = (
  items: OutreachPlanItem[],
  id: string,
): OutreachPlanItem[] => items.filter((item) => item.id !== id);

/** One day's items: open ones first, then done, each in the order planned. */
export const itemsOn = (
  items: OutreachPlanItem[],
  date: string,
): OutreachPlanItem[] =>
  items
    .filter((item) => item.date === date)
    .sort((a, b) => Number(a.done) - Number(b.done));

/** Is this donor or campaign already planned (open) on or after `from`? */
export const isPlannedFrom = (
  items: OutreachPlanItem[],
  target: { donor_id?: number | null; campaign_id?: number | null },
  from: string,
): boolean =>
  items.some(
    (item) => !item.done && item.date >= from && sameTarget(item, target),
  );

/* ---------- Shared store: every card and page sees the same plan ---------- */

const cache = new Map<string, OutreachPlanItem[]>();
const failedWrites = new Set<string>();
const listeners = new Set<() => void>();

const browserStorage = (): Storage | null => {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
};

const notify = () => listeners.forEach((listener) => listener());

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  // Another tab of the same viewer changed the plan: drop our copy.
  const onStorage = (event: StorageEvent) => {
    if (event.key == null || event.key.startsWith(PLAN_STORAGE_PREFIX)) {
      if (event.key) cache.delete(event.key);
      else cache.clear();
      listener();
    }
  };
  if (typeof window !== "undefined") {
    window.addEventListener("storage", onStorage);
  }
  return () => {
    listeners.delete(listener);
    if (typeof window !== "undefined") {
      window.removeEventListener("storage", onStorage);
    }
  };
};

const snapshotFor = (key: string): OutreachPlanItem[] => {
  let items = cache.get(key);
  if (!items) {
    items = readPlan(browserStorage(), key);
    cache.set(key, items);
  }
  return items;
};

const commit = (key: string, next: OutreachPlanItem[]) => {
  if (next === cache.get(key)) return;
  cache.set(key, next);
  if (writePlan(browserStorage(), key, next)) failedWrites.delete(key);
  else failedWrites.add(key);
  notify();
};

/** Test hook: forget the in-memory copies. */
export const resetPlanStoreForTests = () => {
  cache.clear();
  failedWrites.clear();
};

/**
 * The viewer's outreach plan. `saved` is false when the browser would not
 * store it; the plan then lasts only while this tab is open.
 */
export const useOutreachPlan = () => {
  const { identity } = useGetIdentity();
  const key = planStorageKey(identity?.id ?? null);
  const items = useSyncExternalStore(
    subscribe,
    () => snapshotFor(key),
    () => snapshotFor(key),
  );
  const saved = useSyncExternalStore(
    subscribe,
    () => !failedWrites.has(key),
    () => true,
  );

  const add = useCallback(
    (input: NewPlanItem) => {
      const before = snapshotFor(key);
      const next = addPlanItem(before, input);
      commit(key, next);
      return next !== before;
    },
    [key],
  );
  const update = useCallback(
    (
      id: string,
      patch: Partial<Pick<OutreachPlanItem, "note" | "done" | "date">>,
    ) => commit(key, updatePlanItem(snapshotFor(key), id, patch)),
    [key],
  );
  const remove = useCallback(
    (id: string) => commit(key, removePlanItem(snapshotFor(key), id)),
    [key],
  );

  return { items, saved, add, update, remove };
};
