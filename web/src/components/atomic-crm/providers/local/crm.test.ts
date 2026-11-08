import type { ApiSnapshot } from "./apiTypes";
import { crmHttpMethods, refreshTiming } from "./crmHttp";
import { SOCIAL_POSTING } from "./config";
import {
  NOT_RECORDED,
  buildApproval,
  parseChatResponse,
  parseSendBatch,
  parseContextStatus,
  parseCommunityStats,
  parseEventDetail,
  parsePeople,
  sourceFile,
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

  it("keeps a neighbor's notes and the file they came from (how we met)", () => {
    const [met, bare] = parsePeople(
      [
        { id: 15, full_name: "Gabriela Rincon", contact_type: "neighbor", notes: " Probably will give. ",
          source_row: "board_retreat_notes.md: line:35-36" },
        { id: 63, full_name: "Anil Deshmukh", contact_type: "neighbor", notes: "", source_row: null },
      ],
      "neighbor",
    ).people;
    expect(met).toMatchObject({ notes: "Probably will give.", source: "board_retreat_notes.md" });
    expect(bare).toMatchObject({ notes: null, source: null });
    expect(sourceFile("event_signin_sheet_nov1.xlsx: sheet:Nov 1 Open House:row 4")).toBe("event_signin_sheet_nov1.xlsx");
  });

  it("reads PR #60's people shape: counts, interests, tab_review, demographics", () => {
    const page = parsePeople(
      {
        type: "community",
        counts: { giver: 12, neighbor: 4, community: 9, needs_review: 2 },
        people: [
          {
            id: 1,
            full_name: "Rosa P.",
            contact_type: "community",
            interests: ["dogs"],
            has_dog: true,
            tab_review: "intake form and a gift: which tab?",
            demographics: {
              age_range: { value: "25-34", source_row: "intake row 4" },
              programs: { value: ["Arts Access", "Zero Drownings"], source_row: "x" },
              language: { value: "", source_row: "x" },
            },
          },
        ],
      },
      "community",
    );
    expect(page.counts).toEqual({ giver: 12, neighbor: 4, community: 9 });
    expect(page.needs_review).toBe(2); // the CRM-wide count the server reports
    const [rosa] = page.people;
    expect(rosa).toMatchObject({
      tab: "community",
      tags: ["dogs"],
      has_dog: true,
      needs_review: true,
      review_reason: "intake form and a gift: which tab?",
    });
    // Every Community field is listed; missing or empty ones read "not recorded".
    expect(rosa.demographics).toEqual([
      { label: "Age range", value: "25-34" },
      { label: "Gender", value: NOT_RECORDED },
      { label: "Household size", value: NOT_RECORDED },
      { label: "Zip", value: NOT_RECORDED },
      { label: "Language", value: NOT_RECORDED },
      { label: "Programs", value: "Arts Access, Zero Drownings" },
    ]);
  });

  it("shows only recorded demographics outside Community", () => {
    const page = parsePeople(
      { people: [{ id: 2, full_name: "Luis", contact_type: "giver", demographics: { zip: { value: "33133" } } }] },
      "giver",
    );
    expect(page.people[0].demographics).toEqual([{ label: "Zip", value: "33133" }]);
    expect(page.people[0].has_dog).toBeNull();
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

  it("reads PR #60's event fields: audience_hint, status, kind, rationale, batch_id", () => {
    const event = parseEventDetail({
      id: 4,
      title: "Puppy outreach day",
      starts_at: "2026-11-21",
      audience_hint: "People tagged with dogs, any tab",
      status: "upcoming",
      event_kind: "dog",
      rationale: "Only people with has_dog = true",
      batch_id: 9,
      recipients: [],
      drafts: [{ id: 1, body: "Bring your dog!", sms: "Bring your dog!", status: "draft" }],
    });
    expect(event).toMatchObject({
      audience: "People tagged with dogs, any tab",
      status: "upcoming",
      kind: "dog",
      rationale: "Only people with has_dog = true",
      batch_id: "9",
      drafts_ready: 1,
    });
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
  afterEach(() => {
    vi.unstubAllGlobals();
    refreshTiming.pollMs = 2000;
  });

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

  it("shows the service's own 503 reason, and explains a chat timeout", async () => {
    vi.stubGlobal("fetch", respond(503, { detail: "OPENAI_API_KEY is not set in .env" }));
    await expect(crmHttpMethods.chat([], "hi", { screen: "giver" })).rejects.toThrow(
      "OPENAI_API_KEY is not set in .env",
    );
    vi.stubGlobal("fetch", respond(504, { error: "agent_timeout", detail: "chat took longer than 60 s" }));
    await expect(crmHttpMethods.chat([], "hi", { screen: "giver" })).rejects.toThrow(
      "The chat agent took too long",
    );
  });

  it("parses PR #58's exact /chat response and prefers the server's counts", async () => {
    vi.stubGlobal(
      "fetch",
      respond(200, {
        reply: "I drafted 2 emails.",
        tab: "giver",
        steps: [{ tool: "find_people", args: { status: "lapsing" }, summary: "2 lapsing", status: "done" }],
        pending_batch: {
          id: 12,
          title: "Re-engage lapsing givers",
          channel: "email",
          counts: { total: 2, draft: 2, needs_individual_approval: 1, flagged: 0, bulk_approvable: 1 },
          items: [
            { id: 31, person_id: 1, full_name: "Maria Delgado", contact_type: "giver", channel: "email",
              to: "m***@example.com", subject: "s", body: "b",
              facts_used: [{ fact: "f", url: "https://example.org/f", date: "2026-10-01" }],
              needs_individual_approval: false, approval_reason: null, flags: [], status: "draft" },
            { id: 32, person_id: 4, full_name: "Biscayne Harbor FF", contact_type: "giver", channel: "email",
              to: "g***@example.org", subject: "s", body: "b", facts_used: [],
              needs_individual_approval: true, approval_reason: "organization donor", flags: [], status: "draft" },
          ],
        },
        batches: [],
      }),
    );
    const msg = await crmHttpMethods.chat([], "re-engage lapsing givers", { screen: "giver" });
    expect(msg.steps).toEqual([{ tool: "find_people", label: "Found people", summary: "2 lapsing", status: "done" }]);
    expect(msg.batch).toMatchObject({ id: "12", bulk_approvable: 1, needs_individual_approval: 1, flagged: 0 });
    expect(msg.batch?.items[0]).toMatchObject({ to: "m***@example.com", tab: "giver", facts_used: [{ fact: "f", source_url: "https://example.org/f" }] });
  });

  it("keeps the server's event order (upcoming first, then past)", async () => {
    vi.stubGlobal(
      "fetch",
      respond(200, [
        { id: 2, title: "Give Miami Day", starts_at: "2026-11-19" },
        { id: 3, title: "Give Miami 5K", starts_at: "2026-11-15" },
        { id: 1, title: "Past summit", starts_at: "2026-09-10" },
      ]),
    );
    expect((await crmHttpMethods.getEvents()).map((e) => e.id)).toEqual([2, 3, 1]);
  });

  it("plans an event's outreach and loads the batch by id", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ batch_id: 21, counts: { total: 3, bulk_approvable: 2, needs_individual_approval: 1, flagged: 0 } })),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: 21,
            name: "Give Miami Day invites",
            channel: "email",
            counts: { bulk_approvable: 2, needs_individual_approval: 1, flagged: 0 },
            messages: [
              { id: 5, donor_id: 1, donor_name: "Maria Delgado", channel: "email", body: "b", status: "draft",
                needs_individual_approval: false, flags: [] },
            ],
          }),
        ),
      );
    vi.stubGlobal("fetch", fetchMock);
    const plan = await crmHttpMethods.planEventOutreach(2);
    expect(plan).toEqual({ batch_id: "21", total: 3, bulk_approvable: 2, needs_individual_approval: 1, flagged: 0 });
    const batch = await crmHttpMethods.getSendBatch(plan.batch_id);
    expect(fetchMock.mock.calls.map((c) => [String(c[0]).replace(/^.*:\d+/, ""), c[1]?.method ?? "GET"])).toEqual([
      ["/events/2/plan", "POST"],
      ["/campaigns/21", "GET"],
    ]);
    expect(batch).toMatchObject({ id: "21", title: "Give Miami Day invites", bulk_approvable: 2 });
    expect(batch.items[0]).toMatchObject({ person_id: 1, name: "Maria Delgado", tab: "giver" });
  });

  it("explains a plan route that hasn't landed", async () => {
    vi.stubGlobal("fetch", respond(404, { detail: "Not Found" }));
    await expect(crmHttpMethods.planEventOutreach(2)).rejects.toThrow(
      "Planning event outreach isn't available yet",
    );
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
      batch_id: 7, // the service's ids are integers
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
    meta: { as_of: "2026-11-08", generated_at: "2026-11-07T12:00:00Z", label: "Cached sample", donor_count: 2, source: "test" },
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

  it("reports the snapshot's export time as its context status, and refuses refresh", async () => {
    const status = await crmSnapshotMethods.getContextStatus();
    expect(status.change_summary).toBe("Cached sample");
    await expect(crmSnapshotMethods.refreshContext()).rejects.toThrow("read-only snapshot");
  });
});

