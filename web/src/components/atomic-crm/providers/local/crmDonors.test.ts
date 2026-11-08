import type { CallNote } from "../../voice/callNotes";
import {
  callNotesForDonor,
  deriveOrganizations,
  donorTags,
  extrasFromDetail,
  filterDonors,
  givingSummary,
  isRecurring,
  lastGiftRange,
  LINKED_ORG_ID_BASE,
  maskEmail,
  maskPhone,
  orgKind,
  paginate,
  parseApiCallNotes,
  reasonLabel,
  sortDonors,
  sourceList,
  thankedAt,
  toDonorContact,
  type RawDonorDetail,
  type RawDonorRow,
  type TagInput,
} from "./crmDonors";

const AS_OF = "2026-11-08";

const row = (over: Partial<RawDonorRow> = {}): RawDonorRow => ({
  id: 1,
  full_name: "Ana Example",
  first_name: "Ana",
  last_name: "Example",
  org_name: null,
  donor_type: "individual",
  email: "ana.example@example.com",
  emails_all: ["ana.example@example.com"],
  phone: "+13055550199",
  city: "Miami",
  state: "FL",
  fund_type: null,
  notes: null,
  score: 50,
  tier: "mid",
  is_star: false,
  is_sample: true,
  status: "on_track",
  why: {
    status: "on_track",
    reasons: ["gave_recently_vs_cadence"],
    as_of: AS_OF,
    gift_count: 3,
    lifetime_total: 900,
    largest_gift: 400,
    last_gift: { date: "2026-10-01", amount: 300, channel: "online" },
    usual_cadence_days: 30,
  },
  score_as_of: AS_OF,
  source_row: "spring_list.csv#4",
  ...over,
});

const tagInput = (over: Partial<TagInput> = {}): TagInput => ({
  status: "on_track",
  score: 40,
  tier: "mid",
  is_star: false,
  gift_count: 3,
  first_gift_date: "2024-01-01",
  last_gift_date: "2026-10-01",
  thanked_at: null,
  ...over,
});

describe("donorTags", () => {
  it("marks a high-priority late donor as needing a call and late", () => {
    expect(
      donorTags(tagInput({ status: "lapsing", score: 89 }), AS_OF),
    ).toEqual(["needs_call", "late"]);
  });

  it("needs a call for a star or big donor even with a low score", () => {
    expect(
      donorTags(tagInput({ status: "due", score: 30, is_star: true }), AS_OF),
    ).toEqual(["needs_call"]);
    expect(
      donorTags(tagInput({ status: "due", score: 30, tier: "big" }), AS_OF),
    ).toEqual(["needs_call"]);
  });

  it("does not ask for a call once the donor was thanked after the last gift", () => {
    expect(
      donorTags(
        tagInput({
          status: "lapsing",
          score: 90,
          thanked_at: "2026-10-05T10:00:00Z",
        }),
        AS_OF,
      ),
    ).toEqual(["late", "thanked"]);
  });

  it("ignores a thank-you older than the last gift", () => {
    expect(
      donorTags(tagInput({ thanked_at: "2026-09-01T10:00:00Z" }), AS_OF),
    ).toEqual([]);
  });

  it("tags lapsed donors and recent first-time donors", () => {
    expect(donorTags(tagInput({ status: "lapsed" }), AS_OF)).toEqual([
      "lapsed",
    ]);
    expect(
      donorTags(
        tagInput({
          gift_count: 1,
          first_gift_date: "2026-10-22",
          last_gift_date: "2026-10-22",
        }),
        AS_OF,
      ),
    ).toEqual(["new"]);
    // A single gift long ago is not new.
    expect(
      donorTags(
        tagInput({
          gift_count: 1,
          first_gift_date: "2024-01-01",
          status: "lapsed",
        }),
        AS_OF,
      ),
    ).toEqual(["lapsed"]);
  });
});

