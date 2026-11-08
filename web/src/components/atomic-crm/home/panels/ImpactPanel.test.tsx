import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { CommunityStats } from "../../providers/local/crmTypes";
import type { DonationTarget } from "../../providers/local/types";
import {
  grantSummary,
  ImpactView,
  listFacts,
  NO_COMMUNITY,
  NO_FACTS,
  type ImpactFact,
} from "./ImpactPanel";

const fact = (
  id: number,
  posted_at: string,
  over: Partial<ImpactFact> = {},
): ImpactFact => ({
  id,
  source: "news",
  source_url: `https://example.org/story-${id}`,
  posted_at,
  fact: `Fact number ${id}`,
  quote: null,
  priority: "Civic",
  ...over,
});

const facts = [
  fact(1, "2026-08-31", { kind: "use_of_funds" }),
  fact(2, "2026-10-15", { kind: "org_health", title: "Newest headline" }),
  fact(3, "2026-10-01", { kind: "success_story" }),
  fact(4, "2026-09-23"),
  // the same statement read from a second source
  fact(5, "2026-10-15", { fact: "Fact number 2", source: "website" }),
];

const quarter = {
  label: "Q4 2026",
  raised: 98815,
  goal: 150000,
  goal_is_sample: true,
} as DonationTarget;

const stats: CommunityStats = {
  total: 15,
  as_of: null,
  note: null,
  trends: [],
  breakdowns: [
    {
      dimension: "Zip",
      buckets: [
        { label: "33142", count: 2 },
        { label: "33012", count: 12 },
        { label: "not recorded", count: 1 },
      ],
    },
    {
      dimension: "Programs",
      buckets: [
        { label: "Food pantry", count: 7 },
        { label: "After-school", count: 7 },
        { label: "not recorded", count: 1 },
      ],
    },
  ],
};

const unescape = (s: string) =>
  s
    .replace(/<!-- -->/g, "")
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, "&");
const view = (over: Record<string, unknown> = {}) =>
  unescape(
    renderToString(
      <ImpactView
        quarter={quarter}
        facts={facts}
        stats={stats}
        refreshedAt="2026-11-08 10:06:52"
        onCopy={() => {}}
        {...over}
      />,
    ),
  );

