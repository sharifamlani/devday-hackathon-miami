import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "vitest-browser-react";

// Local mode with the voice route served; the relay socket and the microphone are fakes.
vi.mock("./config", () => ({ DATA_MODE: "local", MOCK_ENDPOINTS: false, API_URL: "http://127.0.0.1:8000" }));
vi.mock("./routes", () => ({ knownRoutes: async () => null, routeExists: () => true }));

const mic = vi.hoisted(() => ({
  instances: [] as { listeners: Record<string, (b64: string) => void>; stopped: boolean; frame: () => void }[],
}));
vi.mock("./audio/audio-recorder", () => ({
  AudioRecorder: class {
    listeners: Record<string, (b64: string) => void> = {};
    stopped = false;
    constructor() {
      mic.instances.push(this);
    }
    on(event: string, fn: (b64: string) => void) {
      this.listeners[event] = fn;
      return this;
    }
    off(event: string) {
      delete this.listeners[event];
      return this;
    }
    async start() {}
    stop() {
      this.stopped = true;
    }
    frame() {
      this.listeners.data?.(btoa("\u0001\u0000"));
    }
  },
}));

type Script = (ws: FakeSocket) => void;
let onOpen: Script = () => {};

class FakeSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  static last: FakeSocket | null = null;
  readyState = 0;
  binaryType = "blob";
  sent: unknown[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  constructor(public url: string) {
    FakeSocket.last = this;
    setTimeout(() => {
      this.readyState = 1;
      this.onopen?.();
      onOpen(this);
    }, 0);
  }
  send(d: unknown) {
    this.sent.push(d);
  }
  close() {
    if (this.readyState === 3) return;
    this.readyState = 3;
    this.onclose?.();
  }
  server(msg: object) {
    this.onmessage?.({ data: JSON.stringify(msg) });
  }
}

const { useDictation, NO_AUDIO_MESSAGE, MIC_BLOCKED_MESSAGE } = await import("./dictation");
// Load the modules the hook imports on demand, so its dynamic import resolves from cache
// instead of racing the fake clock.
await Promise.all([import("./audio/audio-recorder"), import("./audio/utils")]);

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("WebSocket", FakeSocket);
  mic.instances = [];
  onOpen = () => {};
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const press = async () => {
  const h = await renderHook(() => useDictation());
  void h.result.current.start();
  // The socket opens on the fake clock; the recorder module's dynamic import resolves on real time.
  for (let i = 0; i < 500 && !["listening", "error"].includes(h.result.current.status); i += 1) {
    await vi.advanceTimersByTimeAsync(10);
    await new Promise((r) => queueMicrotask(() => r(null)));
    await h.rerender();
  }
  return h;
};

describe("useDictation errors are not silent", () => {
  it("no GEMINI_API_KEY: the server's error stands; never 'listening'; the mic is released", async () => {
    onOpen = (ws) => {
      ws.server({ type: "error", detail: "GEMINI_API_KEY not set on the server" });
      ws.close();
    };
    const h = await press();
    await vi.advanceTimersByTimeAsync(5000);
    await h.rerender();
    expect(h.result.current.status).toBe("error");
    expect(h.result.current.error).toBe("GEMINI_API_KEY not set on the server");
    expect(mic.instances.every((m) => m.stopped || !m.listeners.data)).toBe(true);
  });

  it("the server refuses after the mic started: error, and the mic is released", async () => {
    const h = await press();
    expect(h.result.current.status).toBe("listening");
    mic.instances[0].frame();
    FakeSocket.last!.server({ type: "error", detail: "live transcription failed: quota" });
    await h.rerender();
    expect(h.result.current.status).toBe("error");
    expect(h.result.current.error).toMatch(/quota/);
    expect(mic.instances[0].stopped).toBe(true);
  });

  it("a denied or dead microphone (no audio frames): error after the watchdog", async () => {
    const h = await press();
    expect(h.result.current.status).toBe("listening");
    await vi.advanceTimersByTimeAsync(4000);
    await h.rerender();
    expect(h.result.current.status).toBe("error");
    expect(h.result.current.error).toBe(NO_AUDIO_MESSAGE);
    expect(FakeSocket.last!.readyState).toBe(3); // the socket is closed too
  });

  it("audio flowing: frames are sent and it stays listening past the watchdog", async () => {
    const h = await press();
    mic.instances[0].frame();
    await vi.advanceTimersByTimeAsync(4000);
    await h.rerender();
    expect(h.result.current.status).toBe("listening");
    expect(FakeSocket.last!.sent.filter((d) => d instanceof ArrayBuffer)).toHaveLength(1);
  });

  it("stopped before any audio: the watchdog doesn't report an error", async () => {
    const h = await press();
    h.result.current.stop();
    await vi.advanceTimersByTimeAsync(4000);
    await h.rerender();
    expect(h.result.current.error).toBeNull();
  });

  it("a blocked microphone says so at once, and never opens a socket", async () => {
    vi.stubGlobal("navigator", { ...navigator, permissions: { query: async () => ({ state: "denied" }) } });
    FakeSocket.last = null;
    const h = await press();
    expect(h.result.current.status).toBe("error");
    expect(h.result.current.error).toBe(MIC_BLOCKED_MESSAGE);
    expect(FakeSocket.last).toBeNull();
  });
});
