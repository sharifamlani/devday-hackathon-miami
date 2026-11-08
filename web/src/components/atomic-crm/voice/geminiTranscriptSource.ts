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
 * The microphone starts with the socket, not after it opens: frames captured
 * during the handshake are buffered and flushed on open, so the first words
 * of a call are not lost.
 *
 * Gemini Live gives no speaker labels, so every final is a "You" line, as
 * with the browser recognizer. The source also records the call (webm/opus)
 * for the speaker-labelled pass at the end (speakerLabels.ts):
 * finishRecording() hands that recording over. Pausing ends the Gemini
 * session and resuming opens a new one, which also keeps each session under
 * Gemini's 10-minute cap; the recording pauses with it.
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

/** The slice of MediaRecorder this file uses. */
export interface CallRecorderLike {
  state: "inactive" | "recording" | "paused";
  mimeType: string;
  ondataavailable: ((event: { data: Blob }) => void) | null;
  onstop: (() => void) | null;
  start(timesliceMs?: number): void;
  pause(): void;
  resume(): void;
  stop(): void;
}

export interface CallRecording {
  audio: Blob;
  /**
   * Final lines this source emitted. They are the last `lines` lines of the
   * pane's transcript: the stretch this recording covers (the pane restarts
   * the mic source after a pause, so earlier lines belong to earlier recordings).
   */
  lines: number;
}

export interface RecordingSource extends TranscriptSource {
  /**
   * Stop recording and resolve with this source's recording (null when
   * nothing was recorded). Call it before stop(), which ends the recording.
   */
  finishRecording(): Promise<CallRecording | null>;
}

export interface GeminiSourceOptions {
  /** For tests: open the socket. Defaults to a WebSocket to our service. */
  createSocket?: (url: string) => SocketLike;
  /** For tests: the PCM microphone. Defaults to the lifted AudioRecorder. */
  createRecorder?: () => RecorderLike;
  /**
   * For tests: the call recorder. Defaults to a MediaRecorder on its own
   * microphone stream; null when the browser can't record.
   */
  createCallRecorder?: () => Promise<CallRecorderLike | null>;
  purpose?: "call" | "dictation";
  /** For tests: the clock. */
  now?: () => number;
  /** No audio reaching the relay this long after start: give up. */
  noAudioMs?: number;
}

const OPEN = 1;
/** Frames held while the socket opens: ~10 s at 8 frames a second. */
const MAX_BUFFERED_FRAMES = 80;

export const liveTranscribeUrl = (purpose: "call" | "dictation") =>
  `${API_URL.replace(/^http/, "ws")}/transcribe/live?purpose=${purpose}`;

const failure = (message: string): TranscriptSourceError => ({
  code: "network",
  message,
  fatal: true,
});

const RECORDING_TYPES = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus"];

/** A MediaRecorder on its own microphone stream, or null where recording isn't supported. */
export const browserCallRecorder = async (): Promise<CallRecorderLike | null> => {
  if (typeof MediaRecorder === "undefined" || !navigator.mediaDevices?.getUserMedia) return null;
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const mimeType = RECORDING_TYPES.find((t) => MediaRecorder.isTypeSupported(t));
  const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
  // Release the microphone when recording ends, whoever stops it.
  recorder.addEventListener("stop", () => stream.getTracks().forEach((t) => t.stop()));
  return recorder as unknown as CallRecorderLike;
};

