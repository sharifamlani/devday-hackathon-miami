import type { ApiSnapshot } from "./apiTypes";
import { crmHttpMethods } from "./crmHttp";
import {
  NOT_RECORDED,
  parseChatResponse,
  parseCommunityStats,
  parseEventDetail,
  parsePeople,
  toTab,
} from "./crmParse";
import { crmSnapshotMethods } from "./crmSnapshot";
import { localApiMethods } from "./httpClient";

const respond = (status: number, body: unknown) =>
  vi.fn(async () => new Response(JSON.stringify(body), { status }));

describe("crmParse", () => {
  it("maps contact_type words to the three tabs", () => {
    expect(["giver", "donor", "neighbor", "prospect", "community", "beneficiary", "x"].map(toTab)).toEqual([
      "giver", "giver", "neighbor", "neighbor", "community", "community", null,
    ]);
  });

  it("reads counts for every tab and shows missing demographics as 'not recorded'", () => {
    const page = parsePeople(
      {
        items: [
          {
            id: 1,
            full_name: "Rosa P.",
            contact_type: "beneficiary",
            demographics: { age_group: "25-34", zip: null, household_size: "", language: "unknown" },
            tags: '["has a dog"]',
            needs_review: 1,
          },
        ],
        counts: { donor: 12, neighbor: 4, beneficiary: 9 },
      },
      "community",
    );
    expect(page.counts).toEqual({ giver: 12, neighbor: 4, community: 9 });
    expect(page.needs_review).toBe(1);
    const [rosa] = page.people;
    expect(rosa.tab).toBe("community");
    expect(rosa.tags).toEqual(["has a dog"]);
    expect(rosa.demographics).toEqual([
      { label: "Age group", value: "25-34" },
      { label: "Zip", value: NOT_RECORDED },
      { label: "Household size", value: NOT_RECORDED },
      { label: "Language", value: NOT_RECORDED },
    ]);
  });

  it("counts only the current tab when the API sends a bare list", () => {
    const page = parsePeople([{ id: 1, full_name: "A" }, { id: 2, full_name: "B" }], "neighbor");
    expect(page.counts).toEqual({ giver: null, neighbor: 2, community: null });
  });

  it("merges unrecorded buckets into one 'not recorded', kept last", () => {
    const stats = parseCommunityStats({
      total: 20,
      breakdowns: { age_group: { "18-24": 3, "25-34": 9, "": 2, null: 1, unknown: 5 } },
    });
    expect(stats.breakdowns).toEqual([
      {
        dimension: "Age group",
        buckets: [
          { label: "25-34", count: 9 },
          { label: "18-24", count: 3 },
          { label: NOT_RECORDED, count: 8 },
        ],
      },
    ]);
  });

  it("parses an event's audience and counts ready drafts", () => {
    const event = parseEventDetail({
      id: 3,
      title: "Give Miami Day",
      starts_at: "2026-11-19",
      url: "https://www.givemiamiday.org/",
      recipients: [{ person_id: 1, full_name: "Maria Delgado", contact_type: "giver", reason: "lapsing" }],
      drafts: [
        { id: 10, body: "Hi Maria", status: "draft" },
        { id: 11, body: "Hi Luis", status: "approved" },
      ],
    });
    expect(event.source_url).toBe("https://www.givemiamiday.org/");
    expect(event.recipients[0]).toEqual({ person_id: 1, name: "Maria Delgado", tab: "giver", reason: "lapsing" });
    expect(event.drafts_ready).toBe(1);
  });

  it("labels tool steps and counts what a bulk approval may cover", () => {
    const msg = parseChatResponse({
      reply: "Drafted 3 emails.",
      steps: [{ tool: "find_people", summary: "3 lapsing" }, { name: "draft_email", status: "error" }],
      pending_batch: {
        id: 7,
        items: [
          { id: 1, body: "a" },
          { id: 2, body: "b", needs_individual_approval: true },
          { id: 3, body: "c", flags: ["$5,000 not in record"] },
        ],
      },
    });
    expect(msg.steps.map((s) => [s.label, s.status])).toEqual([
      ["Found people", "done"],
      ["Drafted emails", "error"],
    ]);
    expect(msg.batch).toMatchObject({ id: "7", bulk_approvable: 1, needs_individual_approval: 1, flagged: 1 });
  });
});

