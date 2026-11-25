import snapshotJson from "../../../../../public/snapshot.json";
import { buildScript, SCENARIOS, type DemoSnapshot } from "./scenarios";

// The sample runs read the snapshot the public build serves: these pin them to its real records.
const snap = snapshotJson as unknown as DemoSnapshot;

describe("Try the agent scenarios", () => {
  it("has the four scenarios, each with a live prompt", () => {
    expect(SCENARIOS.map((s) => s.id)).toEqual(["lookup", "catch_up", "batch_email", "call"]);
    for (const s of SCENARIOS) expect(s.prompt.length).toBeGreaterThan(10);
  });

  it("1 · looks up Bernard Okoye from his CRM record, web findings with no links", () => {
    const script = buildScript("lookup", snap);
    expect(script.steps).toHaveLength(3);
    const card = script.cards[0];
    if (card.kind !== "lookup") throw new Error("expected a lookup card");
    expect(card.lookup.person_id).toBe(36);
    expect(card.lookup.org).toBe("Marrow Lane Print Co.");
    expect(card.lookup.crm[0]).toBe("First gift $2,500 on Oct 30 (by ACH)");
    expect(card.lookup.web).toHaveLength(3);
    expect(card.lookup.web.join(" ")).not.toMatch(/https?:/);
    expect(script.followUp?.summary).toMatch(/sample/);
  });

  it("2 · catches up on Hye-jin Park with her real giving and the declined charge", () => {
    const script = buildScript("catch_up", snap);
    const card = script.cards[0];
    if (card.kind !== "call_sheet") throw new Error("expected a call sheet");
    expect(card.title).toBe("Catch-up");
    const r = card.sheet.relationship;
    // 7 good gifts ($40 x4, $120, $100, $100); the Oct 10 $40 was declined and is not a gift.
    expect(r.gift_count).toBe(7);
    expect(r.total).toBe(480);
    expect(card.sheet.declined_charges).toEqual([{ date: "Oct 10", amount: 40, status: "declined" }]);
    expect(card.sheet.open_tasks.map((t) => t.title)).toContain("Call Hye-jin Park");
    expect(script.steps[1].summary).toBe("$480 across 7 gifts · Oct 10 charge declined");
  });

  it("3 · emails the 4 givers with nothing yet in 2026, from 3 sourced stories, behind a Send card", () => {
    const script = buildScript("batch_email", snap);
    const card = script.cards[0];
    if (card.kind !== "email_prep") throw new Error("expected email prep");
    expect(card.prep.audience.count).toBe(4);
    expect(card.prep.person_ids).toEqual([73, 33, 64, 68]);
    expect(card.prep.topic).toBe("Give Miami Day");
    expect(card.prep.since).toHaveLength(3);
    for (const f of card.prep.since) expect(f.url).toMatch(/^https:\/\/miamifoundation\.org\//);
    const approval = script.approval!.approval;
    expect(approval.tool).toBe("send");
    expect(approval.preview).toHaveLength(4);
    expect(approval.preview![1].to).toContain("María Delgado-Ruiz");
    expect(approval.preview![1].body).toContain("Dear María,");
    expect(approval.preview![1].body).toContain("$300 gift in Nov 2025");
    expect(approval.preview![0].body).toContain("Dear friends at Veloria Bay Foundation,");
    expect(script.approval!.approved.summary).toMatch(/nothing was sent/);
  });

  it("4 · calls Rafael Quintero: call sheet with a phone, a scripted call and its after-call notes", () => {
    const script = buildScript("call", snap);
    const card = script.cards[0];
    if (card.kind !== "call_sheet") throw new Error("expected a call sheet");
    expect(card.sheet.name).toBe("Rafael Quintero");
    expect(card.sheet.has_phone).toBe(true);
    expect(card.sheet.relationship.gift_count).toBe(10);
    expect(card.sheet.talking_points.join(" ")).toMatch(/skipped a monthly gift around Sep 18/);
    expect(card.call?.lines.length).toBeGreaterThan(4);
    expect(card.call?.next_steps).toHaveLength(2);
  });
});