describe("masking", () => {
  it("masks emails to the first letter and the domain", () => {
    expect(maskEmail("maria.delgado@example.com")).toBe("m•••@example.com");
    expect(maskEmail(null)).toBeNull();
    expect(maskEmail("noatsign")).toBe("•••");
  });

  it("keeps the last four phone digits", () => {
    expect(maskPhone("+13055550101")).toBe("•••-•••-0101");
    expect(maskPhone("(305) 555-0101")).toBe("•••-•••-0101");
    expect(maskPhone("")).toBeNull();
  });

  it("leaves values the API already masked alone", () => {
    expect(maskEmail("r***@example.com")).toBe("r***@example.com");
    expect(maskPhone("***-***-0101")).toBe("***-***-0101");
  });
});

describe("giving", () => {
  it("buckets the last gift by age", () => {
    expect(lastGiftRange("2026-10-01", AS_OF)).toBe("90d");
    expect(lastGiftRange("2026-01-15", AS_OF)).toBe("year");
    expect(lastGiftRange("2024-11-20", AS_OF)).toBe("older");
    expect(lastGiftRange(null, AS_OF)).toBe("none");
  });

  it("sums the gifts table, newest first by year", () => {
    const summary = givingSummary([
      { amount: 2500, gift_date: "2023-11-16" },
      { amount: 3000, gift_date: "2025-11-20" },
      { amount: 500, gift_date: "2025-03-01" },
    ]);
    expect(summary).toMatchObject({
      lifetime: 6000,
      largest: 3000,
      average: 2000,
      count: 3,
      first_gift_date: "2023-11-16",
      last_gift_date: "2025-11-20",
      last_gift_amount: 3000,
    });
    expect(summary.by_year).toEqual([
      { year: "2025", total: 3500, count: 2 },
      { year: "2023", total: 2500, count: 1 },
    ]);
  });

  it("handles a donor with no gifts", () => {
    expect(givingSummary([])).toMatchObject({
      lifetime: 0,
      count: 0,
      last_gift_date: null,
      by_year: [],
    });
  });

  it("calls monthly and quarterly givers with history recurring", () => {
    expect(isRecurring(30, 6)).toBe(true);
    expect(isRecurring(91, 3)).toBe(true);
    expect(isRecurring(364, 4)).toBe(false);
    expect(isRecurring(30, 2)).toBe(false);
    expect(isRecurring(null, 9)).toBe(false);
  });
});

describe("labels", () => {
  it("names score reasons in plain words, humanizing unknown keys", () => {
    expect(reasonLabel("missed_seasonal_window")).toBe(
      "Missed their usual season",
    );
    expect(reasonLabel("brand_new_reason")).toBe("Brand new reason");
  });

  it("reads the source list from source_row", () => {
    expect(sourceList("donors_2024.csv#12")).toBe("donors_2024.csv");
    expect(sourceList("SAMPLE")).toBe("Sample data");
    expect(sourceList(null)).toBe("Not recorded");
  });

  it("sorts organizations into foundations, households and businesses", () => {
    expect(orgKind("Biscayne Harbor Family Foundation")).toBe("foundation");
    expect(orgKind("The Rivera Family")).toBe("household");
    expect(orgKind("Harbor Bakery LLC")).toBe("business");
  });
});

describe("toDonorContact", () => {
  it("maps a row to an Atomic CRM contact with masked contact info", () => {
    const contact = toDonorContact(row(), AS_OF, {
      companyId: 7,
      companyName: "Harbor Bakery",
      overlay: { tags: [2], last_seen: "2026-11-01T12:00:00Z" },
      extras: { open_tasks: 2 },
    });
    expect(contact).toMatchObject({
      id: 1,
      first_name: "Ana",
      last_name: "Example",
      email: "a•••@example.com",
      phone: "•••-•••-0199",
      company_id: 7,
      company_name: "Harbor Bakery",
      tier: "mid",
      donor_status: "on_track",
      total_given: 900,
      largest_gift: 400,
      gift_count: 3,
      recurring: true,
      source: "spring_list.csv",
      last_gift_range: "90d",
      tags: [2],
      nb_tasks: 2,
      last_seen: "2026-11-01T12:00:00Z",
    });
    expect(JSON.stringify(contact)).not.toContain("ana.example@example.com");
  });

  it("reads interests sent as a JSON string", () => {
    expect(
      toDonorContact(row({ interests: '["arts", "youth programs"]' }), AS_OF)
        .interests,
    ).toEqual(["arts", "youth programs"]);
  });

  it("splits an organization's name without inventing a last name", () => {
    const org = toDonorContact(
      row({
        full_name: "Harbor Bakery",
        first_name: null,
        last_name: null,
        donor_type: "organization",
      }),
      AS_OF,
    );
    expect(org).toMatchObject({ first_name: "Harbor Bakery", last_name: "" });
  });
});

