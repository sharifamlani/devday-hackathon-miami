import type { TranscriptLine } from "./callNotes";

/**
 * Where live transcript lines come from. The pane only talks to this
 * interface, so a real speech-to-text source (for example Gemini Live) can
 * replace the scripted demo without touching the UI.
 */
export interface TranscriptSourceError {
  code: "not-allowed" | "no-speech" | "network" | "audio-capture" | "other";
  /** Plain sentence for the person. */
  message: string;
  /** True when the source gave up and will send nothing more. */
  fatal: boolean;
}

export interface TranscriptHandlers {
  /** A finished line. */
  onLine: (line: TranscriptLine) => void;
  /** Words still being recognized ("" clears them). Mic sources only. */
  onInterim?: (text: string) => void;
  onError?: (error: TranscriptSourceError) => void;
  /** The source has nothing more to say (the demo script ran out). */
  onEnd?: () => void;
}

export interface TranscriptSource {
  /** Begin streaming. Call it from a click: mic sources ask for permission here. */
  start(handlers: TranscriptHandlers): void;
  pause(): void;
  resume(): void;
  /** Stop for good; no more lines after this. */
  stop(): void;
  /** True for scripted sources, so the UI can label them. */
  readonly isDemo: boolean;
}

export interface ScriptLine {
  speaker: TranscriptLine["speaker"];
  text: string;
}

export const DEMO_LINE_INTERVAL_MS = 1100;

/** Made-up donor for the demo call when the data has no card-failed donor. */
/**
 * The demo call is with a real sample donor, so the after-call card lands on someone: Hye-jin
 * Park (data/sample_inputs), whose $40 monthly online gift failed on Oct 10. The event she signs
 * up for, The Give Miami 5K on Nov 15, is a real sample event (service/events_cache.json).
 */
export const DEMO_FALLBACK_DONOR = "Hye-jin Park";

export const firstName = (fullName: string) =>
  fullName.trim().split(/\s+/)[0] || fullName;

/**
 * A short call with the demo donor about her failed monthly gift. The staff member is fictional.
 * The wording is chosen so summarize.ts finds the card update, the monthly amount and the event
 * date ("the 15th"), and the after-call agent can propose a card-update task, the 5K RSVP and a
 * context note (new card, prefers phone). Nothing in it promises a new gift, so no pledge.
 */
export const demoCallScript = (donorName: string): ScriptLine[] => {
  const first = firstName(donorName);
  return [
    {
      speaker: "you",
      text: `Hi ${first}, it's Denise from The Miami Foundation. Do you have a minute?`,
    },
    { speaker: "them", text: "Of course. Is everything okay?" },
    {
      speaker: "you",
      text: "Everything's fine. Your $40 a month gift on October 10th didn't go through, so I wanted to check in.",
    },
    {
      speaker: "them",
      text: "Oh, I got a new card last month. I forgot to update it.",
    },
    {
      speaker: "you",
      text: "No problem. I can text you a secure link to update your card.",
    },
    {
      speaker: "them",
      text: "Perfect. And put me down for the Give Miami 5K on the 15th.",
    },
    {
      speaker: "you",
      text: "Will do. Next time, is a text or a call better for you?",
    },
    { speaker: "them", text: "A call, please. I prefer the phone." },
    { speaker: "them", text: "Thank you for calling. Talk soon!" },
  ];
};

export interface DemoSourceOptions {
  script: ScriptLine[];
  /** Display name for "them" lines (the donor's first name). */
  themName: string;
  intervalMs?: number;
  /** Skip lines already shown, e.g. when resuming a stopped call. */
  startIndex?: number;
}

/**
 * Streams a script one line every `intervalMs` (the first line right away).
 * `at` is the line's position in the call in seconds, from its index, so
 * timestamps are deterministic.
 */
export const demoTranscriptSource = ({
  script,
  themName,
  intervalMs = DEMO_LINE_INTERVAL_MS,
  startIndex = 0,
}: DemoSourceOptions): TranscriptSource => {
  let index = startIndex;
  let timer: ReturnType<typeof setInterval> | null = null;
  let handlers: TranscriptHandlers | null = null;
  let state: "idle" | "running" | "paused" | "stopped" = "idle";

  const clear = () => {
    if (timer != null) clearInterval(timer);
    timer = null;
  };

  const emitNext = () => {
    if (state !== "running" || !handlers) return;
    if (index >= script.length) {
      clear();
      state = "stopped";
      handlers.onEnd?.();
      return;
    }
    const line = script[index];
    const at = Math.floor((index * intervalMs) / 1000);
    index += 1;
    handlers.onLine({
      speaker: line.speaker,
      name: line.speaker === "you" ? "You" : themName,
      text: line.text,
      at,
    });
    if (index >= script.length) {
      clear();
      state = "stopped";
      handlers.onEnd?.();
    }
  };

  const schedule = () => {
    clear();
    timer = setInterval(emitNext, intervalMs);
  };

  return {
    isDemo: true,
    start(next) {
      if (state !== "idle") return;
      handlers = next;
      state = "running";
      emitNext();
      if (state === "running") schedule();
    },
    pause() {
      if (state !== "running") return;
      state = "paused";
      clear();
    },
    resume() {
      if (state !== "paused") return;
      state = "running";
      schedule();
    },
    stop() {
      clear();
      state = "stopped";
    },
  };
};

/* ---------- Browser speech recognition (Web Speech API) ---------- */

