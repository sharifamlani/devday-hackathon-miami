import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { TranscriptLine } from "./callNotes";
import {
  geminiTranscriptSource,
  liveTranscribeUrl,
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

const setup = () => {
  const sockets: FakeSocket[] = [];
  const recorders: FakeRecorder[] = [];
  let t = 0;
  const lines: TranscriptLine[] = [];
  const interims: string[] = [];
  const errors: TranscriptSourceError[] = [];
  const source = geminiTranscriptSource({
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
  return { source, sockets, recorders, lines, interims, errors, tick: (ms: number) => (t += ms) };
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
    expect(recorders).toHaveLength(0); // the mic opens only once the socket is up
    ws.open();
    expect(recorders[0].started).toBe(true);
    recorders[0].frame([1, 0, 2, 0]);
    expect(ws.sent).toHaveLength(1);
    expect(new Uint8Array(ws.sent[0] as ArrayBuffer)).toEqual(new Uint8Array([1, 0, 2, 0]));

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
});