describe("context status (plan.md §17 amendment)", () => {
  // Local-time dates, so the label doesn't depend on the machine's timezone.
  const now = new Date(2026, 10, 7, 15, 0);
  const at = (day: number, hour: number, minute = 0) => new Date(2026, 10, day, hour, minute).toISOString();

  it("builds the label from the time and the change counts", () => {
    expect(parseContextStatus({ last_refreshed_at: at(7, 7), last_change: { new_events: 2 } }, now).label).toBe(
      "Context updated today 7:00 AM · 2 new events",
    );
    expect(parseContextStatus({ refreshed_at: at(6, 18, 30), new_events: 1, new_facts: 3 }, now).label).toBe(
      "Context updated yesterday 6:30 PM · 1 new event, 3 new facts",
    );
    expect(parseContextStatus({ last_refreshed_at: at(5, 7), new_events: 0 }, now).label).toBe(
      "Context updated Nov 5 7:00 AM · no changes",
    );
  });

  it("reads PR #60's last_run counts and errors", () => {
    const status = parseContextStatus(
      {
        last_refreshed_at: at(7, 7),
        last_run: { events_added: 2, events_changed: 1, facts_added: 0, errors: ["instagram: blocked"] },
      },
      now,
    );
    expect(status.label).toBe("Context updated today 7:00 AM · 2 new events, 1 changed event");
    expect(status.errors).toEqual(["instagram: blocked"]);
  });

  it("prefers the API's own summary, and covers never-run and running states", () => {
    expect(
      parseContextStatus({ last_refreshed_at: at(7, 7), last_change: { summary: "2 new events", new_events: 9 } }, now)
        .label,
    ).toBe("Context updated today 7:00 AM · 2 new events");
    expect(parseContextStatus({}, now).label).toBe("Context not updated yet");
    expect(parseContextStatus({ last_refreshed_at: at(7, 7), refreshing: true }, now).label).toBe(
      "Updating context…",
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    refreshTiming.pollMs = 2000;
  });

  it("refresh reads the status afterwards when the POST doesn't return it", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true })))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ last_refreshed_at: at(7, 7), last_change: { new_events: 2 } })),
      );
    vi.stubGlobal("fetch", fetchMock);
    const status = await crmHttpMethods.refreshContext();
    expect(fetchMock.mock.calls.map((c) => [String(c[0]).replace(/^.*:\d+/, ""), c[1]?.method ?? "GET"])).toEqual([
      ["/context/refresh", "POST"],
      ["/context/status", "GET"],
    ]);
    expect(status.new_events).toBe(2);
  });

  const paths = (fetchMock: ReturnType<typeof vi.fn>) =>
    fetchMock.mock.calls.map((c) => [String(c[0]).replace(/^.*:\d+/, ""), c[1]?.method ?? "GET"]);

  it("refresh waits for the background pass before reading the status", async () => {
    refreshTiming.pollMs = 0;
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: "refreshing" })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: "refreshing" })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: "done" })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ last_refreshed_at: at(7, 7) })));
    vi.stubGlobal("fetch", fetchMock);
    const status = await crmHttpMethods.refreshContext();
    expect(paths(fetchMock)).toEqual([
      ["/context/refresh", "POST"],
      ["/context/refresh", "GET"],
      ["/context/refresh", "GET"],
      ["/context/status", "GET"],
    ]);
    expect(status.last_refreshed_at).toBe(at(7, 7));
  });

  it("refresh names the sources a finished pass couldn't read", async () => {
    refreshTiming.pollMs = 0;
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: "refreshing" })))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ status: "done", changes: { facts: { failed_sources: ["website", "news"] } } })),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ last_refreshed_at: at(7, 7) })));
    vi.stubGlobal("fetch", fetchMock);
    const status = await crmHttpMethods.refreshContext();
    expect(status.unread_sources).toEqual(["website", "news"]);
  });

  it("refresh reports a failed pass with the service's detail, and stops polling", async () => {
    refreshTiming.pollMs = 0;
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: "refreshing" })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: "failed", detail: "site unreachable" })));
    vi.stubGlobal("fetch", fetchMock);
    await expect(crmHttpMethods.refreshContext()).rejects.toThrow("The refresh failed: site unreachable.");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("explains a status route that hasn't landed", async () => {
    vi.stubGlobal("fetch", respond(404, { detail: "Not Found" }));
    await expect(crmHttpMethods.getContextStatus()).rejects.toThrow("Context status isn't available yet");
  });

  it("keeps social posting behind a coming-soon flag", () => {
    expect(SOCIAL_POSTING).toBe("coming_soon");
  });
});

