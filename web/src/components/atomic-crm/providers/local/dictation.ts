import { useCallback, useEffect, useRef, useState } from "react";

import { API_URL, DATA_MODE, MOCK_ENDPOINTS } from "./config";
import { knownRoutes, routeExists } from "./routes";

/**
 * Live transcription over WS /transcribe/live?purpose=dictation|call
 * (plan.md §21.5, Agent Phone's relay). The microphone is captured as 16 kHz
 * PCM16 by the lifted Google AudioRecorder (./audio, Apache-2.0) and sent as
 * binary frames; {"type":"end"} closes the utterance. The server answers
 * {"type":"interim"|"final","text"} and {"type":"error","detail"}.
 */
export type TranscribePurpose = "dictation" | "call";

export type TranscriptionStatus =
  | "idle"
  | "connecting"
  | "listening"
  | "stopping"
  | "error"
  | "unavailable";

export interface TranscriptLine {
  text: string;
  at: number; // seconds since start
}

export interface ServerMessage {
  type: "interim" | "final" | "error";
  text?: string;
  detail?: string;
}

export const wsUrl = (purpose: TranscribePurpose) =>
  `${API_URL.replace(/^http/, "ws")}/transcribe/live?purpose=${purpose}`;

/**
 * FastAPI's /openapi.json doesn't list WebSocket routes; POST /transcribe/file
 * ships in the same voice router, so it stands in. Unknown table → try.
 */
const voiceServed = async () => {
  const routes = await knownRoutes();
  return !routes || routeExists(routes, "POST", "/transcribe/file");
};

/** Fold one server message into {interim, finals}; exported for tests. */
export const applyMessage = (
  state: { interim: string; finals: TranscriptLine[]; error: string | null },
  message: ServerMessage,
  at: number,
) => {
  if (message.type === "interim") return { ...state, interim: message.text ?? "" };
  if (message.type === "final") {
    const text = (message.text ?? "").trim();
    return {
      ...state,
      interim: "",
      finals: text ? [...state.finals, { text, at }] : state.finals,
    };
  }
  return { ...state, error: message.detail ?? "Transcription failed." };
};

/** No audio frame from the microphone this long after it started: report it. */
export const NO_AUDIO_MS = 4000;
export const NO_AUDIO_MESSAGE = "No audio is reaching dictation. Check your microphone.";

const MOCK_SCRIPT: { after: number; message: ServerMessage }[] = [
  { after: 300, message: { type: "interim", text: "Who gave on" } },
  { after: 700, message: { type: "interim", text: "Who gave on Give Miami Day" } },
  { after: 1100, message: { type: "final", text: "Who gave on Give Miami Day last year but not yet this year?" } },
];