const detail = (over: Partial<RawDonorDetail> = {}): RawDonorDetail => ({
  ...row(),
  gifts: [
    {
      id: 1,
      donor_id: 1,
      amount: 300,
      gift_date: "2026-10-01",
      channel: null,
      fund_type: null,
    },
    {
      id: 2,
      donor_id: 1,
      amount: 200,
      gift_date: "2025-02-01",
      channel: null,
      fund_type: null,
    },
  ],
  research_facts: [],
  outreach_drafts: [
    {
      id: 9,
      donor_id: 1,
      channel: "email",
      subject: "Thank you",
      body: "…",
      status: "approved",
      approved_by: "Team",
      approved_at: "2026-10-03T09:00:00Z",
      created_at: "2026-10-02T09:00:00Z",
    },
    {
      id: 10,
      donor_id: 1,
      channel: "email",
      subject: "Next",
      body: "…",
      status: "ready",
      approved_by: null,
      approved_at: null,
      created_at: "2026-11-01T09:00:00Z",
    },
  ],
  ...over,
});

describe("details", () => {
  it("finds the thank-you, the drafts awaiting approval and the first gift", () => {
    expect(extrasFromDetail(detail())).toEqual({
      thanked_at: "2026-10-03T09:00:00Z",
      drafts_awaiting: 1,
      first_gift_date: "2025-02-01",
    });
  });

  it("only counts approvals after the last gift as thank-yous", () => {
    expect(
      thankedAt(
        [{ status: "sent", approved_at: "2026-09-01T00:00:00Z" }],
        "2026-10-01",
      ),
    ).toBeNull();
  });
});

describe("deriveOrganizations", () => {
  const rows = [
    row({ id: 1, org_name: "Harbor Bakery" }),
    row({ id: 2, org_name: "Harbor Bakery" }),
    row({
      id: 3,
      full_name: "Sunrise Foundation",
      org_name: "Sunrise Foundation",
      donor_type: "organization",
      first_name: null,
      last_name: null,
    }),
    row({ id: 4, org_name: "sunrise foundation" }),
  ];

  it("turns organization donors and shared org names into organizations", () => {
    const { organizations, orgOf } = deriveOrganizations(rows);
    expect(
      organizations.map((o) => [o.id, o.name, o.kind, o.nb_contacts]),
    ).toEqual([
      [LINKED_ORG_ID_BASE, "Harbor Bakery", "business", 2],
      [3, "Sunrise Foundation", "foundation", 1],
    ]);
    expect(orgOf.get(1)).toBe(LINKED_ORG_ID_BASE);
    expect(orgOf.get(3)).toBe(3);
    // Case-insensitive match onto the organization's own record.
    expect(orgOf.get(4)).toBe(3);
  });

  it("adds up what a linked organization's people gave", () => {
    const bakery = deriveOrganizations(rows).organizations[0];
    expect(bakery.total_given).toBe(1800);
    expect(bakery.gift_count).toBe(6);
  });
});

