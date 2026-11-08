import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { ApprovalCard, StepCard } from "./AgentCards";

// The Call button is local mode only (the laptop service places the call).
vi.mock("../providers/local/config", async (orig) => ({
  ...(await orig<object>()),
  DATA_MODE: "local",
}));
vi.mock("../voice/PhoneCallDialog", () => ({ PhoneCallDialog: () => null, PhoneCallInline: () => null }));

const card = (tool: string) =>
  renderToString(
    <ApprovalCard
      approval={{ call_id: "c1", tool, args: { person_id: 5 } }}
      decided={false}
      disabled={false}
      onDecide={() => {}}
    />,
  );

describe("ApprovalCard", () => {
  it("a call card's buttons say Call and Not now", () => {
    const html = card("call_person");
    expect(html).toContain("Call</button>");
    expect(html).toContain("Not now</button>");
    expect(html).not.toContain("Approve</button>");
  });

  it("shows the service's plain summary instead of raw arguments", () => {
    const html = renderToString(
      <ApprovalCard
        approval={{ call_id: "c1", tool: "call_person", args: { person_id: 17 }, summary: "Call Elizabeth Fontaine at ***-***-0104" }}
        decided={false}
        disabled={false}
        onDecide={() => {}}
      />,
    );
    expect(html).toContain("Call Elizabeth Fontaine at ***-***-0104");
    expect(html).not.toContain("person id");
  });

  it("a send card says Send; other tools keep Approve and Decline", () => {
    expect(card("send")).toContain("Send</button>");
    const other = card("delete_task");
    expect(other).toContain("Approve</button>");
    expect(other).toContain("Decline</button>");
  });
});

describe("StepCard call sheet", () => {
  const sheet = {
    kind: "call_sheet",
    person_id: 7,
    name: "Elizabeth Fontaine",
    has_phone: true,
    phone_masked: "***-***-0104",
    relationship: {
      gift_count: 2,
      total: 350,
      first_gift: { date: "2024-03-01", amount: 100 },
      last_gift: { date: "2026-02-01", amount: 250 },
      usual_channel: "Online",
    },
    declined_charges: [{ date: "2026-10-10", amount: 40, status: "declined" }],
    interests: ["Arts"],
    recent_calls: [],
    open_tasks: [],
    facts: [],
    talking_points: ["Thank Elizabeth Fontaine for the $250 gift on 2026-02-01."],
  };
  const step = (card: object) => ({
    tool: "prep_call", args: {}, summary: "call sheet", status: "done" as const, undo_token: null, card,
  });

  it("renders the sheet with her masked phone, giving, a declined charge and talking points", () => {
    const html = renderToString(<StepCard step={step(sheet)} />).replace(/<!-- -->/g, "");
    expect(html).toContain("***-***-0104");
    expect(html).toContain("$350 across 2 gifts");
    expect(html).toContain("was declined");
    expect(html).toContain("Thank Elizabeth Fontaine");
    expect(html).toContain("Call</button>");
  });

  it("says No phone number on file and shows no Call button when there is none", () => {
    const html = renderToString(<StepCard step={step({ ...sheet, has_phone: false, phone_masked: null })} />);
    expect(html).toContain("No phone number on file");
    expect(html).not.toContain("Call</button>");
  });

  it("falls back to the plain card for an unknown card kind", () => {
    expect(renderToString(<StepCard step={step({ kind: "other" })} />)).toContain("Prep call");
  });
});

describe("StepCard: pairs the agent merged by itself", () => {
  it("lists each pair with its score, evidence and its own Undo", () => {
    const html = renderToString(
      <StepCard
        step={{
          tool: "resolve_duplicates",
          args: {},
          summary: "merged 2 sure pairs (80%+); 5 to confirm",
          status: "done",
          undo_token: null,
          card: {
            kind: "merged_pairs",
            pairs: [
              { suggestion_id: 1, kept: "Rosa Elena Martinez", merged_in: "Rosa E. Martinez", confidence: 0.9,
                evidence: "similar name + same phone: ***-***-0150", undo_token: "u1" },
              { suggestion_id: 2, kept: "Mildred Hayes", merged_in: "Millie Hayes", confidence: 0.9,
                evidence: "similar name + same phone: ***-***-0159", undo_token: "u2", undone: true },
            ],
          },
        }}
        onUndoPair={() => {}}
      />,
    );
    expect(html).toContain("Rosa E. Martinez → Rosa Elena Martinez");
    expect(html).toContain("90% match");
    expect(html).toContain("similar name + same phone: ***-***-0150");
    expect(html).toContain('aria-label="Undo merge of Rosa E. Martinez and Rosa Elena Martinez"');
    expect(html).not.toContain('aria-label="Undo merge of Millie Hayes and Mildred Hayes"');   // already undone
    expect(html).toContain("Undone · back in the review list");
  });

  it("a merge card for a pair to confirm says Merge and Keep separate", () => {
    const html = card("merge_duplicate");
    expect(html).toContain("Merge</button>");
    expect(html).toContain("Keep separate</button>");
  });
});

describe("StepCard: email prep", () => {
  const prep = {
    kind: "email_prep",
    topic: "Give Miami Day",
    person_ids: [4, 7],
    audience: { count: 2, names: ["Carmen Ibarra", "Priya Raman"] },
    last_time: null,
    since: [
      { fact: "A donated home produced the largest gift in its history.", url: "https://example.org/a", date: "2026-10-15" },
      { fact: "Two SET Summits trained 300+ nonprofit leaders.", url: "https://example.org/b", date: "2026-10-01" },
    ],
    coming_up: [{ title: "Give Miami Day", date: "2026-11-19" }],
    angle: "Here's what we've been doing: lead with (X), (Y) below, then invite them to Give Miami Day (2026-11-19).",
  };
  const step = { tool: "prep_email", args: {}, summary: "email prep", status: "done" as const, undo_token: null, card: prep };

  it("shows last time, X / Y with sources, what's coming, the angle and a Draft button", () => {
    const html = renderToString(<StepCard step={step} onAsk={() => {}} />).replace(/<!-- -->/g, "");
    expect(html).toContain("Email prep: Give Miami Day · 2 people");
    expect(html).toContain("No email to these people on record yet.");
    expect(html).toContain("largest gift in its history");
    expect(html).toContain('href="https://example.org/a"');
    expect(html).toContain("Give Miami Day (2026-11-19)");
    expect(html).toContain("Draft 2 emails</button>");
  });

  it("the Draft request carries the card's fact links; one person reads 'this person'", () => {
    let asked = "";
    const one = { ...prep, person_ids: [4], audience: { count: 1, names: ["Carmen Ibarra"] },
      facts_label: "Nothing new since 2026-11-07 · recent updates" };
    const html = renderToString(<StepCard step={{ ...step, card: one }} onAsk={(t) => (asked = t)} />).replace(/<!-- -->/g, "");
    expect(html).toContain("Nothing new since 2026-11-07 · recent updates");
    expect(html).toContain("No email to this person on record yet.");
    expect(html).toContain("Draft 1 email</button>");
    expect(asked).toBe("");                                        // nothing asked until the click
  });

  it("has no Draft button when nothing can ask the agent", () => {
    expect(renderToString(<StepCard step={step} />)).not.toContain("Draft 2 emails");
  });
});
