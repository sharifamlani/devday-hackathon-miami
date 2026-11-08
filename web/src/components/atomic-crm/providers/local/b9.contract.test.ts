/**
 * B9: every plan.md §21.5 endpoint, in live mode, against its contract-shaped
 * mock. Each case checks the request (method, path, body) and that the
 * response comes back in the §21.5 shape.
 */
import { acceptEnrichment, addInterest, enrichPreview, getInterestTags, getPersonInterests, removeInterest } from "./interests";
import { getHomeSummary, getPeopleAttention, getTargetQuarters } from "./homeSummary";
import { completeTask, createTask, deleteTask, generateTasks, getTasks, undo, updateTask } from "./tasks";
import { getArtifacts, getCalendarFeed } from "./calendarFeed";
import { applyAfterCall, getPledges, proposeAfterCall, transcribeFile } from "./voice";
import { searchContext } from "./contextSearch";
import { resetMockTasks } from "./mocks";
import type * as Config from "./config";
import { runMock, type Method } from "./endpoint";

vi.mock("./config", async (importOriginal) => ({
  ...(await importOriginal<typeof Config>()),
  DATA_MODE: "local",
}));

type Seen = { method: string; path: string; body: unknown };
let seen: Seen[] = [];

/** fetch → the registered mock for that route, recording what was sent. */
const fetchFromMocks = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(String(input));
  const method = (init?.method ?? "GET") as Method;
  const body =
    init?.body instanceof FormData ? init.body : init?.body ? JSON.parse(String(init.body)) : undefined;
  const path = `${url.pathname}${url.search}`;
  seen.push({ method, path, body });
  return new Response(JSON.stringify(runMock(method, path, body)), { status: 200 });
});

beforeEach(() => {
  seen = [];
  resetMockTasks();
  vi.stubGlobal("fetch", fetchFromMocks);
});
afterEach(() => vi.unstubAllGlobals());

const keysOf = (o: object) => Object.keys(o).sort();
const last = () => seen[seen.length - 1];

describe("interests (42, B1)", () => {
  it("GET /interest-tags → [{slug, label, definition}]", async () => {
    const tags = await getInterestTags();
    expect(last()).toMatchObject({ method: "GET", path: "/interest-tags" });
    expect(keysOf(tags[0])).toEqual(["definition", "label", "slug"]);
  });

  it("GET/POST /people/{id}/interests → [{tag, sub_tag, confidence, evidence, source_url, set_by}]", async () => {
    const list = await getPersonInterests(7);
    expect(last()).toMatchObject({ method: "GET", path: "/people/7/interests" });
    expect(keysOf(list[0])).toEqual(["confidence", "evidence", "set_by", "source_url", "sub_tag", "tag"]);
    const after = await addInterest(7, { tag: "arts", sub_tag: null });
    expect(last()).toMatchObject({ method: "POST", path: "/people/7/interests", body: { tag: "arts", sub_tag: null } });
    expect(after.at(-1)?.tag).toBe("arts");
  });

  it("DELETE /people/{id}/interests/{tag} → {removed: true}", async () => {
    expect(await removeInterest(7, "dogs")).toEqual({ removed: true });
    expect(last()).toMatchObject({ method: "DELETE", path: "/people/7/interests/dogs" });
  });

  it("POST /enrich/{id}?dry_run=1 → {facts[], interests[], contact{}} and accept → {saved}", async () => {
    const preview = await enrichPreview(7);
    expect(last()).toMatchObject({ method: "POST", path: "/enrich/7?dry_run=1" });
    expect(keysOf(preview)).toEqual(["contact", "facts", "interests"]);
    const saved = await acceptEnrichment(7, { fact_ids: [501], tags: ["climate"] });
    expect(last()).toMatchObject({
      method: "POST",
      path: "/people/7/enrichment/accept",
      body: { fact_ids: [501], tags: ["climate"] },
    });
    expect(saved).toHaveProperty("saved");
  });
});

describe("home + targets (48, B2/B13)", () => {
  it("GET /home/summary", async () => {
    const summary = await getHomeSummary();
    expect(keysOf(summary!)).toEqual(
      ["duplicates", "gifts_at_risk", "next_event", "reached_today", "suggestions", "tasks_today"],
    );
    expect(keysOf(summary!.next_event!)).toEqual(["date", "days", "title"]);
  });

  it("GET /people/attention?limit= → [{id, name, initials, line, badge}]", async () => {
    const people = await getPeopleAttention(2);
    expect(last().path).toBe("/people/attention?limit=2");
    expect(people).toHaveLength(2);
    expect(keysOf(people[0])).toEqual(["badge", "id", "initials", "line", "name"]);
  });

  it("GET /targets/quarters?as_of= → {quarters:[{label,start,end,raised}], ytd:{year,raised}}", async () => {
    const q = await getTargetQuarters("2026-11-08");
    expect(last().path).toBe("/targets/quarters?as_of=2026-11-08");
    expect(keysOf(q!.quarters[0])).toEqual(["end", "label", "raised", "start"]);
    expect(keysOf(q!.ytd)).toEqual(["raised", "year"]);
  });
});

