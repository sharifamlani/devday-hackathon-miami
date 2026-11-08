import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToString } from "react-dom/server";

import { interestKeys } from "../providers/local/interests";

import { AgentSummary, IssueAreas, readSummary } from "./DonorRowDetails";

describe("agent summary in the expanded donor row", () => {
  it("shows the paragraph, byline and date when the record has a summary", () => {
    const s = readSummary(
      { id: 1 },
      {
        summary: " Gives every April. ",
        summary_updated_at: "2026-11-08T12:00:00Z",
      },
    );
    expect(s.text).toBe("Gives every April.");
    const html = renderToString(<AgentSummary firstName="Veloria" {...s} />);
    expect(html).toContain("About Veloria");
    expect(html).toContain("written by the agent");
    expect(html).toContain("Gives every April.");
    expect(html).toContain("updated");
  });

  it("says No notes yet when the fields are absent or empty (snapshot)", () => {
    for (const rec of [undefined, {}, { summary: "  " }, { summary: null }]) {
      const s = readSummary(rec);
      expect(s.text).toBe("");
      const html = renderToString(<AgentSummary firstName="Veloria" {...s} />);
      expect(html).toContain("No notes yet.");
      expect(html).not.toContain("written by the agent");
    }
  });
});

describe("issue areas in the expanded donor row", () => {
  const render = (interests?: object[]) => {
    const client = new QueryClient();
    if (interests) client.setQueryData(interestKeys.person(1), interests);
    return renderToString(
      <QueryClientProvider client={client}>
        <IssueAreas personId={1} />
      </QueryClientProvider>,
    );
  };

  it("shows an empty line and the Tag issue area button when there are no tags", () => {
    const html = render([]);
    expect(html).toContain("No issue areas yet.");
    expect(html).toContain("Tag issue area");
  });

  it("marks staff-added tags as added by you and leaves agent tags plain", () => {
    const html = render([
      { tag: "education", set_by: "staff", sub_tag: null },
      {
        tag: "health",
        set_by: "agent",
        sub_tag: null,
        source_url: "https://example.org/a",
      },
    ]);
    expect(html).toContain("education · added by you");
    expect(html).not.toContain("health · added by you");
  });
});
