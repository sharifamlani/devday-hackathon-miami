import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { TranscriptLine } from "./callNotes";
import {
  browserSpeechSource,
  demoCallScript,
  demoTranscriptSource,
  firstName,
  speechErrorFor,
  type SpeechRecognitionLike,
  type SpeechResultEventLike,
  type TranscriptSourceError,
} from "./transcriptSource";

const script = [
  { speaker: "you" as const, text: "one" },
  { speaker: "them" as const, text: "two" },
  { speaker: "you" as const, text: "three" },
];

describe("demoTranscriptSource", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("emits the first line at once, then one every interval, then ends", () => {
    const lines: TranscriptLine[] = [];
    const onEnd = vi.fn();
    const source = demoTranscriptSource({
      script,
      themName: "Rosa",
      intervalMs: 1100,
    });
    source.start({ onLine: (l) => lines.push(l), onEnd });
    expect(lines.map((l) => l.text)).toEqual(["one"]);
    vi.advanceTimersByTime(1099);
    expect(lines).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(lines.map((l) => l.text)).toEqual(["one", "two"]);
    expect(onEnd).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1100);
    expect(lines.map((l) => l.text)).toEqual(["one", "two", "three"]);
    expect(onEnd).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(10_000);
    expect(lines).toHaveLength(3);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("labels speakers and stamps seconds from the line index", () => {
    const lines: TranscriptLine[] = [];
    const source = demoTranscriptSource({ script, themName: "Rosa" });
    source.start({ onLine: (l) => lines.push(l) });
    vi.advanceTimersByTime(5000);
    expect(lines).toEqual([
      { speaker: "you", name: "You", text: "one", at: 0 },
      { speaker: "them", name: "Rosa", text: "two", at: 1 },
      { speaker: "you", name: "You", text: "three", at: 2 },
    ]);
  });

  it("holds lines while paused and continues after resume", () => {
    const lines: TranscriptLine[] = [];
    const source = demoTranscriptSource({
      script,
      themName: "Rosa",
      intervalMs: 1000,
    });
    source.start({ onLine: (l) => lines.push(l) });
    source.pause();
    vi.advanceTimersByTime(5000);
    expect(lines).toHaveLength(1);
    source.resume();
    vi.advanceTimersByTime(999);
    expect(lines).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(lines.map((l) => l.text)).toEqual(["one", "two"]);
  });

  it("sends nothing after stop", () => {
    const lines: TranscriptLine[] = [];
    const source = demoTranscriptSource({ script, themName: "Rosa" });
    source.start({ onLine: (l) => lines.push(l) });
    source.stop();
    source.resume();
    vi.advanceTimersByTime(5000);
    expect(lines).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("resumes a stopped demo from startIndex", () => {
    const lines: TranscriptLine[] = [];
    const source = demoTranscriptSource({
      script,
      themName: "Rosa",
      startIndex: 2,
    });
    source.start({ onLine: (l) => lines.push(l) });
    expect(lines.map((l) => l.text)).toEqual(["three"]);
  });

  it("ignores a second start", () => {
    const lines: TranscriptLine[] = [];
    const source = demoTranscriptSource({ script, themName: "Rosa" });
    source.start({ onLine: (l) => lines.push(l) });
    source.start({ onLine: (l) => lines.push(l) });
    expect(lines).toHaveLength(1);
  });

  it("is marked as a demo", () => {
    expect(demoTranscriptSource({ script, themName: "Rosa" }).isDemo).toBe(
      true,
    );
  });
});

describe("demoCallScript", () => {
  it("greets the donor by first name", () => {
    const lines = demoCallScript("Rosa Delgado");
    expect(lines[0]).toEqual({
      speaker: "you",
      text: "Hi Rosa, I'm calling from the foundation. Do you have a minute?",
    });
    expect(lines.some((l) => l.speaker === "them")).toBe(true);
    expect(firstName("  Ana  María Ruiz ")).toBe("Ana");
  });
});

/* ---------- browserSpeechSource with a fake recognizer ---------- */

class FakeRecognition implements SpeechRecognitionLike {
  continuous = false;
  interimResults = false;
  lang = "";
  onresult: SpeechRecognitionLike["onresult"] = null;
  onerror: SpeechRecognitionLike["onerror"] = null;
  onend: SpeechRecognitionLike["onend"] = null;
  starts = 0;
  stops = 0;
  aborts = 0;
  start() {
    this.starts += 1;
  }
  stop() {
    this.stops += 1;
  }
  abort() {
    this.aborts += 1;
  }
  emit(results: { text: string; final: boolean }[], resultIndex = 0) {
    const list = results.map((r) =>
      Object.assign([{ transcript: r.text }], { isFinal: r.final }),
    );
    this.onresult?.({
      resultIndex,
      results: list,
    } as unknown as SpeechResultEventLike);
  }
}

const speech = (clock = { t: 0 }) => {
  const recognition = new FakeRecognition();
  const lines: TranscriptLine[] = [];
  const interim: string[] = [];
  const errors: TranscriptSourceError[] = [];
  const source = browserSpeechSource({
    createRecognition: () => recognition,
    lang: "en-US",
    now: () => clock.t,
  });
  source.start({
    onLine: (l) => lines.push(l),
    onInterim: (t) => interim.push(t),
    onError: (e) => errors.push(e),
  });
  return { recognition, lines, interim, errors, source, clock };
};

describe("browserSpeechSource", () => {
  it("listens continuously with interim results", () => {
    const { recognition, source } = speech();
    expect(recognition.continuous).toBe(true);
    expect(recognition.interimResults).toBe(true);
    expect(recognition.lang).toBe("en-US");
    expect(recognition.starts).toBe(1);
    expect(source.isDemo).toBe(false);
  });

  it("turns final results into You lines and shows interim text", () => {
    const clock = { t: 0 };
    const { recognition, lines, interim } = speech(clock);
    recognition.emit([{ text: "hello there", final: false }]);
    expect(interim.at(-1)).toBe("hello there");
    clock.t = 4200;
    recognition.emit([
      { text: "hello there", final: true },
      { text: "how are", final: false },
    ]);
    expect(lines).toEqual([
      { speaker: "you", name: "You", text: "Hello there", at: 4 },
    ]);
    expect(interim.at(-1)).toBe("how are");
  });

  it("only reads results from resultIndex on", () => {
    const { recognition, lines } = speech();
    recognition.emit(
      [
        { text: "old", final: true },
        { text: "new", final: true },
      ],
      1,
    );
    expect(lines.map((l) => l.text)).toEqual(["New"]);
  });

  it("restarts when the browser ends a session, but not while paused", () => {
    const { recognition, source } = speech();
    recognition.onend?.();
    expect(recognition.starts).toBe(2);
    source.pause();
    expect(recognition.stops).toBe(1);
    recognition.onend?.();
    expect(recognition.starts).toBe(2);
    source.resume();
    expect(recognition.starts).toBe(3);
  });

  it("does not count paused time in timestamps", () => {
    const clock = { t: 0 };
    const { recognition, lines, source } = speech(clock);
    clock.t = 3000;
    source.pause();
    clock.t = 60_000;
    source.resume();
    clock.t = 62_000;
    recognition.emit([{ text: "back", final: true }]);
    expect(lines[0].at).toBe(5);
  });

  it("reports a blocked mic as fatal and stops", () => {
    const { recognition, errors } = speech();
    recognition.onerror?.({ error: "not-allowed" });
    expect(errors).toEqual([
      expect.objectContaining({ code: "not-allowed", fatal: true }),
    ]);
    expect(recognition.aborts).toBe(1);
    recognition.onend?.();
    expect(recognition.starts).toBe(1);
  });

  it("keeps going after no-speech", () => {
    const { recognition, errors } = speech();
    recognition.onerror?.({ error: "no-speech" });
    expect(errors[0]).toEqual(
      expect.objectContaining({ code: "no-speech", fatal: false }),
    );
    recognition.onend?.();
    expect(recognition.starts).toBe(2);
  });

  it("gives up after a burst of instant restarts", () => {
    const clock = { t: 0 };
    const { recognition, errors } = speech(clock);
    for (let i = 0; i < 10; i += 1) recognition.onend?.();
    expect(recognition.starts).toBe(6);
    expect(errors.at(-1)).toEqual(
      expect.objectContaining({ code: "other", fatal: true }),
    );
  });

  it("sends nothing after stop", () => {
    const { recognition, lines, source } = speech();
    source.stop();
    recognition.emit([{ text: "late", final: true }]);
    expect(lines).toHaveLength(0);
    expect(recognition.aborts).toBe(1);
  });

  it("explains each error in plain words", () => {
    expect(speechErrorFor("network")).toEqual(
      expect.objectContaining({ code: "network", fatal: true }),
    );
    expect(speechErrorFor("audio-capture")?.code).toBe("audio-capture");
    expect(speechErrorFor("service-not-allowed")?.code).toBe("not-allowed");
    expect(speechErrorFor("aborted")).toBeNull();
  });
});
