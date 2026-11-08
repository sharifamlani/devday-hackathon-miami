/**
 * The Vercel build's home (snapshot mode): the live-only home routes are read
 * from snapshot.json's keys (export_snapshot.home_snapshot), filtered like the
 * routes filter. Its own file: the snapshot is cached per module.
 */
import { getArtifacts, getCalendarFeed } from "./calendarFeed";
import { getHomeSummary, getPeopleAttention, getTargetQuarters } from "./homeSummary";
import { attentionTag } from "./homeFeed";
import { createTask, getTasks } from "./tasks";
import { LIVE_ONLY, READ_ONLY_TOAST_ID, SAMPLE_READ_ONLY } from "./endpoint";

const toastError = vi.hoisted(() => vi.fn());
vi.mock("sonner", () => ({ toast: { error: toastError } }));

const task = (id: number, due: string, person_id: number | null) => ({
  id, kind: "call", title: `Task ${id}`, why: null, person_id, chips: [], due, time: null, done: false, source: "generator",
});

const snapshot = {
  meta: { as_of: "2026-11-08", generated_at: "x", label: "Cached sample", donor_count: 0, source: "test" },
  donors: [],
  donor_details: {},
  duplicates: [],
  home_summary: {
    gifts_at_risk: 2, duplicates: 1, tasks_today: 6,
    next_event: { title: "Give Miami Day: Early Giving opens", date: "2026-11-14", days: 6 },
    reached_today: 0, suggestions: ["Who's late on a usual gift?"],
  },
  people_attention: [
    { id: 12, name: "McDermott Will & Schulte", initials: "MW", line: "242 days late", badge: "late" },
    { id: 1, name: "Maria Delgado", initials: "MD", line: "Card declined", badge: "failed" },
    { id: 5, name: "Robert Nguyen", initials: "RN", line: "122 days late", badge: "late" },
  ],
  tasks: [task(1, "2026-11-08", 12), task(2, "2026-11-08", null), task(3, "2026-11-20", 1)],
  tasks_today: [task(1, "2026-11-08", 12), task(2, "2026-11-08", null)],
  calendar: [
    { date: "2026-11-08", time: null, title: "Call McDermott", kind: "task", source: "generator", ref: "task:1", task_kind: "call", done: false },
    { date: "2026-11-14", time: null, title: "Early Giving opens", kind: "event", source: "website", ref: "event:1" },
    { date: "2026-12-01", time: null, title: "Later", kind: "event", source: "website", ref: "event:2" },
  ],
  artifacts: [{ kind: "draft", title: "Draft for Maria", date: "2026-11-08", ref: "draft:3" }],
  target_quarters: {
    quarters: [{ label: "2026-Q4", start: "2026-10-01", end: "2026-12-31", raised: 50100 }],
    ytd: { year: 2026, raised: 851750 },
  },
};

describe("home in the snapshot build", () => {
  beforeAll(() => vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(snapshot)))));
  afterAll(() => vi.unstubAllGlobals());

  it("reads summary, attention (sliced) and quarters from snapshot.json", async () => {
    expect(await getHomeSummary()).toEqual(snapshot.home_summary);
    expect((await getPeopleAttention(2)).map((p) => p.id)).toEqual([12, 1]);
    expect(await getTargetQuarters("2026-11-08")).toEqual(snapshot.target_quarters);
  });

  it("filters tasks like GET /tasks: today, from/to, person", async () => {
    expect((await getTasks({ due: "today" })).map((t) => t.id)).toEqual([1, 2]);
    expect((await getTasks({ from: "2026-11-10" })).map((t) => t.id)).toEqual([3]);
    expect((await getTasks({ person_id: 12 })).map((t) => t.id)).toEqual([1]);
  });

  it("filters the calendar by range and keeps task_kind + done", async () => {
    const items = await getCalendarFeed("2026-11-08", "2026-11-22");
    expect(items.map((i) => i.ref)).toEqual(["task:1", "event:1"]);
    expect(items[0]).toMatchObject({ task_kind: "call", done: false });
    expect(await getArtifacts()).toEqual(snapshot.artifacts);
  });

  it("still refuses writes, and says so on screen; reads don't toast", async () => {
    toastError.mockClear();
    await getTasks({ due: "today" });
    expect(toastError).not.toHaveBeenCalled();
    await expect(createTask({ title: "x" })).rejects.toThrow(LIVE_ONLY);
    expect(toastError).toHaveBeenCalledWith(SAMPLE_READ_ONLY, { id: READ_ONLY_TOAST_ID });
  });

  it("maps the service's 'failed' badge to Card failed", () => {
    expect(attentionTag("failed")).toEqual({ label: "Card failed", tone: "alert" });
    expect(attentionTag("card_failed")).toEqual({ label: "Card failed", tone: "alert" });
  });
});
