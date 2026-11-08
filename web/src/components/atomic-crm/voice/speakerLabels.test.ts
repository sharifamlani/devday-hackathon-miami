import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { TranscriptLine } from "./callNotes";
import { takeCallRecordings, type CallRecording } from "./geminiTranscriptSource";
import { labelSpeakers, matchStretches, takeRecording } from "./speakerLabels";
import { demoTranscriptSource } from "./transcriptSource";

const you = (text: string, at: number): TranscriptLine => ({ speaker: "you", name: "You", text, at });
const stretch = (texts: string[], bytes = "webm"): CallRecording => ({
  audio: new Blob([bytes], { type: "audio/webm;codecs=opus" }),
  texts,
});

// A call paused once: stretch A (0-13 s), pause, stretch B (40-46 s on the pane clock).
const LIVE = [
  you("Hi Rosa, it's Denise.", 0),
  you("Oh, I got a new card.", 7),
  you("Hello again.", 40),
  you("Yes, the 21st.", 46),
];
const A = stretch(["Hi Rosa, it's Denise.", "Oh, I got a new card."], "A");
const B = stretch(["Hello again.", "Yes, the 21st."], "B");
const LABELED: Record<string, TranscriptLine[]> = {
  A: [
    { speaker: "you", name: "You", text: "Hi Rosa, it's Denise.", at: 0.1 },
    { speaker: "them", name: "Rosa", text: "Oh, I got a new card.", at: 7.2 },
  ],
  B: [
    { speaker: "you", name: "You", text: "Hello again.", at: 0.3 },
    { speaker: "them", name: "Rosa", text: "Yes, the 21st.", at: 6.4 },
  ],
};

/** A fake /transcribe/file that answers per stretch (the blob's bytes name it). */
const service = (status: Record<string, number> = {}) =>
  vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
    const which = await ((init!.body as FormData).get("audio") as File).text();
    const code = status[which] ?? 200;
    return new Response(JSON.stringify({ segments: code === 200 ? LABELED[which] : [] }), { status: code });
  }) as unknown as typeof fetch;

const brief = (lines: TranscriptLine[]) => lines.map((l) => `${l.speaker}@${l.at} ${l.text}`);

describe("matchStretches", () => {
  it("maps each stretch to its lines from the end, by text", () => {
    expect(matchStretches(LIVE, [A, B]).map((m) => [m.start, m.end])).toEqual([[0, 2], [2, 4]]);
  });

  it("drops a stretch that doesn't line up, and every one before it", () => {
    const stale = stretch(["from an abandoned call"]);
    expect(matchStretches(LIVE, [stale, A, B]).map((m) => [m.start, m.end])).toEqual([[0, 2], [2, 4]]);
    expect(matchStretches(LIVE, [A, stretch(["not on screen"])])).toEqual([]);
  });

  it("skips a stretch that produced no lines", () => {
    expect(matchStretches(LIVE, [A, stretch([]), B]).map((m) => m.start)).toEqual([0, 2]);
  });
});

describe("labelSpeakers", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("record, pause, resume, record, pause, summary: relabels both stretches on the pane clock", async () => {
    const fetchImpl = service();
    const result = await labelSpeakers(Promise.resolve([A, B]), LIVE, { donorName: "Rosa Delgado", fetchImpl, local: true });
    expect(result.labeled).toBe(true);
    expect(result.stretches).toEqual({ labeled: 2, matched: 2 });
    expect(brief(result.lines)).toEqual([
      "you@0 Hi Rosa, it's Denise.",
      "them@7 Oh, I got a new card.",
      "you@40 Hello again.",
      "them@46 Yes, the 21st.",
    ]);
    expect(fetchImpl).toHaveBeenCalledTimes(2); // one request per stretch
    const form = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1].body as FormData;
    expect(form.get("them_name")).toBe("Rosa");
    expect((form.get("audio") as File).name).toBe("call.webm");
  });

  it("a stretch that fails keeps its live lines; the others are relabelled", async () => {
    const result = await labelSpeakers(Promise.resolve([A, B]), LIVE, {
      donorName: "Rosa Delgado", fetchImpl: service({ A: 502 }), local: true,
    });
    expect(result.stretches).toEqual({ labeled: 1, matched: 2 });
    expect(brief(result.lines)).toEqual([
      "you@0 Hi Rosa, it's Denise.",
      "you@7 Oh, I got a new card.",
      "you@40 Hello again.",
      "them@46 Yes, the 21st.",
    ]);
  });

  it("a stretch still out at 10 s keeps its live lines, the rest land, and the request is aborted", async () => {
    // No real I/O here (Blob.text, Response bodies), which fake timers would outrun:
    // stretches are sent in order, so call 1 is A (answers at once) and call 2 is B (never answers).
    let slowSignal: AbortSignal | undefined;
    let calls = 0;
    const fetchImpl = vi.fn((_url: string, init: RequestInit) => {
      calls += 1;
      if (calls === 2) {
        slowSignal = init.signal ?? undefined;
        return new Promise<Response>(() => {});
      }
      return Promise.resolve({ ok: true, json: async () => ({ segments: LABELED.A }) } as Response);
    }) as unknown as typeof fetch;
    const pending = labelSpeakers(Promise.resolve([A, B]), LIVE, { donorName: null, fetchImpl, local: true });
    await vi.advanceTimersByTimeAsync(10_000);
    const result = await pending;
    expect(result.stretches).toEqual({ labeled: 1, matched: 2 });
    expect(brief(result.lines).slice(2)).toEqual(["you@40 Hello again.", "you@46 Yes, the 21st."]);
    expect(slowSignal?.aborted).toBe(true);
  });

  it.each([
    ["no recording", Promise.resolve([] as CallRecording[]), true],
    ["snapshot mode (no service)", Promise.resolve([A, B]), false],
    ["a recording that matches nothing on screen", Promise.resolve([stretch(["elsewhere"])]), true],
    ["empty audio", Promise.resolve([stretch(A.texts, ""), stretch(B.texts, "")]), true],
  ])("keeps every live line on %s", async (_name, recordings, local) => {
    const result = await labelSpeakers(recordings, LIVE, { donorName: null, fetchImpl: service(), local });
    expect(result).toMatchObject({ labeled: false, lines: LIVE });
  });
});

describe("takeRecording", () => {
  it("returns the tape even after the source is gone (paused), and nothing for sources that don't record", async () => {
    await takeCallRecordings();
    expect(await takeRecording(null)).toEqual([]);
    expect(await takeRecording(demoTranscriptSource({ script: [], themName: "Rosa" }))).toEqual([]);
  });
});
