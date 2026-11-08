import { __resetCallNotesForTests, type CallNote } from "../../voice/callNotes";
import {
  callNotesPath,
  listServerCallNotes,
  saveCallNoteEverywhere,
  summarizeCall,
  toApiCallNote,
  toCallNote,
  type ApiCallNote,
} from "./calls";

const respond = (status: number, body: unknown) =>
  vi.fn(async () => new Response(JSON.stringify(body), { status }));

const transcript = [
  {
    speaker: "them" as const,
    name: "Dana Reyes",
    text: "I'd like to give again.",
    at: 12,
  },
];

const fallback = vi.fn(() => ({
  summary: ["Browser summary."],
  nextSteps: ["Browser step."],
}));

const note: CallNote = {
  id: "call-1",
  title: "Check-in",
  createdAt: "2026-11-07T15:00:00.000Z",
  durationSec: 61.6,
  destinations: [{ kind: "donor", id: "3", label: "Dana Reyes" }],
  transcript,
  notes: "Prefers email.",
  summary: ["Wants to give again."],
  nextSteps: ["Send the impact report."],
};

const apiNote: ApiCallNote = {
  id: "call-1",
  title: "Check-in",
  created_at: "2026-11-07T15:00:00.000Z",
  duration_sec: 62,
  destinations: [{ kind: "donor", id: "3", label: "Dana Reyes" }],
  transcript,
  notes: "Prefers email.",
  summary: ["Wants to give again."],
  next_steps: ["Send the impact report."],
  saved_at: "2026-11-07 15:01:00",
};

// What the browser store (voice/callNotes) holds, newest first: read from its storage key rather than a
// vi.mock spy, which doesn't apply when another test file in the same run has already loaded the module.
const CALL_NOTES_KEY = "donor-desk.call-notes.v1";
const stored = (): CallNote[] => JSON.parse(window.localStorage.getItem(CALL_NOTES_KEY) ?? "[]");

beforeEach(() => {
  fallback.mockClear();
  window.localStorage.removeItem(CALL_NOTES_KEY);
  __resetCallNotesForTests();
});
afterEach(() => vi.unstubAllGlobals());

describe("summarizeCall", () => {
  it("posts to /calls/summarize in local mode and maps next_steps", async () => {
    const fetchMock = respond(200, {
      summary: ["Dana will give again."],
      next_steps: ["Send the impact report."],
      source: "model",
      detail: null,
    });
    vi.stubGlobal("fetch", fetchMock);
    const result = await summarizeCall(
      { title: "Check-in", transcript, notes: "", donorId: "3", fallback },
      "local",
    );
    expect(result).toEqual({
      summary: ["Dana will give again."],
      nextSteps: ["Send the impact report."],
      source: "model",
      detail: null,
    });
    expect(fallback).not.toHaveBeenCalled();
    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toMatch(/\/calls\/summarize$/);
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({
      title: "Check-in",
      transcript,
      notes: "",
      donor_id: 3,
    });
  });

  it("keeps the service's rules answer labelled as rules", async () => {
    vi.stubGlobal(
      "fetch",
      respond(200, {
        summary: ["Call with Dana Reyes, about 1 min."],
        next_steps: [],
        source: "rules",
        detail: "OPENAI_API_KEY is not set; summarized by the rules",
      }),
    );
    const result = await summarizeCall(
      { title: "", transcript, notes: "", fallback },
      "local",
    );
    expect(result.source).toBe("rules");
    expect(result.summary).toEqual(["Call with Dana Reyes, about 1 min."]);
  });

  it("uses the fallback in snapshot mode without a request", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const result = await summarizeCall(
      { title: "", transcript, notes: "", fallback },
      "snapshot",
    );
    expect(result).toMatchObject({
      summary: ["Browser summary."],
      nextSteps: ["Browser step."],
      source: "rules",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("uses the fallback on a network error or an API error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }),
    );
    const offline = await summarizeCall(
      { title: "", transcript, notes: "", fallback },
      "local",
    );
    expect(offline).toMatchObject({
      source: "rules",
      summary: ["Browser summary."],
    });
    expect(offline.detail).toContain("Failed to fetch");

    vi.stubGlobal("fetch", respond(404, { detail: "Not Found" }));
    const missing = await summarizeCall(
      { title: "", transcript, notes: "", fallback },
      "local",
    );
    expect(missing.nextSteps).toEqual(["Browser step."]);
  });
});

describe("saveCallNoteEverywhere", () => {
  it("posts the note in snake_case, then stores the server's row", async () => {
    const fetchMock = respond(200, apiNote);
    vi.stubGlobal("fetch", fetchMock);
    const result = await saveCallNoteEverywhere(note, "local");
    expect(result.savedTo).toBe("server");
    expect(result.note).toEqual({ ...note, durationSec: 62 });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toMatch(/\/calls$/);
    expect(JSON.parse(init.body as string)).toEqual({
      id: "call-1",
      title: "Check-in",
      created_at: "2026-11-07T15:00:00.000Z",
      duration_sec: 62,
      destinations: note.destinations,
      transcript,
      notes: "Prefers email.",
      summary: ["Wants to give again."],
      next_steps: ["Send the impact report."],
    });
    expect(stored().map((n) => n.id)).toEqual(["call-1"]);
  });

  it("keeps the note in this browser when the server save fails", async () => {
    vi.stubGlobal("fetch", respond(500, { detail: "boom" }));
    const result = await saveCallNoteEverywhere(note, "local");
    expect(result).toMatchObject({ savedTo: "browser", note });
    expect(result.error).toContain("500");
    expect(stored()).toEqual([note]);
  });

  it("only stores locally in snapshot mode", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const result = await saveCallNoteEverywhere(note, "snapshot");
    expect(result).toEqual({ note, savedTo: "browser" });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(stored()).toEqual([note]);
  });
});

describe("listing and mapping", () => {
  it("builds the filter query", () => {
    expect(callNotesPath()).toBe("/calls");
    expect(callNotesPath({ donorId: "3" })).toBe("/calls?donor_id=3");
    expect(callNotesPath({ donorId: "x", projectId: "7" })).toBe(
      "/calls?project_id=7",
    );
  });

  it("maps server rows to CallNote", async () => {
    vi.stubGlobal("fetch", respond(200, [apiNote]));
    expect(await listServerCallNotes({ donorId: 3 })).toEqual([
      { ...note, durationSec: 62 },
    ]);
  });

  it("round-trips a note", () => {
    const rounded = { ...note, durationSec: 62 };
    expect(toCallNote({ ...toApiCallNote(rounded) })).toEqual(rounded);
    expect(toApiCallNote({ ...note, title: "  " }).title).toBe("Untitled call");
  });
});
