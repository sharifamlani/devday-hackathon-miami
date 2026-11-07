import { describe, expect, it } from "vitest";

import type { ApiCampaignMessage, ApiCampaignsDemo } from "./campaigns";
import { campaignSnapshotMethods } from "./campaigns";

const message = (
  donorId: number,
  name: string,
  opts: Partial<ApiCampaignMessage> = {},
): ApiCampaignMessage => ({
  id: 0,
  campaign_id: 0,
  donor_id: donorId,
  donor_name: name,
  donor_type: "individual",
  tier: "mid",
  is_star: false,
  is_sample: true,
  why: null,
  needs_individual_approval: false,
  approval_reason: null,
  channel: "email",
  to: `${name[0].toLowerCase()}***@example.com`,
  subject: `Thank you, ${name}`,
  body: `Dear ${name}, thank you for your $3,000 gift.`,
  facts_used: [{ fact: "A fact", url: "https://example.org/f", date: null }],
  flags: [],
  drafted_by: "template",
  draft_note: "Cached sample",
  status: "draft",
  approved_by: null,
  approved_via: null,
  approved_at: null,
  sent_at: null,
  ...opts,
});

const demo = (): ApiCampaignsDemo => ({
  label: "Cached sample",
  campaigns: [],
  outbox: [],
  drafts: {
    "1": { "thank_you:email": message(1, "Maria") },
    "4": {
      "thank_you:email": message(4, "Biscayne", {
        is_star: true,
        needs_individual_approval: true,
        approval_reason: "Star donor",
      }),
    },
    "9": {
      "thank_you:email": message(9, "Knight", {
        donor_type: "organization",
        needs_individual_approval: true,
        to: null,
      }),
    },
  },
});

const methods = () =>
  campaignSnapshotMethods(
    async () => ({ campaigns_demo: demo() }),
    "Philanthropy team (demo)",
  );

describe("snapshot campaigns", () => {
  it("creates one draft per donor from the cached library", async () => {
    const m = methods();
    const c = await m.createCampaign({
      donor_ids: [1, 4, 9],
      intent: "thank_you",
      channel: "email",
    });
    expect(c.messages.map((x) => x.donor_name)).toEqual([
      "Maria",
      "Biscayne",
      "Knight",
    ]);
    expect(c.name).toBe("Thank you · Email · 3 donors");
    expect(c.counts.bulk_approvable).toBe(1);
    await expect(
      m.createCampaign({ donor_ids: [2], intent: "thank_you", channel: "email" }),
    ).rejects.toThrow(/local API/);
  });

  it("bulk-approves only small donors, then sends approved ones to the outbox", async () => {
    const m = methods();
    const c = await m.createCampaign({
      donor_ids: [1, 4, 9],
      intent: "thank_you",
      channel: "email",
    });
    const bulk = await m.approveSmallDrafts(c.id);
    expect(bulk).toEqual({ approved: 1, left_for_individual_approval: 2, flagged: 0 });
    const star = c.messages[1];
    const knight = c.messages[2];
    await m.updateCampaignMessage(c.id, star.id, { status: "approved" });
    await m.updateCampaignMessage(c.id, knight.id, { status: "approved" });

    const sent = await m.sendCampaign(c.id);
    expect(sent.sent).toBe(2);
    expect(sent.no_address).toEqual([
      { message_id: knight.id, donor_name: "Knight", reason: "no email on file" },
    ]);
    const outbox = await m.getOutbox();
    expect(outbox.map((o) => [o.donor_name, o.to, o.simulated])).toEqual([
      ["Biscayne", "b***@example.com", true],
      ["Maria", "m***@example.com", true],
    ]);
  });

  it("flags an edit with an invented amount and blocks its approval", async () => {
    const m = methods();
    const c = await m.createCampaign({
      donor_ids: [1],
      intent: "thank_you",
      channel: "email",
    });
    const id = c.messages[0].id;
    const edited = await m.updateCampaignMessage(c.id, id, {
      body: "Dear Maria, a $9,999 gift would help.",
    });
    expect(edited.flags[0]).toMatch(/\$9,999/);
    await expect(
      m.updateCampaignMessage(c.id, id, { status: "approved" }),
    ).rejects.toThrow(/flagged/);
    const fixed = await m.updateCampaignMessage(c.id, id, {
      body: "Dear Maria, thank you for your $3,000 gift.",
      status: "approved",
    });
    expect(fixed.status).toBe("approved");
  });
});
