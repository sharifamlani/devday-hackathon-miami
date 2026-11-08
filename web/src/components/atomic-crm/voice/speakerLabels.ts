import { API_URL, DATA_MODE } from "../providers/local/config";
import type { TranscriptLine } from "./callNotes";
import type { CallRecording, RecordingSource } from "./geminiTranscriptSource";
import { firstName, type TranscriptSource } from "./transcriptSource";

/**
 * After the call: send the recording to POST /transcribe/file (Gemini with
 * speaker diarization) and replace the live "You" lines with labelled
 * you/them lines, so the pane's promise ("cleans up the transcript and labels
 * speakers") holds. Every failure keeps the live lines: no recording, no
 * service (snapshot mode), an error, an empty answer, or over LABEL_TIMEOUT_MS.
 *
 * The pane restarts the mic source after each pause, so a recording covers
 * only the stretch since the last resume: just those lines (the last
 * `recording.lines`) are replaced, and earlier lines stay as they were.
 */

export const LABEL_TIMEOUT_MS = 10_000;

export interface LabelResult {
  lines: TranscriptLine[];
  /** True when lines came from the speaker pass. */
  labeled: boolean;
  /** Why the live lines were kept, for the log. */
  reason?: string;
}

const isRecordingSource = (s: TranscriptSource | null): s is RecordingSource =>
  !!s && typeof (s as Partial<RecordingSource>).finishRecording === "function";

/**
 * Take the call recording from the running source. Call it before stopping the
 * source; null for sources that don't record (demo, browser recognizer).
 */
export const takeRecording = (source: TranscriptSource | null): Promise<CallRecording | null> | null =>
  isRecordingSource(source) ? source.finishRecording() : null;

/** Swap the stretch a recording covers for its labelled lines, on the pane's call clock. */
export const mergeLabeled = (live: TranscriptLine[], covered: number, labeled: TranscriptLine[]): TranscriptLine[] => {
  const keep = live.slice(0, Math.max(0, live.length - covered));
  const start = covered > 0 ? live[live.length - covered].at : (live.at(-1)?.at ?? 0);
  const shift = start - (labeled[0]?.at ?? 0);
  return [...keep, ...labeled.map((l) => ({ ...l, at: Math.max(0, Math.round(l.at + shift)) }))];
};

export interface LabelOptions {
  /** The donor on the call; their first name labels "them" lines ("Them" when unknown). */
  donorName: string | null;
  timeoutMs?: number;
  /** For tests. */
  fetchImpl?: typeof fetch;
  /** For tests: whether the service is there to ask. */
  local?: boolean;
}

export const labelSpeakers = async (
  recording: Promise<CallRecording | null> | null,
  liveLines: TranscriptLine[],
  { donorName, timeoutMs = LABEL_TIMEOUT_MS, fetchImpl = fetch, local = DATA_MODE === "local" }: LabelOptions,
): Promise<LabelResult> => {
  const keep = (reason: string): LabelResult => ({ lines: liveLines, labeled: false, reason });
  if (!recording || !local) return keep("no recording or no service");
  const abort = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<LabelResult>((resolve) => {
    timer = setTimeout(() => {
      abort.abort();
      resolve(keep(`speaker pass took over ${timeoutMs / 1000} s`));
    }, timeoutMs);
  });
  const pass = (async (): Promise<LabelResult> => {
    const rec = await recording;
    if (!rec || !rec.audio.size) return keep("empty recording");
    const form = new FormData();
    form.append("audio", rec.audio, rec.audio.type.includes("ogg") ? "call.ogg" : "call.webm");
    form.append("first_speaker", "you");
    form.append("you_name", "You");
    form.append("them_name", donorName ? firstName(donorName) : "Them");
    const response = await fetchImpl(`${API_URL}/transcribe/file`, { method: "POST", body: form, signal: abort.signal });
    if (!response.ok) return keep(`speaker pass HTTP ${response.status}`);
    const { segments } = (await response.json()) as { segments?: TranscriptLine[] };
    if (!segments?.length) return keep("speaker pass heard nothing");
    return { lines: mergeLabeled(liveLines, Math.min(rec.lines, liveLines.length), segments), labeled: true };
  })().catch((error: unknown) => keep(`speaker pass failed: ${String(error)}`));
  try {
    return await Promise.race([pass, timeout]);
  } finally {
    clearTimeout(timer);
  }
};
