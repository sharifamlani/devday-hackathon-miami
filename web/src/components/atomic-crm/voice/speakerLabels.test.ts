import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { TranscriptLine } from "./callNotes";
import type { CallRecording } from "./geminiTranscriptSource";
import { labelSpeakers, mergeLabeled, takeRecording } from "./speakerLabels";
import { demoTranscriptSource } from "./transcriptSource";

const you = (text: string, at: number): TranscriptLine => ({ speaker: "you", name: "You", text, at });
const LIVE = [you("Hi Rosa, it's Denise.", 0), you("Oh, I got a new card.", 7), you("I'll send a link.", 13)];
const LABELED: TranscriptLine[] = [
  { speaker: "you", name: "You", text: "Hi Rosa, it's Denise.", at: 0.1 },
  { speaker: "them", name: "Rosa", text: "Oh, I got a new card.", at: 7.8 },
  { speaker: "you", name: "You", text: "I'll send a link.", at: 13.8 },
];

const recording = (lines: number, bytes = "webm"): Promise<CallRecording | null> =>
  Promise.resolve({ audio: new Blob([bytes], { type: "audio/webm;codecs=opus" }), lines });

const answer = (segments: TranscriptLine[], status = 200) =>
  vi.fn(async (_url: string | URL | Request, _init?: RequestInit) =>
    new Response(JSON.stringify({ segments }), { status })) as unknown as typeof fetch;

describe("mergeLabeled", () => {
  it("replaces the whole call when the recording covers every line", () => {
    expect(mergeLabeled(LIVE, 3, LABELED).map((l) => [l.speaker, l.name, l.at])).toEqual([
      ["you", "You", 0], ["them", "Rosa", 8], ["you", "You", 14],
    ]);
  });

  it("after a pause, replaces only the stretch the recording covers, on the pane's clock", () => {
    const live = [you("Before the pause.", 0), you("Hello again.", 40), you("Yes, the 21st.", 46)];
    const merged = mergeLabeled(live, 2, [
      { speaker: "you", name: "You", text: "Hello again.", at: 0.2 },
      { speaker: "them", name: "Rosa", text: "Yes, the 21st.", at: 6.1 },
    ]);
    expect(merged.map((l) => [l.speaker, l.text, l.at])).toEqual([
      ["you", "Before the pause.", 0], ["you", "Hello again.", 40], ["them", "Yes, the 21st.", 46],
    ]);
  });
});

describe("labelSpeakers", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("posts the recording with the names and returns labelled lines", async () => {
    const fetchImpl = answer(LABELED);
    const result = await labelSpeakers(recording(3), LIVE, { donorName: "Rosa Delgado", fetchImpl, local: true });
    expect(result.labeled).toBe(true);
    expect(result.lines.map((l) => l.speaker)).toEqual(["you", "them", "you"]);
    const [url, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(String(url)).toMatch(/\/transcribe\/file$/);
    const form = init.body as FormData;
    expect(form.get("them_name")).toBe("Rosa");
    expect(form.get("first_speaker")).toBe("you");
    expect((form.get("audio") as File).name).toBe("call.webm");
  });

  it.each([
    ["no recording", null, answer(LABELED), true],
    ["snapshot mode (no service)", recording(3), answer(LABELED), false],
    ["empty recording", recording(3, ""), answer(LABELED), true],
    ["a server error", recording(3), answer([], 502), true],
    ["no segments", recording(3), answer([]), true],
    ["a network failure", recording(3), vi.fn(async () => { throw new TypeError("Failed to fetch"); }) as unknown as typeof fetch, true],
  ])("keeps the live lines on %s", async (_name, rec, fetchImpl, local) => {
    const result = await labelSpeakers(rec, LIVE, { donorName: "Rosa Delgado", fetchImpl, local });
    expect(result).toMatchObject({ labeled: false, lines: LIVE });
  });

  it("keeps the live lines when the pass takes over 10 s, and aborts the request", async () => {
    let signal: AbortSignal | undefined;
    const fetchImpl = vi.fn((_url: string, init: RequestInit) => {
      signal = init.signal ?? undefined;
      return new Promise<Response>(() => {});
    }) as unknown as typeof fetch;
    const pending = labelSpeakers(recording(3), LIVE, { donorName: "Rosa Delgado", fetchImpl, local: true });
    await vi.advanceTimersByTimeAsync(10_000);
    const result = await pending;
    expect(result).toMatchObject({ labeled: false, lines: LIVE });
    expect(result.reason).toMatch(/over 10 s/);
    expect(signal?.aborted).toBe(true);
  });
});

describe("takeRecording", () => {
  it("is null for sources that don't record", () => {
    expect(takeRecording(null)).toBeNull();
    expect(takeRecording(demoTranscriptSource({ script: [], themName: "Rosa" }))).toBeNull();
  });
});
