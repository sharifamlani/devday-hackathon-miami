/**
 * B9 in the snapshot build (the test default: VITE_DATA_MODE unset). These
 * endpoints are live only: reads return their empty value and writes refuse,
 * all without a request.
 */
import { getInterestTags, addInterest } from "./interests";
import { getHomeSummary, getPeopleAttention, getTargetQuarters } from "./homeSummary";
import { createTask, getTasks } from "./tasks";
import { getArtifacts, getCalendarFeed } from "./calendarFeed";
import { getCallNotes, saveCallNote } from "./voice";
import { searchContext } from "./contextSearch";
import { LIVE_ONLY } from "./endpoint";

describe("live-only endpoints in the snapshot build", () => {
  const fetchSpy = vi.fn();
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
    expect(await getCallNotes(1)).toEqual([]);
    expect(await searchContext({ q: "x" })).toEqual([]);
  });

  it("writes refuse with the live-only message", async () => {
    await expect(createTask({ title: "x" })).rejects.toThrow(LIVE_ONLY);
    await expect(addInterest(1, { tag: "arts" })).rejects.toThrow(LIVE_ONLY);
    await expect(
      saveCallNote(1, {
        title: "t",
        folder: "f",
        transcript: "",
        segments: [],
        staff_name: "s",
        contact_name: "c",
        duration_s: 0,
      }),
    ).rejects.toThrow(LIVE_ONLY);
  });

  it("never calls the network", () => {
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
