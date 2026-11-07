/** Shared test data: one batch covering every approval rule. */
import type { SendBatch, SendItem } from "../providers/local/crmTypes";

const item = (id: number, over: Partial<SendItem> = {}): SendItem => ({
  id,
  person_id: id,
  name: `Person ${id}`,
  tab: "giver",
  channel: "email",
  to: `p${id}@example.org`,
  subject: "Hello",
  body: "Body",
  facts_used: [],
  needs_individual_approval: false,
  approval_reason: null,
  flags: [],
  status: "draft",
  ...over,
});

export const batch: SendBatch = {
  id: "b1",
  title: "Give Miami Day reminders",
  items: [
    item(1),
    item(2, { channel: "text" }),
    item(3, { needs_individual_approval: true, approval_reason: "★ Shack Society" }),
    item(4, { flags: ["mentions a gift amount"] }),
    item(5, { status: "sent" }),
  ],
  bulk_approvable: 2,
  needs_individual_approval: 1,
  flagged: 1,
};
