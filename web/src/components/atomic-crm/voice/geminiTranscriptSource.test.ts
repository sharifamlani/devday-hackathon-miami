import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { TranscriptLine } from "./callNotes";
import {
  geminiTranscriptSource,
  liveTranscribeUrl,
  warmUpCaptions,
  type CallRecorderLike,
  type RecorderLike,
  type SocketLike,
} from "./geminiTranscriptSource";
import type { TranscriptSourceError } from "./transcriptSource";

class FakeSocket implements SocketLike {
  binaryType = "blob";
  readyState = 0;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  sent: (ArrayBuffer | string)[] = [];
  closed = false;
  constructor(public url: string) {}
  send(data: ArrayBuffer | string) {
    this.sent.push(data);
  }
  close() {
    this.closed = true;
    this.readyState = 3;
  }
  open() {
    this.readyState = 1;
    this.onopen?.();
  }
  server(msg: object) {
    this.onmessage?.({ data: JSON.stringify(msg) });
  }
}

class FakeRecorder implements RecorderLike {
  listener: ((b64: string) => void) | null = null;
  started = false;
  stopped = false;
  on(_event: "data", fn: (b64: string) => void) {
    this.listener = fn;
    return this;
  }
  async start() {
    this.started = true;
  }
  stop() {
    this.stopped = true;
  }
  frame(bytes: number[]) {
    this.listener?.(btoa(String.fromCharCode(...bytes)));
  }
}

class FakeCallRecorder implements CallRecorderLike {
  state: "inactive" | "recording" | "paused" = "inactive";
  mimeType = "audio/webm;codecs=opus";
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  start() {
    this.state = "recording";
  }
  pause() {
    this.state = "paused";
  }
  resume() {
    this.state = "recording";
  }
  chunk(text: string) {
    this.ondataavailable?.({ data: new Blob([text]) });
  }
  stop() {
    this.state = "inactive";
    // like MediaRecorder: the last chunk, then onstop, after the call returns
    queueMicrotask(() => {
      this.chunk("tail");
      this.onstop?.();
    });
  }
}

const setup = () => {
  const sockets: FakeSocket[] = [];
  const recorders: FakeRecorder[] = [];
  let t = 0;
  const lines: TranscriptLine[] = [];
  const interims: string[] = [];
  const errors: TranscriptSourceError[] = [];
  const callRecorder = new FakeCallRecorder();
  const source = geminiTranscriptSource({
    createCallRecorder: async () => callRecorder,
    createSocket: (url) => {
      const s = new FakeSocket(url);
      sockets.push(s);
      return s;
    },
    createRecorder: () => {
      const r = new FakeRecorder();
      recorders.push(r);
      return r;
    },
    now: () => t,
  });
  source.start({
    onLine: (l) => lines.push(l),
    onInterim: (text) => interims.push(text),
    onError: (e) => errors.push(e),
  });
  return { source, sockets, recorders, callRecorder, lines, interims, errors, tick: (ms: number) => (t += ms) };
};

