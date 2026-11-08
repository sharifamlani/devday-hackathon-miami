import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ApprovalCard, StepCard } from "./AgentCards";

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
