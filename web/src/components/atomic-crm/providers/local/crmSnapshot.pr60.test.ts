// Its own file: the snapshot is cached per module, and browser-mode vitest
// can't reset modules, so this export needs a fresh module instance.
import { crmSnapshotMethods } from "./crmSnapshot";

const crmSnapshot = {
  meta: { as_of: "2026-11-08", generated_at: "2026-11-07T12:00:00Z", label: "Cached sample", donor_count: 0, source: "test" },
  donors: [],
  donor_details: {},
  duplicates: [],
  // PR #60's keys
  people: {
    counts: { giver: 2, neighbor: 1, community: 0, needs_review: 0 },
    giver: [
      { id: 1, full_name: "Maria Delgado", contact_type: "giver" },
      { id: 2, full_name: "Biscayne Harbor FF", contact_type: "giver" },
    ],
    neighbor: [{ id: 5, full_name: "Sam Ruiz", contact_type: "neighbor" }],
    community: [],
  },
  events: [{ id: 7, title: "Give Miami Day", starts_at: "2026-11-19" }],
  event_details: {
    "7": {
      id: 7,
      title: "Give Miami Day",
      starts_at: "2026-11-19",
      recipients: [{ person_id: 1, full_name: "Maria Delgado", contact_type: "giver", reason: "lapsing" }],
      drafts: [{ id: 70, person_id: 1, full_name: "Maria Delgado", contact_type: "giver", body: "Hi", status: "draft" }],
    },
  },
};

describe("crmSnapshotMethods on PR #60's export", () => {
  beforeAll(() => vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(crmSnapshot)))));
  afterAll(() => vi.unstubAllGlobals());

  it("reads people by tab with the exported counts", async () => {
    const neighbors = await crmSnapshotMethods.getPeople("neighbor");
    expect(neighbors.people.map((p) => p.name)).toEqual(["Sam Ruiz"]);
    expect(neighbors.counts).toEqual({ giver: 2, neighbor: 1, community: 0 });
  });

  it("reads an event from event_details and plans a demo batch from its drafts", async () => {
    const event = await crmSnapshotMethods.getEvent(7);
    expect(event.recipients[0].reason).toBe("lapsing");
    const plan = await crmSnapshotMethods.planEventOutreach(7);
    expect(plan).toMatchObject({ batch_id: "demo-event-7", total: 1 });
    expect((await crmSnapshotMethods.getSendBatch(plan.batch_id)).items[0].name).toBe("Maria Delgado");
    expect(await crmSnapshotMethods.approveSendBatch(plan.batch_id, "Demo")).toMatchObject({ sent: 1, simulated: true });
  });
});
