/**
 * B9 in the snapshot build (the test default: VITE_DATA_MODE unset), against an
 * OLDER snapshot.json without the home keys: reads fall back to their empty
 * value, writes refuse, and nothing but snapshot.json is fetched.
 */
import { getInterestTags, addInterest } from "./interests";
import { getHomeSummary, getPeopleAttention, getTargetQuarters } from "./homeSummary";
import { createTask, getTasks } from "./tasks";
import { getArtifacts, getCalendarFeed } from "./calendarFeed";
import { getPledges, proposeAfterCall } from "./voice";
import { searchContext } from "./contextSearch";
import { LIVE_ONLY } from "./endpoint";

describe("live-only endpoints in the snapshot build", () => {
  const oldSnapshot = {
    meta: { as_of: "2026-11-08", generated_at: "x", label: "Cached sample", donor_count: 0, source: "test" },
    donors: [],
    donor_details: {},
    duplicates: [],
  };
  const fetchSpy = vi.fn(async () => new Response(JSON.stringify(oldSnapshot)));
  beforeAll(() => vi.stubGlobal("fetch", fetchSpy));
  afterAll(() => vi.unstubAllGlobals());

  it("reads return empty values", async () => {
    expect(await getInterestTags()).toEqual([]);
    expect(await getHomeSummary()).toBeNull();
    expect(await getPeopleAttention()).toEqual([]);
    expect(await getTargetQuarters()).toBeNull();
    expect(await getTasks({ due: "today" })).toEqual([]);
    expect(await getCalendarFeed()).toEqual([]);
    expect(await getArtifacts()).toEqual([]);
    expect(await getPledges(1)).toEqual([]);
    expect(await searchContext({ q: "x" })).toEqual([]);
  });

  it("writes refuse with the live-only message", async () => {
    await expect(createTask({ title: "x" })).rejects.toThrow(LIVE_ONLY);
    await expect(addInterest(1, { tag: "arts" })).rejects.toThrow(LIVE_ONLY);
    await expect(proposeAfterCall(12)).rejects.toThrow(LIVE_ONLY);
  });

  it("fetches nothing but snapshot.json", () => {
    const urls = fetchSpy.mock.calls.map((c) => String((c as unknown as [string])[0]));
    expect(urls.every((u) => u.endsWith("snapshot.json"))).toBe(true);
  });
});
