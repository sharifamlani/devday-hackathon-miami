/**
 * Contract-shaped mocks for every plan.md §21.5 endpoint (B9). Used by the
 * tests always, and by the running app only when VITE_MOCK_ENDPOINTS=1 and
 * the route isn't served yet (endpoint.ts); then each call is logged and
 * useEndpointSource reports "mock" so screens can label it.
 *
 * All people, numbers and dates are fictional, matching data/sample_inputs.
 */
import type { CalendarItem, Artifact } from "./calendarFeed";
import type { ContextItem } from "./contextSearch";
import { registerMock } from "./endpoint";
import type { AttentionPerson, HomeSummary, TargetQuarters } from "./homeSummary";
import type { EnrichPreview, InterestTag, PersonInterest } from "./interests";
import type { Task } from "./tasks";
import type { AfterCallProposal, Pledge, TranscriptSegment } from "./voice";

export const MOCK = {
  interestTags: [
    { slug: "youth", label: "Youth & families", definition: "Gives to or volunteers for youth programs." },
    { slug: "climate", label: "Climate & resilience", definition: "Funds climate or disaster resilience work." },
    { slug: "arts", label: "Arts access", definition: "Supports arts programs and free access." },
    { slug: "dogs", label: "Dogs", definition: "Has a dog or supports animal welfare." },
  ] satisfies InterestTag[],
  personInterests: [
    {
      tag: "youth",
      sub_tag: "scholarships",
      confidence: 0.82,
      evidence: "Board member at a scholarship fund (2025 annual report).",
      source_url: "https://example.org/annual-report-2025",
      set_by: "agent",
    },
    { tag: "dogs", sub_tag: null, confidence: null, evidence: null, source_url: null, set_by: "Dana (staff)" },
  ] satisfies PersonInterest[],
  enrichPreview: {
    facts: [
      { id: 501, fact: "Chairs the board of a Miami youth scholarship fund.", source_url: "https://example.org/board" },
      { id: 502, fact: "Spoke at a 2026 climate resilience forum.", source_url: "https://example.org/forum-2026" },
    ],
    interests: [
      {
        tag: "climate",
        sub_tag: null,
        confidence: 0.7,
        evidence: "Panelist, 2026 climate resilience forum.",
        source_url: "https://example.org/forum-2026",
        set_by: "agent",
      },
    ],
    contact: { employer: "Example Bank of Miami", email: null, phone: null },
  } satisfies EnrichPreview,
  homeSummary: {
    gifts_at_risk: 5,
    duplicates: 6,
    tasks_today: 5,
    next_event: { title: "Give Miami Day", date: "2026-11-19", days: 11 },
    reached_today: 3,
    suggestions: ["Enrich Maria Delgado", "Who's late on a usual gift?", "Plan next week"],
  } satisfies HomeSummary,
  attention: [
    { id: 1, name: "Maria Delgado", initials: "MD", line: "Card declined on her monthly gift", badge: "card_failed" },
    { id: 7, name: "Luis Herrera", initials: "LH", line: "Usual December gift is late", badge: "late" },
    { id: 21, name: "Priya Shah", initials: "PS", line: "First gift 12 days ago", badge: "new" },
  ] satisfies AttentionPerson[],
  quarters: {
    quarters: [
      { label: "Q1 2026", start: "2026-01-01", end: "2026-03-31", raised: 312500 },
      { label: "Q2 2026", start: "2026-04-01", end: "2026-06-30", raised: 205000 },
      { label: "Q3 2026", start: "2026-07-01", end: "2026-09-30", raised: 468400 },
      { label: "Q4 2026", start: "2026-10-01", end: "2026-12-31", raised: 41250 },
    ],
    ytd: { year: 2026, raised: 1027150 },
  } satisfies TargetQuarters,
  tasks: [
    {
      id: 1,
      kind: "call",
      title: "Call Maria Delgado about her declined card",
      why: "Her monthly gift failed on Nov 3; she has given every month since 2023.",
      person_id: 1,
      chips: ["Lifetime $11,000", "Last gift Oct 2026", "Prefers phone"],
      due: "2026-11-08",
      time: "10:00",
      done: false,
      source: "generator",
    },
    {
      id: 2,
      kind: "review",
      title: "Review 6 possible duplicates",
      why: "The import found the same email under two names.",
      person_id: null,
      chips: [],
      due: "2026-11-08",
      time: null,
      done: false,
      source: "generator",
    },
  ] as Task[],
  calendar: [
    { date: "2026-11-14", time: null, title: "Give Miami Day early giving opens", kind: "event", source: "givemiamiday.org", ref: 3 },
    { date: "2026-11-08", time: "10:00", title: "Call Maria Delgado", kind: "task", source: "generator", ref: 1 },
  ] satisfies CalendarItem[],
  artifacts: [
    { kind: "call_note", title: "Call with Maria Delgado", date: "2026-11-07", ref: 12 },
    { kind: "brief", title: "Brief: Biscayne Harbor Family Foundation", date: "2026-11-06", ref: "brief-4" },
  ] satisfies Artifact[],
  segments: [
    { speaker: "staff", text: "Hi Maria, it's Dana from the Foundation.", start: 0, end: 2.4 },
    { speaker: "contact", text: "Oh hi! I saw my card didn't go through.", start: 2.6, end: 5.1 },
  ] satisfies TranscriptSegment[],
  afterCall: {
    steps: ["Read the transcript", "Matched 2 commitments", "Checked the calendar"],
    actions: [
      { id: "a1", type: "create_task", label: "Follow up Friday about the new card", payload: { due: "2026-11-13" } },
      { id: "a2", type: "record_pledge", label: "Record a $500 Give Miami Day pledge", payload: { amount: 500, expected_by: "2026-11-19" } },
    ],
  } satisfies AfterCallProposal,
  pledges: [{ amount: 500, expected_by: "2026-11-19", status: "open" }] satisfies Pledge[],
  context: [
    {
      id: 41,
      kind: "success_story",
      title: "398 hours of free legal help for 17 nonprofits",
      text: "Pro bono counsel delivered 398 hours valued at more than $500,000.",
      source_url: "https://example.org/newsletter-sept-2026",
      posted_at: "2026-10-01",
      score: 0.91,
    },
    {
      id: 42,
      kind: "use_of_funds",
      title: "South Dade study",
      text: "Only 4% of South Dade funding is flexible.",
      source_url: "https://example.org/south-dade-study",
      posted_at: "2026-08-31",
      score: 0.77,
    },
  ] satisfies ContextItem[],
};

