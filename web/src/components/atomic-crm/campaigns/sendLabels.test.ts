import { describe, expect, it } from "vitest";

import type { SendCampaignResult } from "../providers/local/campaignTypes";
import {
  campaignOutcomeLabel,
  outboxLabel,
  outboxOutcome,
  sendSummary,
} from "./sendLabels";

const base: SendCampaignResult = {
  simulated: true,
  sent: 0,
  no_address: [],
  failed: [],
  not_approved: 0,
};
const text = (r: SendCampaignResult) => sendSummary(r).map((s) => s.text);

describe("S1 dry run", () => {
  it("confirmation says dry run and that nothing was delivered", () => {
    expect(text({ ...base, sent: 3, providers: { dryrun: 3 } })).toEqual([
      "Dry run: 3 messages logged to the outbox. Nothing was delivered.",
    ]);
  });
  it("singular, and never says Sent", () => {
    const t = text({ ...base, sent: 1, providers: { dryrun: 1 } }).join(" ");
    expect(t).toContain("1 message logged");
    expect(t).not.toMatch(/\bSent\b/);
  });
  it("the row reads Dry run for provider=dryrun or simulated", () => {
    const row = {
      provider: "dryrun",
      simulated: true,
      delivery_status: "queued (dry run)",
    };
    expect(outboxLabel(row, "Nov 8")).toEqual({ text: "Dry run", tone: "dry" });
    expect(outboxOutcome({ simulated: true, provider: undefined })).toBe(
      "dryrun",
    );
  });
  it("an older service with no providers map is read from the simulated flag", () => {
    expect(text({ ...base, sent: 2 })[0]).toMatch(/^Dry run: 2 messages/);
  });
});

describe("S2 Gmail", () => {
  it("confirmation and row", () => {
    const r = { ...base, simulated: false, sent: 2, providers: { gmail: 2 } };
    expect(text(r)).toEqual(["Sent 2 via Gmail."]);
    expect(
      outboxLabel(
        { provider: "gmail", simulated: false, delivery_status: "sent" },
        "Nov 8, 3:30 PM",
      ),
    ).toEqual({ text: "Sent via Gmail · Nov 8, 3:30 PM", tone: "ok" });
  });
  it("a real send is never called simulated or dry run", () => {
    const t = text({
      ...base,
      simulated: false,
      sent: 1,
      providers: { gmail: 1 },
    }).join();
    expect(t).not.toMatch(/dry run|simulated|Nothing was delivered/i);
  });
});

describe("S3 SMS", () => {
  it("Twilio and Linq", () => {
    expect(
      text({ ...base, simulated: false, sent: 1, providers: { twilio: 1 } }),
    ).toEqual(["Sent 1 via Twilio."]);
    expect(
      text({ ...base, simulated: false, sent: 4, providers: { linq: 4 } }),
    ).toEqual(["Sent 4 via Linq."]);
    expect(
      outboxLabel({
        provider: "linq",
        simulated: false,
        delivery_status: "sent",
      }).text,
    ).toBe("Sent via Linq");
  });
});

describe("S-neg failed send", () => {
  it("shows Failed via Gmail in the error tone, never Sent", () => {
    const segs = sendSummary({
      ...base,
      simulated: false,
      failed: [
        {
          message_id: 1,
          donor_name: "Maria Delgado",
          reason: "failed: HttpError",
          provider: "gmail",
        },
      ],
    });
    expect(segs).toEqual([
      { text: "Failed via Gmail: Maria Delgado (HttpError).", tone: "error" },
    ]);
    expect(segs.map((s) => s.text).join()).not.toMatch(/\bSent\b/);
  });
  it("a failed outbox row", () => {
    const row = {
      provider: "gmail",
      simulated: false,
      delivery_status: "failed: HttpError",
    };
    expect(outboxOutcome(row)).toBe("failed");
    expect(outboxLabel(row)).toEqual({
      text: "Failed via Gmail: HttpError",
      tone: "error",
    });
  });
});

describe("S-neg2 mixed", () => {
  it("counts per outcome", () => {
    const segs = sendSummary({
      ...base,
      simulated: false,
      sent: 3,
      providers: { gmail: 2, dryrun: 1 },
      failed: [
        {
          message_id: 4,
          donor_name: "J Carter",
          reason: "failed: Timeout",
          provider: "gmail",
        },
      ],
      no_address: [
        {
          message_id: 9,
          donor_name: "Knight Foundation",
          reason: "no email on file",
        },
      ],
    });
    expect(segs.map((s) => s.text)).toEqual([
      "Sent 2 via Gmail.",
      "Dry run: 1 message logged to the outbox. Nothing was delivered.",
      "Failed via Gmail: J Carter (Timeout).",
      "Not sent, no address: Knight Foundation (no email on file).",
    ]);
  });
  it("campaign list labels", () => {
    const dry = {
      provider: "dryrun",
      simulated: true,
      delivery_status: "queued (dry run)",
    };
    const gm = { provider: "gmail", simulated: false, delivery_status: "sent" };
    expect(campaignOutcomeLabel([]).text).toBe("Completed");
    expect(campaignOutcomeLabel([dry, dry]).text).toBe("Dry run");
    expect(campaignOutcomeLabel([gm]).text).toBe("Sent via Gmail");
    expect(campaignOutcomeLabel([gm, dry]).text).toBe(
      "Sent via Gmail + dry run",
    );
  });
});