/** The slice of the Web Speech API this file uses (not in TypeScript's DOM lib). */
interface SpeechAlternativeLike {
  transcript: string;
}
interface SpeechResultLike {
  readonly isFinal: boolean;
  readonly length: number;
  [index: number]: SpeechAlternativeLike;
}
export interface SpeechResultEventLike {
  readonly resultIndex: number;
  readonly results: {
    readonly length: number;
    [index: number]: SpeechResultLike;
  };
}
export interface SpeechErrorEventLike {
  readonly error: string;
}
export interface SpeechRecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: SpeechResultEventLike) => void) | null;
  onerror: ((event: SpeechErrorEventLike) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

/** The browser's speech recognizer, or null (Firefox, some Safari setups). */
export const getSpeechRecognition = (): SpeechRecognitionConstructor | null => {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
};

export const speechErrorFor = (code: string): TranscriptSourceError | null => {
  switch (code) {
    case "not-allowed":
    case "service-not-allowed":
      return {
        code: "not-allowed",
        message: "Microphone access is blocked.",
        fatal: true,
      };
    case "audio-capture":
      return {
        code: "audio-capture",
        message: "No microphone found. Plug one in or use the demo call.",
        fatal: true,
      };
    case "network":
      return {
        code: "network",
        message:
          "Live captions need an internet connection. Check it and try again, or use the demo call.",
        fatal: true,
      };
    case "no-speech":
      return {
        code: "no-speech",
        message: "No speech heard yet. Keep talking or check your microphone.",
        fatal: false,
      };
    case "aborted":
      return null; // we stopped it ourselves
    default:
      return {
        code: "other",
        message: "Live captions stopped. Press Resume to try again.",
        fatal: true,
      };
  }
};

const MAX_RESTARTS = 5;
const RESTART_WINDOW_MS = 5000;

export interface SpeechSourceOptions {
  /** For tests: build the recognizer. Defaults to the browser's. */
  createRecognition?: () => SpeechRecognitionLike;
  lang?: string;
  /** For tests: the clock. */
  now?: () => number;
}

/**
 * Live captions from the microphone through the browser's free speech
 * recognizer (no key, no paid call). Every final result is a "You" line;
 * the browser cannot tell speakers apart. Chrome ends a session after a
 * pause even in continuous mode, so it restarts until paused or stopped.
 */
export const browserSpeechSource = ({
  createRecognition,
  lang,
  now = () => Date.now(),
}: SpeechSourceOptions = {}): TranscriptSource => {
  let recognition: SpeechRecognitionLike | null = null;
  let handlers: TranscriptHandlers | null = null;
  let state: "idle" | "running" | "paused" | "stopped" = "idle";
  // Call time that counts toward `at`: excludes paused stretches.
  let activeMs = 0;
  let runningSince = 0;
  let restarts: number[] = [];

  const elapsedSec = () =>
    Math.floor(
      (activeMs + (state === "running" ? now() - runningSince : 0)) / 1000,
    );

  const build = (): SpeechRecognitionLike | null => {
    if (createRecognition) return createRecognition();
    const Recognition = getSpeechRecognition();
    return Recognition ? new Recognition() : null;
  };

  const listen = () => {
    if (!recognition) return;
    try {
      recognition.start();
    } catch {
      // start() throws if a session is already running; that one continues.
    }
  };

  const fail = (error: TranscriptSourceError) => {
    state = "stopped";
    recognition?.abort();
    handlers?.onInterim?.("");
    handlers?.onError?.(error);
  };

  return {
    isDemo: false,
    start(next) {
      if (state !== "idle") return;
      handlers = next;
      recognition = build();
      if (!recognition) {
        fail({
          code: "other",
          message: "This browser has no live captions. Use the demo call.",
          fatal: true,
        });
        return;
      }
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang =
        lang ||
        (typeof navigator !== "undefined" && navigator.language) ||
        "en-US";
      recognition.onresult = (event) => {
        if (state !== "running") return;
        let interim = "";
        for (let i = event.resultIndex; i < event.results.length; i += 1) {
          const result = event.results[i];
          const text = result[0]?.transcript.trim() ?? "";
          if (!text) continue;
          if (result.isFinal) {
            handlers?.onLine({
              speaker: "you",
              name: "You",
              text: text[0].toUpperCase() + text.slice(1),
              at: elapsedSec(),
            });
          } else {
            interim += (interim ? " " : "") + text;
          }
        }
        handlers?.onInterim?.(interim);
      };
      recognition.onerror = (event) => {
        const error = speechErrorFor(event.error);
        if (!error) return;
        if (error.fatal) fail(error);
        else handlers?.onError?.(error);
      };
      recognition.onend = () => {
        if (state !== "running") return;
        // A session that keeps ending at once (no audio device, a policy
        // block) would spin forever; give up after a burst of restarts.
        const t = now();
        restarts = restarts.filter((at) => t - at < RESTART_WINDOW_MS);
        restarts.push(t);
        if (restarts.length > MAX_RESTARTS) {
          fail({
            code: "other",
            message:
              "Live captions keep stopping. Check your microphone or use the demo call.",
            fatal: true,
          });
          return;
        }
        listen();
      };
      state = "running";
      runningSince = now();
      listen();
    },
    pause() {
      if (state !== "running") return;
      activeMs += now() - runningSince;
      state = "paused";
      recognition?.stop();
      handlers?.onInterim?.("");
    },
    resume() {
      if (state !== "paused") return;
      state = "running";
      runningSince = now();
      listen();
    },
    stop() {
      if (state === "running") activeMs += now() - runningSince;
      state = "stopped";
      recognition?.abort();
      handlers?.onInterim?.("");
    },
  };
};