describe("crmHttpMethods", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("asks for one tab's people", async () => {
    const fetchMock = respond(200, []);
    vi.stubGlobal("fetch", fetchMock);
    await crmHttpMethods.getPeople("community");
    expect(String((fetchMock.mock.calls[0] as unknown as [string])[0])).toMatch(/\/people\?type=community$/);
  });

  it("explains routes that haven't landed (503 and FastAPI's bare 404)", async () => {
    vi.stubGlobal("fetch", respond(503, {}));
    await expect(crmHttpMethods.getEvents()).rejects.toThrow("The calendar isn't available yet");
    vi.stubGlobal("fetch", respond(404, { detail: "Not Found" }));
    await expect(crmHttpMethods.getCommunityStats()).rejects.toThrow("Community stats isn't available yet");
  });

  it("keeps a real not-found message", async () => {
    vi.stubGlobal("fetch", respond(404, { detail: "event 9 not found" }));
    await expect(crmHttpMethods.getEvent(9)).rejects.toThrow("event 9 not found");
  });

  it("moves a person with PATCH /people/{id}", async () => {
    const fetchMock = respond(200, {});
    vi.stubGlobal("fetch", fetchMock);
    await crmHttpMethods.setTab(4, "neighbor");
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toMatch(/\/people\/4$/);
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(init.body as string)).toEqual({ contact_type: "neighbor" });
  });

  it("refuses to send without a named approver, before any request", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(crmHttpMethods.approveSendBatch("7", "  ")).rejects.toThrow("Add who is approving");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("posts the batch, approver and per-item decisions", async () => {
    const fetchMock = respond(200, { sent: 1, skipped: 1, blocked: [{ id: 3, reason: "flagged" }], simulated: true });
    vi.stubGlobal("fetch", fetchMock);
    const result = await crmHttpMethods.approveSendBatch("7", "Philanthropy team (demo)", [
      { id: 2, approve: true },
    ]);
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({
      batch_id: "7",
      approved_by: "Philanthropy team (demo)",
      items: [{ id: 2, approve: true }],
    });
    expect(result).toEqual({ sent: 1, skipped: 1, blocked: [{ id: 3, reason: "flagged" }], simulated: true });
  });

  it("uploads with the chosen target, 'auto' by default", async () => {
    const fetchMock = respond(200, {});
    vi.stubGlobal("fetch", fetchMock);
    await localApiMethods.uploadFiles([new File(["x"], "a.csv")]);
    await localApiMethods.uploadFiles([new File(["x"], "b.csv")], "community");
    const targets = fetchMock.mock.calls.map(
      (c) => ((c as unknown as [string, RequestInit])[1].body as FormData).get("target"),
    );
    expect(targets).toEqual(["auto", "community"]);
  });
});

describe("crmSnapshotMethods", () => {
  const snapshot: ApiSnapshot = {
    meta: { as_of: "2026-11-08", generated_at: "x", label: "Cached sample", donor_count: 2, source: "test" },
    donors: [
      { id: 1, full_name: "Maria Delgado", first_name: null, last_name: null, org_name: null, donor_type: "individual",
        email: null, emails_all: [], phone: null, city: "Miami", state: "FL", fund_type: null, notes: null,
        score: 89, tier: "mid", is_star: false, status: "lapsing", why: null, score_as_of: null },
      { id: 2, full_name: "Biscayne Harbor FF", first_name: null, last_name: null, org_name: "Biscayne Harbor FF",
        donor_type: "organization", email: null, emails_all: [], phone: null, city: "Miami", state: "FL",
        fund_type: null, notes: null, score: 45, tier: "big", is_star: true, status: "on_track", why: null, score_as_of: null },
    ],
    donor_details: Object.fromEntries(
      [1, 2].map((id) => [
        String(id),
        {
          ...(id === 1
            ? { full_name: "Maria Delgado", tier: "mid", is_star: false, donor_type: "individual" as const }
            : { full_name: "Biscayne Harbor FF", tier: "big", is_star: true, donor_type: "organization" as const }),
          id, first_name: null, last_name: null, org_name: null, email: null, emails_all: [], phone: null,
          city: null, state: null, fund_type: null, notes: null, score: 1, status: "lapsing", why: null,
          score_as_of: null, gifts: [], research_facts: [],
          outreach_drafts: [{ id: 100 + id, donor_id: id, channel: "email", subject: "s", body: `Hi ${id}`,
            status: "draft", approved_by: null, approved_at: null, created_at: "x" }],
        },
      ]),
    ),
    duplicates: [],
  };

  beforeAll(() => vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(snapshot)))));
  afterAll(() => vi.unstubAllGlobals());

  it("falls back to the snapshot's donors for Givers; other tabs stay empty", async () => {
    const givers = await crmSnapshotMethods.getPeople("giver");
    expect(givers.people.map((p) => p.name)).toEqual(["Maria Delgado", "Biscayne Harbor FF"]);
    expect(givers.counts).toEqual({ giver: 2, neighbor: 0, community: 0 });
    expect((await crmSnapshotMethods.getPeople("community")).people).toEqual([]);
    expect(await crmSnapshotMethods.getEvents()).toEqual([]);
  });

  it("returns a labeled canned chat run built from real drafts", async () => {
    const msg = await crmSnapshotMethods.chat([], "who should I call?", { screen: "giver" });
    expect(msg.demo).toBe(true);
    expect(msg.text).toMatch(/^Demo run \(cached sample\)/);
    expect(msg.batch?.items.map((i) => [i.name, i.needs_individual_approval])).toEqual([
      ["Maria Delgado", false],
      ["Biscayne Harbor FF", true],
    ]);
  });

  it("applies the approval rules: star/org only one by one, false skips", async () => {
    expect(await crmSnapshotMethods.approveSendBatch("demo-batch", "Demo")).toEqual({
      sent: 1,
      skipped: 0,
      blocked: [{ id: 102, reason: "needs individual approval" }],
      simulated: true,
    });
    expect(
      await crmSnapshotMethods.approveSendBatch("demo-batch", "Demo", [
        { id: 101, approve: false },
        { id: 102, approve: true },
      ]),
    ).toMatchObject({ sent: 1, skipped: 1, blocked: [] });
  });

  it("refuses tab moves in a read-only snapshot", async () => {
    await expect(crmSnapshotMethods.setTab(1, "neighbor")).rejects.toThrow("read-only snapshot");
  });
});
