/**
 * #125 on the Vercel snapshot build (the test default): the "!" dialog's source records come from
 * snapshot.json's auto_merges; Keep/Split still refuse (live-only), and nothing but snapshot.json is fetched.
 */
import { getPersonMerges, reviewMerge } from "./merges";
import { LIVE_ONLY } from "./endpoint";

const merges = {
  person_id: 24,
  auto_merged: true,
  merged_from: 2,
  merges: [{
    id: 3, reviewed_at: null, review_action: null,
    sources: [
      { name: "Elizabeth Fontaine", email: "l***@example.com", phone: null, files: ["give_miami_day_export_2022-2025.xlsx"],
        locations: [], gift_ids: [], gift_count: 4, survivor: true, rule: null },
      { name: "Liz F.", email: "l***@example.com", phone: null, files: ["online_gifts_oct_nov_2026.xlsx"],
        locations: [], gift_ids: [], gift_count: 1, survivor: false, rule: "same email" },
    ],
  }],
};

describe("automatic-merge sources in the snapshot build", () => {
  const snapshot = {
    meta: { as_of: "2026-11-08", generated_at: "x", label: "Cached sample", donor_count: 1, source: "test" },
    donors: [], donor_details: {}, duplicates: [],
    auto_merges: { "24": merges },
  };
  const fetchSpy = vi.fn(async () => new Response(JSON.stringify(snapshot)));
  beforeAll(() => vi.stubGlobal("fetch", fetchSpy));
  afterAll(() => vi.unstubAllGlobals());

  it("lists the source records from snapshot.json", async () => {
    const got = await getPersonMerges(24);
    expect(got.merged_from).toBe(2);
    expect(got.merges[0].sources.map((s) => s.name)).toEqual(["Elizabeth Fontaine", "Liz F."]);
  });

  it("a person without an entry is still live-only", async () => {
    await expect(getPersonMerges(999)).rejects.toThrow(LIVE_ONLY);
  });

  it("keep and split refuse", async () => {
    await expect(reviewMerge(24, "keep")).rejects.toThrow(LIVE_ONLY);
    await expect(reviewMerge(24, "split")).rejects.toThrow(LIVE_ONLY);
  });

  it("fetches nothing but snapshot.json", () => {
    const urls = fetchSpy.mock.calls.map((c) => String((c as unknown as [string])[0]));
    expect(urls.every((u) => u.endsWith("snapshot.json"))).toBe(true);
  });
});
