import type { ApiProspect, ApiSnapshot } from "./apiTypes";
import { snapshotMethods } from "./snapshotClient";

const prospectRow = (id: number, fit: number, status = "new"): ApiProspect => ({
  id,
  name: `Prospect ${id}`,
  org_type: "foundation",
  city: "Miami",
  fit_score: fit,
  matched_traits: ["Geography"],
  facts: [{ fact: `Fact ${id}`, url: `https://example.org/${id}` }],
  priority: "Generate Prosperity",
  status,
  created_at: "2026-11-07T23:00:00Z",
});

// The shape export_snapshot.py writes since PR #15: list rows without
// drafts, plus prospect_details keyed by id (like donor_details).
const snapshot: ApiSnapshot = {
  meta: {
    as_of: "2026-11-08",
    generated_at: "2026-11-07T23:00:00Z",
    label: "Cached sample",
    donor_count: 0,
    source: "test",
  },
  donors: [],
  donor_details: {},
  duplicates: [],
  icp: {
    id: 1,
    created_at: "2026-11-07T23:00:00Z",
    traits: [{ trait: "Geography", value: "Miami-Dade", evidence: [] }],
    stats: { org_donors: 6 },
    evidence: [],
  },
  prospects: [prospectRow(1, 60), prospectRow(2, 90), prospectRow(3, 99, "dismissed")],
  prospect_details: {
    "2": {
      ...prospectRow(2, 90),
      outreach_drafts: [
        {
          id: 41,
          donor_id: 0,
          channel: "email",
          subject: "Hello from The Miami Foundation",
          body: "First touch",
          status: "draft",
          approved_by: null,
          approved_at: null,
          created_at: "2026-11-07T23:00:00Z",
          facts_used: [{ fact: "Fact 2", url: "https://example.org/2" }],
        },
      ],
    },
  },
};

describe("snapshotMethods: ICP + prospects", () => {
  beforeAll(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify(snapshot), { status: 200 })),
    );
  });
  afterAll(() => vi.unstubAllGlobals());

  it("reads the ICP", async () => {
    const icp = await snapshotMethods.getIcp();
    expect(icp?.traits[0]).toMatchObject({ label: "Geography", value: "Miami-Dade" });
    expect(icp?.stats).toEqual([{ label: "Org donors", value: "6" }]);
  });

  it("lists prospects best fit first, without dismissed ones", async () => {
    const list = await snapshotMethods.getProspects();
    expect(list.map((p) => [p.id, p.fit_score])).toEqual([
      [2, 90],
      [1, 60],
    ]);
  });

  it("reads drafts from prospect_details and falls back to the list row", async () => {
    expect((await snapshotMethods.getProspect(2)).draft?.subject).toBe(
      "Hello from The Miami Foundation",
    );
    expect((await snapshotMethods.getProspect(1)).draft).toBeNull();
  });

  it("approves a prospect draft in memory and dismisses a prospect", async () => {
    await snapshotMethods.approveDraft(41, "Edited first touch");
    const draft = (await snapshotMethods.getProspect(2)).draft;
    expect(draft?.status).toBe("approved");
    expect(draft?.body).toBe("Edited first touch");

    await snapshotMethods.dismissProspect(1);
    expect((await snapshotMethods.getProspects()).map((p) => p.id)).toEqual([2]);
  });

  it("refuses agent runs in snapshot mode", async () => {
    await expect(snapshotMethods.draftProspectOutreach(2)).rejects.toThrow(
      "read-only snapshot",
    );
  });
});
