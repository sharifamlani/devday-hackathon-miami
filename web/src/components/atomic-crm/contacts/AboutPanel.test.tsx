import { renderToString } from "react-dom/server";

import { parseSummarySources } from "../providers/local/parse";
import type { DonorDetail } from "../providers/local/types";
import { AboutPanel, sourcesLine } from "./AboutPanel";

// renderToString marks text-node boundaries with <!-- -->; the reader sees one string.
const text = (html: string) => html.replace(/<!-- -->/g, "");

const donor = (extra: Partial<DonorDetail>) =>
  ({
    id: 7,
    full_name: "Rafael Quintero",
    summary: null,
    summary_updated_at: null,
    summary_sources: [],
    ...extra,
  }) as unknown as DonorDetail;

describe("AboutPanel", () => {
  it("shows the agent's paragraph, when it was updated and where it came from", () => {
    const html = text(
      renderToString(
        <AboutPanel
          donor={donor({
            summary:
              "Rafael would like to volunteer at the 5K. He talked about his wife, Anne.",
            summary_updated_at: "2026-11-08T15:04:00Z",
            summary_sources: [
              { kind: "chat", ref: "a1", at: "2026-11-08T15:04:00Z" },
              { kind: "call_note", ref: "n1", at: "2026-11-03T18:00:00Z" },
            ],
          })}
        />,
      ),
    );
    expect(html).toContain("About Rafael");
    expect(html).toContain("written by the agent");
    expect(html).toContain("updated Nov 8, 2026");
    expect(html).toContain("his wife, Anne");
    expect(html).toContain("From: chat Nov 8, call note Nov 3");
  });

  it("has an empty state that says how to add to it", () => {
    const html = text(renderToString(<AboutPanel donor={donor({})} />));
    expect(html).toContain("About Rafael");
    expect(html).toContain(
      "No notes yet. Tell the agent about a conversation, or save a call note.",
    );
    expect(html).not.toContain("From:");
  });
});

describe("summary sources", () => {
  it("parses leniently and keeps only known kinds", () => {
    expect(
      parseSummarySources([
        { kind: "gift", ref: 12, at: "2026-06-01" },
        { kind: "rumor", ref: "x", at: "2026-01-01" },
        { kind: "chat" },
        null,
      ]),
    ).toEqual([{ kind: "gift", ref: "12", at: "2026-06-01" }]);
    expect(parseSummarySources(undefined)).toEqual([]);
  });

  it("formats a date-only gift source", () => {
    expect(sourcesLine([{ kind: "gift", ref: "1", at: "2026-06-01" }])).toBe(
      "gift Jun 1",
    );
  });
});