/* In-memory task store, so create / complete / delete behave in a mock session. */
let tasks = structuredClone(MOCK.tasks);
let nextTaskId = 100;
export const resetMockTasks = () => {
  tasks = structuredClone(MOCK.tasks);
  nextTaskId = 100;
};
const idFrom = (path: string) => Number(path.split("/")[2]);

registerMock("GET", "/interest-tags", () => MOCK.interestTags);
registerMock("GET", "/people/{id}/interests", () => MOCK.personInterests);
registerMock("POST", "/people/{id}/interests", ({ body }) => [
  ...MOCK.personInterests,
  { tag: (body as { tag: string }).tag, sub_tag: (body as { sub_tag?: string }).sub_tag ?? null, confidence: null, evidence: null, source_url: null, set_by: "staff" },
]);
registerMock("DELETE", "/people/{id}/interests/{tag}", () => ({ removed: true }));
registerMock("POST", "/enrich/{id}", () => MOCK.enrichPreview);
registerMock("POST", "/people/{id}/enrichment/accept", ({ body }) => ({
  saved: { facts: (body as { fact_ids: unknown[] }).fact_ids.length, interests: (body as { tags: unknown[] }).tags.length },
}));
registerMock("GET", "/home/summary", () => MOCK.homeSummary);
registerMock("GET", "/people/attention", ({ query }) => MOCK.attention.slice(0, Number(query.get("limit") ?? 6)));
registerMock("GET", "/targets/quarters", () => MOCK.quarters);
registerMock("GET", "/tasks", ({ query }) =>
  tasks.filter((t) => (query.get("person_id") ? t.person_id === Number(query.get("person_id")) : true)),
);
registerMock("POST", "/tasks", ({ body }) => {
  const task = {
    done: false,
    why: null,
    person_id: null,
    chips: [],
    due: null,
    time: null,
    kind: "call",
    source: "staff",
    ...(body as Partial<Task>),
    id: nextTaskId++,
  } as Task;
  tasks.push(task);
  return { ...task, undo_token: `undo-task-${task.id}` };
});
registerMock("PATCH", "/tasks/{id}", ({ path, body }) => {
  const task = tasks.find((t) => t.id === idFrom(path));
  if (!task) throw new Error(`task ${idFrom(path)} not found`);
  Object.assign(task, body);
  return task;
});
registerMock("DELETE", "/tasks/{id}", ({ path }) => {
  tasks = tasks.filter((t) => t.id !== idFrom(path));
  return { deleted: true, undo_token: `undo-delete-${idFrom(path)}` };
});
registerMock("POST", "/tasks/generate", () => ({ created: 0 })); // idempotent: already generated
registerMock("POST", "/undo/{token}", () => ({ undone: true }));
registerMock("GET", "/calendar", () => MOCK.calendar);
registerMock("GET", "/artifacts", () => MOCK.artifacts);
registerMock("POST", "/transcribe/file", () => ({ segments: MOCK.segments }));
registerMock("POST", "/call-notes/{id}/actions", () => MOCK.afterCall);
registerMock("POST", "/call-notes/{id}/apply", ({ body }) => ({
  applied: (body as { action_ids: (string | number)[] }).action_ids.map((id) => ({ id, type: MOCK.afterCall.actions.find((a) => a.id === id)?.type ?? "unknown", ref: null })),
}));
registerMock("GET", "/people/{id}/pledges", () => MOCK.pledges);
registerMock("GET", "/context/search", ({ query }) => {
  const kinds = query.get("kinds")?.split(",");
  return MOCK.context.filter((c) => !kinds || kinds.includes(c.kind)).slice(0, Number(query.get("k") ?? 8));
});
