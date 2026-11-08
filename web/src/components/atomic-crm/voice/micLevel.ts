/**
 * The microphone for the live transcript: asks for permission with
 * getUserMedia (the browser's own prompt) and reads the input level with a
 * Web Audio AnalyserNode for the waveform. Nothing is recorded or uploaded;
 * the audio never leaves this page. Captions come from transcriptSource.ts.
 */
export type MicErrorCode =
  "denied" | "no-device" | "insecure" | "in-use" | "other";

export interface MicError {
  code: MicErrorCode;
  /** Plain sentence for the person, with what to do next. */
  message: string;
}

export const MIC_ERROR_MESSAGES: Record<MicErrorCode, string> = {
  denied:
    "Microphone access is blocked for this site. To allow it, click the icon next to the address bar, open site settings and set Microphone to Allow, then press Resume.",
  "no-device": "No microphone found. Plug one in and press Resume.",
  insecure:
    "The microphone only works on a secure (https) page or on localhost.",
  "in-use":
    "Your microphone is busy in another app. Close that app and press Resume.",
  other: "The microphone didn't start. Press Resume to try again.",
};

class MicStartError extends Error {
  constructor(readonly code: MicErrorCode) {
    super(MIC_ERROR_MESSAGES[code]);
    this.name = "MicStartError";
  }
}

/** Maps a getUserMedia failure (a DOMException name) to a plain message. */
export const micErrorFor = (error: unknown): MicError => {
  if (error instanceof MicStartError)
    return { code: error.code, message: error.message };
  const name =
    error && typeof error === "object" && "name" in error
      ? String((error as { name: unknown }).name)
      : "";
  const code: MicErrorCode =
    name === "NotAllowedError" || name === "PermissionDeniedError"
      ? "denied"
      : name === "SecurityError"
        ? "insecure"
        : name === "NotFoundError" ||
            name === "DevicesNotFoundError" ||
            name === "OverconstrainedError"
          ? "no-device"
          : name === "NotReadableError" || name === "TrackStartError"
            ? "in-use"
            : "other";
  return { code, message: MIC_ERROR_MESSAGES[code] };
};

/** Can this page ask for the microphone at all? */
export const micAvailable = () =>
  typeof navigator !== "undefined" &&
  typeof navigator.mediaDevices?.getUserMedia === "function";

export interface MicLevel {
  /**
   * `count` levels from 0 to 1 across the voice range, for the waveform
   * bars. Reuses `out` when given.
   */
  bands(count: number, out?: number[]): number[];
  /** Stop every track (the browser's mic indicator turns off) and close audio. */
  close(): void;
}

/** The parts of AudioContext this file uses, so tests can fake them. */
interface AnalyserLike {
  fftSize: number;
  smoothingTimeConstant: number;
  readonly frequencyBinCount: number;
  getByteFrequencyData(array: Uint8Array<ArrayBuffer>): void;
}
interface AudioContextLike {
  createMediaStreamSource(stream: MediaStream): {
    connect(node: AnalyserLike): void;
    disconnect(): void;
  };
  createAnalyser(): AnalyserLike;
  close(): Promise<void>;
}

export interface MicDeps {
  getUserMedia?: (constraints: MediaStreamConstraints) => Promise<MediaStream>;
  createAudioContext?: () => AudioContextLike | null;
  isSecureContext?: boolean;
}

const defaultAudioContext = (): AudioContextLike | null => {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    AudioContext?: new () => AudioContextLike;
    webkitAudioContext?: new () => AudioContextLike;
  };
  const Ctor = w.AudioContext ?? w.webkitAudioContext;
  return Ctor ? new Ctor() : null;
};

/**
 * Asks for the microphone. Call it from a click: the browser shows its
 * permission prompt. Rejects with an error micErrorFor() understands.
 */
export const openMicLevel = async (deps: MicDeps = {}): Promise<MicLevel> => {
  const secure =
    deps.isSecureContext ??
    (typeof window === "undefined" ? true : window.isSecureContext);
  if (!secure) throw new MicStartError("insecure");
  const getUserMedia =
    deps.getUserMedia ??
    (micAvailable()
      ? (c: MediaStreamConstraints) => navigator.mediaDevices.getUserMedia(c)
      : null);
  if (!getUserMedia) throw new MicStartError("insecure");

  const stream = await getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true },
  });
  const stopTracks = () => stream.getTracks().forEach((track) => track.stop());

  let context: AudioContextLike | null = null;
  let analyser: AnalyserLike | null = null;
  let input: ReturnType<AudioContextLike["createMediaStreamSource"]> | null =
    null;
  try {
    context = (deps.createAudioContext ?? defaultAudioContext)();
    if (context) {
      analyser = context.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.7;
      input = context.createMediaStreamSource(stream);
      input.connect(analyser);
    }
  } catch {
    // No level meter, but the mic (and captions) still work.
    analyser = null;
  }
  const bins = analyser
    ? new Uint8Array(new ArrayBuffer(analyser.frequencyBinCount))
    : null;
  let closed = false;

  return {
    bands(count, out = new Array<number>(count).fill(0)) {
      if (!analyser || !bins || closed) return out.fill(0, 0, count);
      analyser.getByteFrequencyData(bins);
      // Voice sits in roughly the lowest third of the bins at fftSize 256.
      const usable = Math.max(count, Math.floor(bins.length / 3));
      const per = usable / count;
      for (let i = 0; i < count; i += 1) {
        let sum = 0;
        let n = 0;
        for (
          let b = Math.floor(i * per);
          b < Math.floor((i + 1) * per);
          b += 1
        ) {
          sum += bins[b] ?? 0;
          n += 1;
        }
        out[i] = n ? sum / n / 255 : 0;
      }
      return out;
    },
    close() {
      if (closed) return;
      closed = true;
      stopTracks();
      try {
        input?.disconnect();
      } catch {
        // already disconnected
      }
      void context?.close().catch(() => undefined);
    },
  };
};