describe("ImpactPanel", () => {
  it("S2: lists facts newest first, once each, every one with a source link", () => {
    expect(listFacts(facts).map((f) => f.id)).toEqual([2, 3, 4, 1]);
    const html = view();
    const links = html.match(/href="https:\/\/example\.org\/story-\d"/g) ?? [];
    expect(links).toHaveLength(4);
    expect(html).toContain('target="_blank"');
    expect(html.indexOf("Newest headline")).toBeLessThan(
      html.indexOf("Fact number 3"),
    );
    expect(html).toContain("Success story");
    expect(html).toContain("Where the money goes");
  });

  it("collapses near-duplicates from the same page and date, keeps different facts", () => {
    const url =
      "https://miamifoundation.org/news/foundation-newsletter-september-2026/";
    const a = fact(21, "2026-10-01", {
      source_url: url,
      fact: "The Miami Foundation's partnership with McDermott Will & Schulte brought pro bono legal counsel to 17 Miami nonprofits, resulting in 398 hours of service valued at more than $500,000.",
    });
    const b = fact(22, "2026-10-01", {
      source_url: url,
      source: "website",
      fact: "The Miami Foundation partnered with McDermott Will & Schulte to bring pro bono legal counsel to 17 Miami nonprofits, resulting in 398 hours of service valued at more than $500,000.",
    });
    const other = fact(23, "2026-10-01", {
      source_url: url,
      fact: "Give Miami Day brought together 60,000+ donors who raised over $40 million for 1,000+ local nonprofits.",
    });
    const rows = listFacts([a, b, other]);
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.id).sort()).toEqual([21, 23]);
    expect(view({ facts: [a, b, other] }).match(/McDermott/g)).toHaveLength(1);
    // near-twin wording from another domain and date is a separate row; exact repeats still collapse
    const later = fact(24, "2026-10-02", {
      source_url: url,
      fact: a.fact + " ",
    });
    expect(
      listFacts([
        a,
        later,
        { ...b, source_url: "https://other.org/x", posted_at: "2026-09-01" },
      ]),
    ).toHaveLength(2);
  });

  it("shows 8 facts, then Show all", () => {
    const many = Array.from({ length: 11 }, (_, i) =>
      fact(i + 1, `2026-10-${10 + i}`),
    );
    const html = view({ facts: many });
    expect(html.match(/Fact number/g)).toHaveLength(8);
    expect(html).toContain("Show all 11");
    expect(
      view({ facts: many, defaultShowAll: true }).match(/Fact number/g),
    ).toHaveLength(11);
  });

  it("header, Q4 line with sample goal, and refresh time", () => {
    const html = view();
    expect(html).toContain("Impact & story");
    expect(html).toContain("Last refreshed Nov 8, 10:06 AM");
    expect(html).toContain("$98,815");
    expect(html).toContain("of $150,000 (sample goal)");
    expect(html).toContain("66%");
  });

  it("omits the refresh line when unknown", () => {
    expect(view({ refreshedAt: null })).not.toContain("Last refreshed");
  });

  it("S3: Who we serve is collapsed by default; expanded bars sum to the Community count", () => {
    expect(view()).toContain("Who we serve (15 people)");
    expect(view()).not.toContain("impact-bars-zip");
    const html = view({ defaultServeOpen: true });
    for (const name of ["zip", "programs"]) {
      const block = html
        .split(`data-testid="impact-bars-${name}"`)[1]
        .split("</dl>")[0];
      const counts = [...block.matchAll(/data-count[^>]*>(\d+)</g)].map((m) =>
        Number(m[1]),
      );
      expect(counts.reduce((a, b) => a + b, 0)).toBe(15);
      expect(block).toContain("not recorded");
    }
    expect(html).toContain(
      "Self-reported by people in the Community tab · 15 people",
    );
  });

  it("S3: programs are multi-select, so a larger sum is explained, not hidden", () => {
    expect(view({ defaultServeOpen: true })).not.toContain(
      "more than one program",
    );
    const multi = {
      ...stats,
      breakdowns: [
        stats.breakdowns[0],
        {
          dimension: "Programs",
          buckets: [
            { label: "Food pantry", count: 10 },
            { label: "After-school", count: 6 },
          ],
        },
      ],
    };
    const html = view({ stats: multi, defaultServeOpen: true });
    expect(html).toContain(
      "People can be in more than one program, so these add up to more than 15.",
    );
  });

  it("S4: the grant summary holds the Q4 line, 3 facts with URLs, and zip/program counts", () => {
    const text = grantSummary({ quarter, facts, stats });
    expect(text).toContain("Q4 2026: $98,815 of $150,000 (sample goal) (66%)");
    expect(text).toContain("- Fact number 2 (https://example.org/story-2)");
    expect(text).toContain("- Fact number 3 (https://example.org/story-3)");
    expect(text).toContain("- Fact number 4 (https://example.org/story-4)");
    expect(text).not.toContain("story-1)");
    expect(text).toContain("By zip: 33142 2, 33012 12, not recorded 1");
    expect(text).toContain(
      "By program: Food pantry 7, After-school 7, not recorded 1",
    );
    expect(view({ copied: true })).toContain("Copied");
    expect(view()).toContain("Copy for a grant report");
  });

  it("S-neg: says so plainly with no facts and no Community records", () => {
    const html = view({
      facts: [],
      stats: { ...stats, total: 0, breakdowns: [] },
    });
    expect(html).toContain(NO_FACTS);
    expect(html).toContain(NO_COMMUNITY);
    const text = grantSummary({ quarter, facts: [], stats: undefined });
    expect(text).not.toContain("Who we serve");
    expect(text).not.toContain("What we've done");
  });
});