describe("filterDonors and sortDonors", () => {
  const contacts = [
    toDonorContact(
      row({ id: 1, full_name: "Ana Example", score: 89, status: "lapsing" }),
      AS_OF,
      {
        overlay: { tags: [1] },
      },
    ),
    toDonorContact(
      row({
        id: 2,
        full_name: "María Ruiz",
        first_name: "María",
        last_name: "Ruiz",
        score: 20,
        status: "lapsed",
        tier: "small",
        city: "Homestead",
        source_row: "SAMPLE",
        why: {
          status: "lapsed",
          reasons: [],
          as_of: AS_OF,
          gift_count: 1,
          lifetime_total: 50,
          last_gift: { date: "2023-01-01", amount: 50, channel: null },
        },
      }),
      AS_OF,
    ),
    toDonorContact(
      row({ id: 3, full_name: "Ben Example", score: 45, why: null }),
      AS_OF,
    ),
  ];

  it("filters by status tag, tier, last gift range, source and Atomic tags", () => {
    expect(
      filterDonors(contacts, { status_tag: "needs_call" }).map((c) => c.id),
    ).toEqual([1]);
    expect(filterDonors(contacts, { tier: "small" }).map((c) => c.id)).toEqual([
      2,
    ]);
    expect(
      filterDonors(contacts, { last_gift_range: "older" }).map((c) => c.id),
    ).toEqual([2]);
    expect(
      filterDonors(contacts, { last_gift_range: "none" }).map((c) => c.id),
    ).toEqual([3]);
    expect(
      filterDonors(contacts, { source: "Sample data" }).map((c) => c.id),
    ).toEqual([2]);
    expect(
      filterDonors(contacts, { "tags@cs": "{1}" }).map((c) => c.id),
    ).toEqual([1]);
  });

  it("searches names and cities without accents", () => {
    expect(filterDonors(contacts, { q: "maria" }).map((c) => c.id)).toEqual([
      2,
    ]);
    expect(filterDonors(contacts, { q: "homestead" }).map((c) => c.id)).toEqual(
      [2],
    );
    expect(filterDonors(contacts, { q: "" })).toHaveLength(3);
  });

  it("sorts by priority, lifetime and last gift, missing values last", () => {
    expect(sortDonors(contacts).map((c) => c.id)).toEqual([1, 3, 2]);
    expect(
      sortDonors(contacts, "total_given", "DESC").map((c) => c.id),
    ).toEqual([1, 2, 3]);
    expect(
      sortDonors(contacts, "last_gift_date", "DESC").map((c) => c.id),
    ).toEqual([1, 2, 3]);
    expect(
      sortDonors(contacts, "last_gift_date", "ASC").map((c) => c.id),
    ).toEqual([2, 1, 3]);
  });

  it("pages the result", () => {
    expect(paginate([1, 2, 3, 4, 5], { page: 2, perPage: 2 })).toEqual([3, 4]);
  });
});

describe("call notes", () => {
  const note = (id: string, createdAt: string, donorId: string): CallNote => ({
    id,
    title: `Call ${id}`,
    createdAt,
    durationSec: 60,
    destinations: [{ kind: "donor", id: donorId, label: "Donor" }],
    transcript: [],
    notes: "",
    summary: [],
    nextSteps: [],
  });

  it("parses the service's snake_case call notes and drops malformed ones", () => {
    const parsed = parseApiCallNotes([
      {
        id: "c1",
        title: "Check-in",
        created_at: "2026-11-07T21:22:00Z",
        duration_sec: 125,
        destinations: [{ kind: "donor", id: "1", label: "Ana" }],
        transcript: [{ speaker: "you", name: "You", text: "Hi", at: 0 }],
        notes: "Card expired",
        summary: ["Will update card"],
        next_steps: ["Send link"],
      },
      { title: "no id" },
      "junk",
    ]);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toMatchObject({
      id: "c1",
      durationSec: 125,
      nextSteps: ["Send link"],
      summary: ["Will update card"],
    });
    expect(parseApiCallNotes(undefined)).toEqual([]);
  });

  it("merges server and browser notes for one donor, newest first", () => {
    const server = [note("a", "2026-11-01T10:00:00Z", "1")];
    const browser = [
      note("a", "2026-11-01T10:00:00Z", "1"),
      note("b", "2026-11-05T10:00:00Z", "1"),
      note("c", "2026-11-06T10:00:00Z", "2"),
    ];
    expect(callNotesForDonor(1, server, browser).map((n) => n.id)).toEqual([
      "b",
      "a",
    ]);
  });
});