export const geminiTranscriptSource = ({
  createSocket = (url) => new WebSocket(url) as unknown as SocketLike,
  createRecorder = () => new AudioRecorder(16000),
  createCallRecorder = browserCallRecorder,
  purpose = "call",
  now = () => Date.now(),
  noAudioMs = 4000,
}: GeminiSourceOptions = {}): RecordingSource => {
  let handlers: TranscriptHandlers | null = null;
  let state: "idle" | "running" | "paused" | "stopped" = "idle";
  let socket: SocketLike | null = null;
  let recorder: RecorderLike | null = null;
  let pending: ArrayBuffer[] = [];
  let watchdog: ReturnType<typeof setTimeout> | null = null;
  // Call time that counts toward `at`: excludes paused stretches.
  let activeMs = 0;
  let runningSince = 0;
  // The whole-call recording for the speaker pass.
  let callRecorder: CallRecorderLike | null = null;
  let callRecorderReady: Promise<CallRecorderLike | null> | null = null;
  const chunks: Blob[] = [];
  let finals = 0;
  let recordingStopped: Promise<void> | null = null;

  /** Stop the call recorder once; resolves after its last chunk has arrived. */
  const stopCallRecorder = (r: CallRecorderLike): Promise<void> => {
    if (!recordingStopped) {
      recordingStopped =
        r.state === "inactive"
          ? Promise.resolve()
          : new Promise<void>((resolve) => {
              r.onstop = () => resolve();
              r.stop(); // the last dataavailable fires before onstop
            });
    }
    return recordingStopped;
  };

  const elapsedSec = () =>
    Math.floor(
      (activeMs + (state === "running" ? now() - runningSince : 0)) / 1000,
    );

  const clearWatchdog = () => {
    if (watchdog != null) clearTimeout(watchdog);
    watchdog = null;
  };

  const startCallRecording = () => {
    callRecorderReady = createCallRecorder()
      .then((r) => {
        if (!r) return null;
        if (state === "stopped") {
          r.stop();
          return null;
        }
        r.ondataavailable = (e) => {
          if (e.data.size) chunks.push(e.data);
        };
        r.start(1000);
        if (state === "paused") r.pause();
        callRecorder = r;
        return r;
      })
      .catch(() => null); // no recording: the live lines stand
  };

  /** End the current Gemini session; `graceful` lets the last final arrive first. */
  const disconnect = (graceful: boolean) => {
    clearWatchdog();
    recorder?.stop();
    recorder = null;
    pending = [];
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
        finals += 1;
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
      for (const frame of pending) s.send(frame); // what the mic heard during the handshake
      pending = [];
    };

    // The microphone starts now, alongside the handshake.
    const r = createRecorder();
    recorder = r;
    r.on("data", (base64) => {
      clearWatchdog();
      if (socket !== s || state !== "running") return;
      const frame = base64ToArrayBuffer(base64);
      if (s.readyState === OPEN) s.send(frame);
      else if (pending.length < MAX_BUFFERED_FRAMES) pending.push(frame);
    });
    // AudioRecorder.start() resolves before the microphone is ready and never
    // rejects, so a dead microphone shows up only as silence: time it out.
    watchdog = setTimeout(() => {
      if (socket === s) fail("No audio is reaching live captions. Check your microphone or use the demo call.");
    }, noAudioMs);
    void r.start();
  };

  return {
    isDemo: false,
    start(next) {
      if (state !== "idle") return;
      handlers = next;
      state = "running";
      runningSince = now();
      connect();
      startCallRecording();
    },
    pause() {
      if (state !== "running") return;
      activeMs += now() - runningSince;
      state = "paused";
      disconnect(true);
      if (callRecorder?.state === "recording") callRecorder.pause();
    },
    resume() {
      if (state !== "paused") return;
      state = "running";
      runningSince = now();
      connect();
      if (callRecorder?.state === "paused") callRecorder.resume();
    },
    stop() {
      if (state === "running") activeMs += now() - runningSince;
      state = "stopped";
      disconnect(false);
      if (callRecorder) void stopCallRecorder(callRecorder);
      handlers?.onInterim?.("");
    },
    async finishRecording() {
      const r = await callRecorderReady;
      if (!r) return null;
      await stopCallRecorder(r);
      return chunks.length
        ? { audio: new Blob(chunks, { type: r.mimeType || "audio/webm" }), lines: finals }
        : null;
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