describe("tasks (3a, B11)", () => {
  it("GET /tasks with filters → [{id, kind, title, why, person_id, chips[], due, time, done, source}]", async () => {
    const tasks = await getTasks({ due: "today" });
    expect(last().path).toBe("/tasks?due=today");
    expect(keysOf(tasks[0])).toEqual(
      ["chips", "done", "due", "id", "kind", "person_id", "source", "time", "title", "why"],
    );
    await getTasks({ from: "2026-11-08", to: "2026-11-14", person_id: 1 });
    expect(last().path).toBe("/tasks?from=2026-11-08&to=2026-11-14&person_id=1");
  });

  it("POST, PATCH (complete), DELETE /tasks and POST /undo/{token}", async () => {
    const created = await createTask({ title: "Thank Priya", kind: "email", person_id: 21 });
    expect(last()).toMatchObject({ method: "POST", path: "/tasks", body: { title: "Thank Priya" } });
    expect(created.undo_token).toBeTruthy();
    await updateTask(created.id, { time: "14:00" });
    expect(last()).toMatchObject({ method: "PATCH", path: `/tasks/${created.id}`, body: { time: "14:00" } });
    const done = await completeTask(created.id);
    expect(last().body).toEqual({ done: true });
    expect(done.done).toBe(true);
    await deleteTask(created.id);
    expect(last()).toMatchObject({ method: "DELETE", path: `/tasks/${created.id}` });
    expect(await undo("tok-1")).toEqual({ undone: true });
    expect(last()).toMatchObject({ method: "POST", path: "/undo/tok-1" });
  });

  it("POST /tasks/generate → {created} (idempotent)", async () => {
    expect(await generateTasks()).toEqual({ created: 0 });
  });
});

describe("calendar + artifacts (3a, B12)", () => {
  it("GET /calendar?from&to → [{date, time, title, kind, source, ref}]", async () => {
    const items = await getCalendarFeed("2026-11-01", "2026-11-30");
    expect(last().path).toBe("/calendar?from=2026-11-01&to=2026-11-30");
    expect(keysOf(items[0])).toEqual(["date", "kind", "ref", "source", "time", "title"]);
    expect(["event", "task"]).toContain(items[0].kind);
  });

  it("GET /artifacts → [{kind, title, date, ref}]", async () => {
    expect(keysOf((await getArtifacts())[0])).toEqual(["date", "kind", "ref", "title"]);
  });
});

describe("voice (Agent Phone B3, 90b B6)", () => {
  it("POST /transcribe/file (multipart) → {segments:[{speaker,text,start,end}]}", async () => {
    const result = await transcribeFile(new File(["x"], "call.webm"));
    expect(last()).toMatchObject({ method: "POST", path: "/transcribe/file" });
    expect((last().body as FormData).get("file")).toBeInstanceOf(File);
    expect(keysOf(result.segments[0])).toEqual(["end", "speaker", "start", "text"]);
  });

  it("POST /call-notes/{id}/actions and /apply; GET /people/{id}/pledges", async () => {
    const proposal = await proposeAfterCall(12);
    expect(keysOf(proposal)).toEqual(["actions", "steps"]);
    expect(keysOf(proposal.actions[0])).toEqual(["id", "label", "payload", "type"]);
    const applied = await applyAfterCall(12, ["a1"]);
    expect(last()).toMatchObject({ path: "/call-notes/12/apply", body: { action_ids: ["a1"] } });
    expect(applied.applied[0]).toEqual({ id: "a1", type: "create_task", ref: null });
    expect(keysOf((await getPledges(1))[0])).toEqual(["amount", "expected_by", "status"]);
  });
});

describe("context search (86, C1)", () => {
  it("GET /context/search?q&kinds&k → [{id, kind, title, text, source_url, posted_at, score}]", async () => {
    const items = await searchContext({ q: "legal", kinds: ["success_story", "use_of_funds"], k: 5 });
    expect(last().path).toBe("/context/search?q=legal&kinds=success_story%2Cuse_of_funds&k=5");
    expect(keysOf(items[0])).toEqual(["id", "kind", "posted_at", "score", "source_url", "text", "title"]);
  });
});
