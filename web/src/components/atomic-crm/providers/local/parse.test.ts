import type { ApiDonorDetail, ApiIcpProfile, ApiProspect } from "./apiTypes";
import {
  parseDonorDetail,
  parseIcp,
  parseProspect,
  parseProspectDetail,
} from "./parse";

// Maria Delgado as GET /donors/1 returned it on Sat Nov 7 (trimmed).
const maria: ApiDonorDetail = {
  id: 1,
  full_name: "Maria Delgado",
  first_name: "Maria",
  last_name: "Delgado",
  org_name: null,
  donor_type: "individual",
  email: "maria.delgado@example.com",
  emails_all: ["maria.delgado@example.com"],
  phone: "+13055550101",
  city: "Miami",
  state: "FL",
  fund_type: "Donor Advised",
  notes: null,
  score: 89,
  tier: "mid",
  is_star: false,
  is_sample: 1,
  status: "lapsing",
  score_as_of: "2026-11-08",
  why: {
    status: "lapsing",
    reasons: ["missed_seasonal_window", "loyal_repeat_giver"],
    points: { urgency: 55, value: 16.8, frequency: 9.6, engagement: 8 },
    gift_count: 4,
    lifetime_total: 11000,
    largest_gift: 3000,
    last_gift: { date: "2025-11-20", amount: 3000, channel: "Give Miami Day" },
    days_since_last_gift: 353,
    usual_cadence_days: 364,
    cadence_basis: "median_interval",
    overdue_ratio: 0.97,
    gave_this_year: false,
    pattern: {
      month: 11,
      month_name: "November",
      channel: "Give Miami Day",
      years: [2022, 2023, 2024, 2025],
      gave_this_year: false,
    },
    days_left_in_year: 53,
    give_miami_day: { date: "2026-11-19", days_away: 11 },
    as_of: "2026-11-08",
  },
  gifts: [],
  research_facts: [],
  outreach_drafts: [
    {
      id: 7,
      donor_id: 1,
      channel: "email",
      subject: "Maria, a Miami update",
      body: "Dear Maria,",
      status: "ready",
      approved_by: null,
      approved_at: null,
      created_at: "2026-11-07T21:18:11+00:00",
      call_script: "Opener: Hi Maria",
      facts_used: '[{"fact": "398 pro bono hours", "url": "https://example.org/a"}, {"fact": "no url"}]',
    },
  ],
};

describe("parseDonorDetail", () => {
  it("restates score.py's numbers without computing new ones", () => {
    const donor = parseDonorDetail(maria);
    expect(donor.score).toBe(89);
    expect(donor.is_sample).toBe(true);
    expect(donor.usual_cadence).toBe("yearly · Nov");
    expect(donor.why_short).toBe(
      "gave on Give Miami Day 2022–2025; not yet in 2026 · Give Miami Day in 11 days",
    );
    expect(donor.why).toContain("Give Miami Day is Thu, Nov 19, 11 days away.");
    expect(donor.score_factors.map((f) => [f.label, f.points, f.max])).toEqual([
      ["Urgency", 55, 55],
      ["Value", 16.8, 25],
      ["Frequency", 9.6, 12],
      ["Engagement", 8, 8],
    ]);
  });

  it("reads facts_used from JSON text and drops facts without a URL", () => {
    const { draft } = parseDonorDetail(maria);
    expect(draft?.facts_used).toEqual([
      { fact: "398 pro bono hours", source_url: "https://example.org/a" },
    ]);
    expect(draft?.call_script).toBe("Opener: Hi Maria");
  });

  it("guards a no_gifts donor whose why has only status and reasons", () => {
    const donor = parseDonorDetail({
      ...maria,
      score: 0,
      status: "no_gifts",
      why: { status: "no_gifts", reasons: ["no_gifts"], gift_count: 0, as_of: "2026-11-08" },
      outreach_drafts: [],
    });
    expect(donor.why_short).toBe("no gifts on record");
    expect(donor.score_factors).toEqual([]);
    expect(donor.last_gift_date).toBeNull();
  });
});

describe("parseIcp", () => {
  const evidence = [
    { donor: "Amazon", fact: "Committed $1M to South Dade", url: "https://example.org/amazon" },
  ];

  it("accepts traits as a list of objects with evidence", () => {
    const icp = parseIcp({
      id: 1,
      created_at: "2026-11-07T22:00:00Z",
      traits: [
        { name: "Causes funded", value: ["youth", "climate"], evidence },
      ],
      stats: { org_donor_count: 5, median_gift: 50000 },
      evidence: null,
    } as ApiIcpProfile);
    expect(icp.traits).toEqual([
      {
        label: "Causes funded",
        value: "youth, climate",
        evidence: [
          { donor: "Amazon", fact: "Committed $1M to South Dade", source_url: "https://example.org/amazon" },
        ],
      },
    ]);
    expect(icp.stats).toEqual([
      { label: "Org donor count", value: "5" },
      { label: "Median gift", value: "50,000" },
    ]);
  });

  it("reads 42's confirmed shape: {trait, value, evidence: [{donor, donor_id, fact, url}]}", () => {
    const icp = parseIcp({
      id: 3,
      created_at: "2026-11-07T23:00:00Z",
      traits: [
        {
          trait: "Geography",
          value: "Miami-Dade, South Dade",
          evidence: [{ donor: "Amazon", donor_id: 10, fact: "South Dade grants", url: "https://example.org/sd" }],
        },
      ],
      stats: { org_donors: 6 },
      evidence: [],
    });
    expect(icp.traits).toEqual([
      {
        label: "Geography",
        value: "Miami-Dade, South Dade",
        evidence: [{ donor: "Amazon", fact: "South Dade grants", source_url: "https://example.org/sd" }],
      },
    ]);
  });

  it("accepts traits as a JSON-text map of name to value", () => {
    const icp = parseIcp({
      id: 2,
      created_at: "2026-11-07T22:00:00Z",
      traits: JSON.stringify({ giving_style: "multi-year grants", geography: "Miami-Dade" }),
      stats: "not json",
      evidence: JSON.stringify(evidence),
    });
    expect(icp.traits.map((t) => [t.label, t.value])).toEqual([
      ["Giving style", "multi-year grants"],
      ["Geography", "Miami-Dade"],
    ]);
    expect(icp.stats).toEqual([]);
    expect(icp.evidence).toHaveLength(1);
  });
});

describe("parseProspect", () => {
  const prospect: ApiProspect = {
    id: 3,
    name: "Example Bank Foundation",
    org_type: "foundation",
    city: "Miami",
    fit_score: 82,
    matched_traits: '["Causes funded", "Geography"]',
    facts: [
      { fact: "Funds financial literacy in Miami-Dade", url: "https://example.org/bank" },
      { fact: "unsourced claim" },
    ],
    priority: "Generate Prosperity",
    status: "weird-status",
    created_at: "2026-11-07T22:00:00Z",
    outreach_drafts: [],
  };

  it("keeps only sourced facts and normalizes status", () => {
    const p = parseProspect(prospect);
    expect(p.matched_traits).toEqual(["Causes funded", "Geography"]);
    expect(p.facts).toEqual([
      { fact: "Funds financial literacy in Miami-Dade", source_url: "https://example.org/bank" },
    ]);
    expect(p.status).toBe("new");
  });

  it("returns null draft when there are no outreach drafts", () => {
    expect(parseProspectDetail(prospect).draft).toBeNull();
  });
});