const useLiveTranscription = (purpose: TranscribePurpose) => {
  const [status, setStatus] = useState<TranscriptionStatus>(
    DATA_MODE === "snapshot" ? "unavailable" : "idle",
  );
  const [state, setState] = useState<{ interim: string; finals: TranscriptLine[]; error: string | null }>(
    { interim: "", finals: [], error: null },
  );
  const [mock, setMock] = useState(false);
  const socket = useRef<WebSocket | null>(null);
  const recorder = useRef<{ stop: () => void; off: (event: string) => void } | null>(null);
  const startedAt = useRef(0);
  const timers = useRef<number[]>([]);

  const elapsed = () => (performance.now() - startedAt.current) / 1000;
  const onMessage = useCallback((message: ServerMessage) => {
    setState((s) => applyMessage(s, message, elapsed()));
    if (message.type === "error") setStatus("error");
  }, []);

  const cleanup = useCallback(() => {
    recorder.current?.off("data");
    recorder.current?.stop();
    recorder.current = null;
    timers.current.forEach((t) => window.clearTimeout(t));
    timers.current = [];
    if (socket.current && socket.current.readyState <= WebSocket.OPEN) socket.current.close();
    socket.current = null;
  }, []);

  useEffect(() => cleanup, [cleanup]);

  const start = useCallback(async () => {
    if (DATA_MODE === "snapshot") {
      setState((s) => ({ ...s, error: "Voice needs the live API; the snapshot build doesn’t have it." }));
      setStatus("unavailable");
      return;
    }
    cleanup();
    setState({ interim: "", finals: [], error: null });
    startedAt.current = performance.now();
    setStatus("connecting");

    if (!(await voiceServed())) {
      if (MOCK_ENDPOINTS) {
        // Labeled simulation for building screens before the relay lands.
        setMock(true);
        setStatus("listening");
        console.warn(`[mock] WS /transcribe/live?purpose=${purpose}: simulated transcript (VITE_MOCK_ENDPOINTS=1)`);
        timers.current = MOCK_SCRIPT.map(({ after, message }) =>
          window.setTimeout(() => onMessage(message), after),
        );
        return;
      }
      setState((s) => ({ ...s, error: "Voice isn’t available yet: the transcription service isn’t running." }));
      setStatus("unavailable");
      return;
    }
    setMock(false);

    try {
      const ws = new WebSocket(wsUrl(purpose));
      ws.binaryType = "arraybuffer";
      socket.current = ws;
      ws.onmessage = (event) => {
        let message: ServerMessage;
        try {
          message = JSON.parse(String(event.data)) as ServerMessage;
        } catch {
          return; // ignore non-JSON frames
        }
        onMessage(message);
        if (message.type === "error") cleanup(); // the server gave up: release the mic too
      };
      ws.onerror = () => {
        setState((s) => ({ ...s, error: s.error ?? "The transcription connection failed." }));
        setStatus("error");
      };
      ws.onclose = () => setStatus((current) => (current === "error" ? current : "idle"));
      await new Promise<void>((resolve, reject) => {
        ws.onopen = () => resolve();
        const fail = ws.onerror;
        ws.onerror = (event) => {
          fail?.call(ws, event);
          reject(new Error("The transcription connection failed."));
        };
      });

      const [{ AudioRecorder }, { base64ToArrayBuffer }] = await Promise.all([
        import("./audio/audio-recorder"),
        import("./audio/utils"),
      ]);
      const rec = new AudioRecorder(16000);
      let heard = false;
      rec.on("data", (base64: string) => {
        heard = true;
        if (ws.readyState === WebSocket.OPEN) ws.send(base64ToArrayBuffer(base64));
      });
      recorder.current = rec;
      await rec.start();
      // The server may have refused while the mic started (e.g. no GEMINI_API_KEY: an error
      // message, then close). Keep that error instead of claiming to listen.
      if (socket.current !== ws || ws.readyState !== WebSocket.OPEN) {
        cleanup();
        setState((s) => ({ ...s, error: s.error ?? "The transcription connection closed." }));
        setStatus("error");
        return;
      }
      setStatus("listening");
      // AudioRecorder.start() resolves before the mic is ready and never rejects, so a denied
      // or dead microphone shows up only as silence: time it out.
      timers.current.push(
        window.setTimeout(() => {
          if (heard || recorder.current !== rec) return; // audio flowing, or already stopped
          cleanup();
          setState((s) => ({ ...s, error: NO_AUDIO_MESSAGE }));
          setStatus("error");
        }, NO_AUDIO_MS),
      );
    } catch (error) {
      cleanup();
      setState((s) => ({ ...s, error: s.error ?? (error as Error).message }));
      setStatus("error");
    }
  }, [cleanup, onMessage, purpose]);

  /** Stop the mic, send {"type":"end"}, and let the last final arrive. */
  const stop = useCallback(() => {
    if (mock) {
      timers.current.forEach((t) => window.clearTimeout(t));
      timers.current = [];
      setState((s) =>
        s.interim ? applyMessage(s, { type: "final", text: s.interim }, elapsed()) : s,
      );
      setStatus("idle");
      return;
    }
    recorder.current?.off("data");
    recorder.current?.stop();
    recorder.current = null;
    const ws = socket.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      setStatus("stopping");
      ws.send(JSON.stringify({ type: "end" }));
      // The server closes after the last final; close anyway after 5 s.
      timers.current.push(window.setTimeout(() => ws.close(), 5000));
    } else {
      setStatus("idle");
    }
  }, [mock]);

  const reset = useCallback(() => {
    cleanup();
    setState({ interim: "", finals: [], error: null });
    setStatus(DATA_MODE === "snapshot" ? "unavailable" : "idle");
  }, [cleanup]);

  return { status, ...state, start, stop, reset, mock, elapsed };
};

/**
 * Chat-box dictation: words appear as `interim` while speaking; `final` is the
 * finished text to put in the box. Nothing is stored server-side.
 */
export const useDictation = () => {
  const live = useLiveTranscription("dictation");
  return {
    start: live.start,
    stop: live.stop,
    reset: live.reset,
    status: live.status,
    listening: live.status === "listening",
    interim: live.interim,
    final: live.finals.map((f) => f.text).join(" "),
    error: live.error,
    mock: live.mock, // true while the labeled simulation answers
  };
};

/**
 * A call's live transcript: timed lines, the joined text and the duration,
 * shaped for useSaveCallNote ({transcript, duration_s}).
 */
export const useCallTranscript = () => {
  const live = useLiveTranscription("call");
  const [durationS, setDurationS] = useState(0);
  const { status, elapsed } = live;
  useEffect(() => {
    if (status !== "listening") return;
    const timer = window.setInterval(() => setDurationS(Math.round(elapsed())), 1000);
    return () => window.clearInterval(timer);
  }, [status, elapsed]);
  return {
    start: live.start,
    stop: live.stop,
    reset: () => {
      live.reset();
      setDurationS(0);
    },
    status: live.status,
    listening: live.status === "listening",
    interim: live.interim,
    lines: live.finals,
    transcript: live.finals.map((f) => f.text).join("\n"),
    durationS,
    error: live.error,
    mock: live.mock,
  };
};
