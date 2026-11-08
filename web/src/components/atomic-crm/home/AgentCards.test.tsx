import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ApprovalCard } from "./AgentCards";

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

  it("a send card says Send; other tools keep Approve and Decline", () => {
    expect(card("send")).toContain("Send</button>");
    const other = card("merge_duplicate");
    expect(other).toContain("Approve</button>");
    expect(other).toContain("Decline</button>");
  });
});
