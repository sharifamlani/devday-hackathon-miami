import { renderToString } from "react-dom/server";

import { AgentSummary, readSummary } from "./DonorRowDetails";

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