describe("approval rules (plan.md §17)", () => {
  // One batch with every kind of item the rule distinguishes.
  const batch = parseSendBatch({
    id: 1,
    items: [
      { id: 1, body: "ordinary giver", status: "draft" },
      { id: 2, body: "organization", needs_individual_approval: true, approval_reason: "organization donor", status: "draft" },
      { id: 3, body: "star donor", needs_individual_approval: true, approval_reason: "Shack Society level", status: "draft" },
      { id: 4, body: "big donor", needs_individual_approval: true, approval_reason: "big tier", status: "draft" },
      { id: 5, body: "prospect, server forgot the flag", contact_type: "prospect", status: "draft" },
      { id: 6, body: "prospect by id", prospect_id: 9, status: "draft" },
      { id: 7, body: "ordinary but flagged", flags: ["$5,000 not in record"], status: "draft" },
      { id: 8, body: "org and flagged", needs_individual_approval: true, flags: ["date not in record"], status: "draft" },
      { id: 9, body: "already sent", status: "sent" },
    ],
  });

  it("approval: never bulk-approves org/★/big or prospect items and never selects flagged ones", () => {
    // Prospects need individual approval even when the server leaves the flag off.
    expect(batch.items.filter((i) => i.needs_individual_approval).map((i) => i.id)).toEqual([2, 3, 4, 5, 6, 8]);
    expect(batch.items.find((i) => i.id === 5)?.approval_reason).toBe("Prospect organization");
    // A bulk approval selects only the ordinary, unflagged draft.
    expect(batch.bulk_approvable).toBe(1);
    expect(buildApproval(batch)).toEqual([{ id: 1, approve: true }]);
    // Restricted items go only when a person names each one.
    expect(buildApproval(batch, [2, 5])).toEqual([
      { id: 1, approve: true },
      { id: 2, approve: true },
      { id: 5, approve: true },
    ]);
    // Naming a flagged item is refused outright.
    expect(() => buildApproval(batch, [8])).toThrow("Flagged drafts can't be approved");
    expect(() => buildApproval(batch, [7])).toThrow("Flagged drafts can't be approved");
  });
});
