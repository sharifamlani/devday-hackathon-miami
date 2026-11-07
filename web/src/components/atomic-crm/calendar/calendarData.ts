import { useMutation } from "@tanstack/react-query";

import { useDonorDesk } from "../providers/local";
import type { CrmEvent, EventRecipient, Tab } from "../providers/local/crmTypes";
import { TABS } from "../providers/local/crmTypes";

/** Audience counts per tab, from an event's recipients. Tab-less people are skipped. */
export const countByTab = (recipients: EventRecipient[]): Record<Tab, number> => {
  const counts = Object.fromEntries(TABS.map((t) => [t, 0])) as Record<Tab, number>;
  for (const r of recipients) if (r.tab) counts[r.tab] += 1;
  return counts;
};

/** Events with an unparseable start date can't be placed on a calendar. */
export const placeable = (events: CrmEvent[]): CrmEvent[] =>
  events.filter((e) => !Number.isNaN(new Date(e.starts_at).getTime()));

export const sortByStart = (events: CrmEvent[]): CrmEvent[] =>
  [...events].sort(
    (a, b) => new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime(),
  );

export interface OutreachPlan {
  /** The chat batch holding the drafted invites, once the agent has built it. */
  batchId: string | null;
  title: string | null;
}

/**
 * The data layer's planEventOutreach(eventId) is not on every branch yet, so it
 * is reached through an optional signature. If it is missing we say so; we do
 * not pretend a plan was made.
 */
type PlanFn = (eventId: number) => Promise<unknown>;

const readPlan = (raw: unknown): OutreachPlan => {
  const r = (raw ?? {}) as Record<string, unknown>;
  const batch = (r.batch ?? null) as { id?: unknown; title?: unknown } | null;
  const id = r.batch_id ?? batch?.id ?? null;
  const title = batch?.title ?? r.title ?? null;
  return {
    batchId: id == null ? null : String(id),
    title: typeof title === "string" ? title : null,
  };
};

/** Review button: plan outreach for one event and report the batch id. */
export const usePlanEventOutreach = () => {
  const dataProvider = useDonorDesk() as unknown as {
    planEventOutreach?: PlanFn;
  };
  return useMutation({
    mutationFn: async (eventId: number): Promise<OutreachPlan> => {
      if (typeof dataProvider.planEventOutreach !== "function") {
        throw new Error("Planning outreach is not available in this build yet.");
      }
      return readPlan(await dataProvider.planEventOutreach(eventId));
    },
  });
};
