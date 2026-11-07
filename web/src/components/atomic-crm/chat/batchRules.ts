/**
 * The approval rules for a pending batch, as the card applies them (plan.md
 * §17; the data layer and the service enforce them again):
 * - flagged items never send and can't be ticked;
 * - ★ / big-tier / organization items start unticked and go only when a
 *   person ticks them one by one;
 * - everything else starts ticked;
 * - a named approver is required.
 */
import type { PerItemApproval, SendBatch, SendItem } from "../providers/local/crmTypes";

export type ItemKind = "ok" | "individual" | "flagged";

export const itemKind = (item: SendItem): ItemKind =>
  item.flags.length ? "flagged" : item.needs_individual_approval ? "individual" : "ok";

/** Items still waiting (already-sent ones are shown but not offered). */
export const openItems = (batch: SendBatch) =>
  batch.items.filter((i) => i.status !== "sent");

/** Ticked by default: only the items a bulk approval may cover. */
export const defaultSelection = (batch: SendBatch): Set<number> =>
  new Set(openItems(batch).filter((i) => itemKind(i) === "ok").map((i) => i.id));

/** Flagged items can never be ticked; ticking one is ignored. */
export const toggleItem = (batch: SendBatch, selected: Set<number>, id: number) => {
  const item = batch.items.find((i) => i.id === id);
  if (!item || itemKind(item) === "flagged") return selected;
  const next = new Set(selected);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
};

/** An explicit decision for every open, unflagged item. */
export const perItemFor = (batch: SendBatch, selected: Set<number>): PerItemApproval =>
  openItems(batch)
    .filter((i) => itemKind(i) !== "flagged")
    .map((i) => ({ id: i.id, approve: selected.has(i.id) }));

export const approvedCount = (batch: SendBatch, selected: Set<number>) =>
  perItemFor(batch, selected).filter((d) => d.approve).length;

export const channelCounts = (batch: SendBatch) => {
  const counts = { email: 0, text: 0 };
  for (const item of openItems(batch)) counts[item.channel]++;
  return counts;
};

export const canSend = (batch: SendBatch, selected: Set<number>, approver: string) =>
  approver.trim().length > 0 && approvedCount(batch, selected) > 0;

export const flagReason = (item: SendItem) =>
  item.flags.length ? item.flags.join(", ") : null;