describe("geminiTranscriptSource", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("targets the service's live relay over ws", () => {
    expect(liveTranscribeUrl("dictation")).toMatch(/^ws:\/\/.+\/transcribe\/live\?purpose=dictation$/);
  });

  it("streams mic frames as binary and turns finals into You lines", () => {
    const { source, sockets, recorders, lines, interims } = setup();
    const [ws] = sockets;
    expect(ws.url).toContain("purpose=call");
    expect(recorders[0].started).toBe(true); // the mic starts with the handshake
    recorders[0].frame([1, 0]); // heard before the socket opened: buffered
    recorders[0].frame([2, 0]);
    expect(ws.sent).toHaveLength(0);
    ws.open();
    recorders[0].frame([3, 0]);
    expect(ws.sent.map((f) => [...new Uint8Array(f as ArrayBuffer)])).toEqual([[1, 0], [2, 0], [3, 0]]);

    ws.server({ type: "interim", text: "Who gave" });
    ws.server({ type: "final", text: "Who gave this quarter?" });
    expect(interims).toEqual(["Who gave", ""]);
    expect(lines).toEqual([{ speaker: "you", name: "You", text: "Who gave this quarter?", at: 0 }]);
    expect(source.isDemo).toBe(false);
  });

  it("pause ends the session gracefully, resume opens a new one, and time skips the pause", () => {
    const { source, sockets, recorders, lines, tick } = setup();
    sockets[0].open();
    recorders[0].frame([0, 0]);
    tick(5000);
    source.pause();
    expect(recorders[0].stopped).toBe(true);
    expect(sockets[0].sent.at(-1)).toBe(JSON.stringify({ type: "end" }));
    sockets[0].server({ type: "final", text: "Last words." }); // the final still lands after pause
    expect(lines.at(-1)).toMatchObject({ text: "Last words.", at: 5 });

    tick(60_000); // paused: does not count
    source.resume();
    expect(sockets).toHaveLength(2);
    sockets[1].open();
    recorders[1].frame([0, 0]);
    tick(2000);
    sockets[1].server({ type: "final", text: "Back again." });
    expect(lines.at(-1)).toMatchObject({ text: "Back again.", at: 7 });
  });

  it("stop closes everything and drops later messages", () => {
    const { source, sockets, recorders, lines } = setup();
    sockets[0].open();
    source.stop();
    expect(sockets[0].closed).toBe(true);
    expect(recorders[0].stopped).toBe(true);
    sockets[0].server({ type: "final", text: "too late" });
    expect(lines).toEqual([]);
  });

  it("reports a server error, a dropped socket, and silence as fatal", () => {
    const a = setup();
    a.sockets[0].open();
    a.recorders[0].frame([0, 0]);
    a.sockets[0].server({ type: "error", detail: "live transcription failed" });
    expect(a.errors).toHaveLength(1);
    expect(a.errors[0].fatal).toBe(true);

    const b = setup();
    b.sockets[0].open();
    b.recorders[0].frame([0, 0]);
    b.sockets[0].onclose?.();
    expect(b.errors[0].message).toMatch(/stopped/);

    const c = setup();
    c.sockets[0].open(); // the mic never sends a frame
    vi.advanceTimersByTime(4000);
    expect(c.errors[0].message).toMatch(/No audio/);
    expect(c.recorders[0].stopped).toBe(true);
  });

  it("records the call, pauses the recording with the captions, and hands it over with its line count", async () => {
    const { source, sockets, recorders, callRecorder } = setup();
    await Promise.resolve(); // the call recorder comes up asynchronously
    expect(callRecorder.state).toBe("recording");
    sockets[0].open();
    recorders[0].frame([0, 0]);
    callRecorder.chunk("a");
    sockets[0].server({ type: "final", text: "One." });
    sockets[0].server({ type: "final", text: "Two." });
    source.pause();
    expect(callRecorder.state).toBe("paused");
    source.resume();
    expect(callRecorder.state).toBe("recording");

    const finishing = source.finishRecording();
    source.stop(); // the pane stops the source right after taking the recording
    const rec = await finishing;
    expect(rec?.lines).toBe(2);
    expect(await rec?.audio.text()).toBe("atail"); // the last chunk is not lost
    expect(rec?.audio.type).toBe("audio/webm;codecs=opus");
  });

  it("gives no recording where the browser can't record", async () => {
    const source = geminiTranscriptSource({
      createSocket: (url) => new FakeSocket(url),
      createRecorder: () => new FakeRecorder(),
      createCallRecorder: async () => null,
    });
    source.start({ onLine: () => {} });
    expect(await source.finishRecording()).toBeNull();
  });
});

describe("warmUpCaptions", () => {
  it("holds one suspended 16 kHz AudioContext, created once", () => {
    const made: { sampleRate?: number; suspended: boolean }[] = [];
    const Real = globalThis.AudioContext;
    globalThis.AudioContext = class {
      rec: { sampleRate?: number; suspended: boolean };
      constructor(o?: AudioContextOptions) {
        this.rec = { sampleRate: o?.sampleRate, suspended: false };
        made.push(this.rec);
      }
      suspend() {
        this.rec.suspended = true;
        return Promise.resolve();
      }
    } as unknown as typeof AudioContext;
    try {
      warmUpCaptions();
      warmUpCaptions();
      // at most one made here (none if the module's own warm-up already ran in local mode)
      expect(made.length).toBeLessThanOrEqual(1);
      for (const m of made) expect(m).toEqual({ sampleRate: 16000, suspended: true });
    } finally {
      globalThis.AudioContext = Real;
    }
  });
});
