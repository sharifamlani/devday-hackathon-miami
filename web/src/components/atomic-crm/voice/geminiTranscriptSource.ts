import { API_URL, DATA_MODE } from "../providers/local/config";
import { AudioRecorder } from "./audio/audio-recorder";
import { base64ToArrayBuffer } from "./audio/utils";
import type { TranscriptLine } from "./callNotes";
import {
  browserSpeechSource,
  type TranscriptHandlers,
  type TranscriptSource,
  type TranscriptSourceError,
} from "./transcriptSource";

/**
 * Live captions through our service's Gemini relay (service/routes_voice.py):
 * the microphone as 16 kHz PCM16 frames over WS /transcribe/live, interim and
 * final text back. The Gemini key stays on the server.
 *
 * Gemini Live gives no speaker labels, so every final is a "You" line, as
 * with the browser recognizer. Pausing ends the Gemini session and resuming
 * opens a new one, which also keeps each session under Gemini's 10-minute cap.
 */

export interface SocketLike {
  binaryType: string;
  readyState: number;
  onopen: (() => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onclose: (() => void) | null;
  onerror: (() => void) | null;
  send(data: ArrayBuffer | string): void;
  close(): void;
}

export interface RecorderLike {
  on(event: "data", fn: (base64: string) => void): unknown;
  start(): Promise<void>;
  stop(): void;
}

export interface GeminiSourceOptions {
  /** For tests: open the socket. Defaults to a WebSocket to our service. */
  createSocket?: (url: string) => SocketLike;
  /** For tests: the microphone. Defaults to the lifted AudioRecorder. */
  createRecorder?: () => RecorderLike;
  purpose?: "call" | "dictation";
  /** For tests: the clock. */
  now?: () => number;
  /** No audio reaching the relay this long after start: give up. */
  noAudioMs?: number;
}

const OPEN = 1;

export const liveTranscribeUrl = (purpose: "call" | "dictation") =>
  `${API_URL.replace(/^http/, "ws")}/transcribe/live?purpose=${purpose}`;

const failure = (message: string): TranscriptSourceError => ({
  code: "network",
  message,
  fatal: true,
});

export const geminiTranscriptSource = ({
  createSocket = (url) => new WebSocket(url) as unknown as SocketLike,
  createRecorder = () => new AudioRecorder(16000),
  purpose = "call",
  now = () => Date.now(),
  noAudioMs = 4000,
}: GeminiSourceOptions = {}): TranscriptSource => {
  let handlers: TranscriptHandlers | null = null;
  let state: "idle" | "running" | "paused" | "stopped" = "idle";
  let socket: SocketLike | null = null;
  let recorder: RecorderLike | null = null;
  let watchdog: ReturnType<typeof setTimeout> | null = null;
  // Call time that counts toward `at`: excludes paused stretches.
  let activeMs = 0;
  let runningSince = 0;

  const elapsedSec = () =>
    Math.floor(
      (activeMs + (state === "running" ? now() - runningSince : 0)) / 1000,
    );

  const clearWatchdog = () => {
    if (watchdog != null) clearTimeout(watchdog);
    watchdog = null;
  };

  /** End the current Gemini session; `graceful` lets the last final arrive first. */
  const disconnect = (graceful: boolean) => {
    clearWatchdog();
    recorder?.stop();
    recorder = null;
    const s = socket;
    socket = null;
    if (!s) return;
    s.onclose = null;
    if (graceful && s.readyState === OPEN) {
      s.send(JSON.stringify({ type: "end" })); // the server closes after the final
    } else {
      s.onmessage = null;
      s.close();
    }
  };

  const fail = (message: string) => {
    disconnect(false);
    state = "stopped";
    handlers?.onInterim?.("");
    handlers?.onError?.(failure(message));
  };

  const connect = () => {
    const s = createSocket(liveTranscribeUrl(purpose));
    socket = s;
    s.binaryType = "arraybuffer";
    s.onmessage = (event) => {
      if (state === "stopped" || typeof event.data !== "string") return;
      let msg: { type?: string; text?: string; detail?: string };
      try {
        msg = JSON.parse(event.data);
      } catch {
        return;
      }
      if (msg.type === "interim" && state === "running") {
        handlers?.onInterim?.(msg.text ?? "");
      } else if (msg.type === "final" && msg.text) {
        handlers?.onInterim?.("");
        handlers?.onLine({ speaker: "you", name: "You", text: msg.text, at: elapsedSec() } satisfies TranscriptLine);
      } else if (msg.type === "error") {
        fail("Live captions stopped. Press Resume to try again, or use the demo call.");
      }
    };
    s.onerror = () => {
      if (socket === s) fail("Live captions can't reach the Donor Desk service. Check that it is running.");
    };
    s.onclose = () => {
      if (socket === s && state === "running") fail("Live captions stopped. Press Resume to try again.");
    };
    s.onopen = () => {
      if (socket !== s) return;
      const r = createRecorder();
      recorder = r;
      r.on("data", (base64) => {
        clearWatchdog();
        if (socket === s && state === "running" && s.readyState === OPEN) {
          s.send(base64ToArrayBuffer(base64));
        }
      });
      // AudioRecorder.start() resolves before the microphone is ready and never
      // rejects, so a dead microphone shows up only as silence: time it out.
      watchdog = setTimeout(() => {
        if (socket === s) fail("No audio is reaching live captions. Check your microphone or use the demo call.");
      }, noAudioMs);
      void r.start();
    };
  };

  return {
    isDemo: false,
    start(next) {
      if (state !== "idle") return;
      handlers = next;
      state = "running";
      runningSince = now();
      connect();
    },
    pause() {
      if (state !== "running") return;
      activeMs += now() - runningSince;
      state = "paused";
      disconnect(true);
    },
    resume() {
      if (state !== "paused") return;
      state = "running";
      runningSince = now();
      connect();
    },
    stop() {
      if (state === "running") activeMs += now() - runningSince;
      state = "stopped";
      disconnect(false);
      handlers?.onInterim?.("");
    },
  };
};

/**
 * The microphone source for the live transcript pane: Gemini through our
 * service when the app runs against it (VITE_DATA_MODE=local), else the
 * browser's own recognizer (Vercel has no service). VITE_TRANSCRIBE_SOURCE=browser
 * forces the browser recognizer.
 */
export const usesGeminiCaptions = (): boolean =>
  DATA_MODE === "local" && import.meta.env.VITE_TRANSCRIBE_SOURCE !== "browser";

export const micTranscriptSource = (): TranscriptSource =>
  usesGeminiCaptions() ? geminiTranscriptSource() : browserSpeechSource();
