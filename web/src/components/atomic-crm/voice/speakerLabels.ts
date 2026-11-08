import { API_URL, DATA_MODE } from "../providers/local/config";
import type { TranscriptLine } from "./callNotes";
import { takeCallRecordings, type CallRecording, type RecordingSource } from "./geminiTranscriptSource";
import { firstName, type TranscriptSource } from "./transcriptSource";

/**
 * After the call: send each recorded stretch to POST /transcribe/file (Gemini
 * with speaker diarization) and replace its live "You" lines with labelled
 * you/them lines, so the pane's promise ("cleans up the transcript and labels
 * speakers") holds.
 *
 * A call is one stretch per mic session: the pane's Pause stops the source and
 * Resume starts a new one, and each stopped source leaves its stretch on the
 * call tape (geminiTranscriptSource.ts). Stretches are matched to the
 * transcript from the end backwards by the exact text of the lines they
 * produced, so a stretch that doesn't line up (an abandoned call, a demo
 * stretch in between) labels nothing rather than the wrong lines.
 *
 * A stretch stopped mid-sentence was drained gracefully; finals that arrived
 * after the pane stopped listening travel as its `tail`. The labelled pass
 * covers them; where a stretch keeps its live lines, its tail is appended.
 *
 * Every failure keeps live lines, per stretch: no recording, no service
 * (snapshot mode), an error, an empty answer, or not back within
 * LABEL_TIMEOUT_MS (one budget for all stretches, sent in parallel).
 */

export const LABEL_TIMEOUT_MS = 10_000;

export interface LabelResult {
  lines: TranscriptLine[];
  /** True when at least one stretch was relabelled. */
  labeled: boolean;
  /** Stretches relabelled, out of those that matched the transcript. */
  stretches: { labeled: number; matched: number };
  /** Why live lines were kept, for the log. */
  reason?: string;
}

const isRecordingSource = (s: TranscriptSource | null): s is RecordingSource =>
  !!s && typeof (s as Partial<RecordingSource>).finishRecording === "function";

/**
 * Take every stretch of the call: the running source's (if it records) plus
 * those left by sources a pause already stopped. Call it before stopping the
 * source. Empties the tape.
 */
export const takeRecording = (source: TranscriptSource | null): Promise<CallRecording[]> => {
  if (isRecordingSource(source)) void source.finishRecording();
  return takeCallRecordings();
};

/** Which live lines each stretch covers: [start, end) ranges, matched from the end by text. */
export const matchStretches = (
  live: TranscriptLine[],
  stretches: CallRecording[],
): { stretch: CallRecording; start: number; end: number }[] => {
  const matched: { stretch: CallRecording; start: number; end: number }[] = [];
  let end = live.length;
  for (let i = stretches.length - 1; i >= 0; i -= 1) {
    const { texts } = stretches[i];
    if (!texts.length) continue; // heard nothing that became a line: nothing to relabel
    const start = end - texts.length;
    if (start < 0 || texts.some((t, k) => live[start + k].text !== t)) break; // earlier stretches don't line up either
    matched.unshift({ stretch: stretches[i], start, end });
    end = start;
  }
  return matched;
};

/** A stretch's live lines plus the finals drained after the pane stopped listening. */
const withTail = (live: TranscriptLine[], stretch: CallRecording): TranscriptLine[] => {
  const at = live.at(-1)?.at ?? 0;
  return [...live, ...(stretch.tail ?? []).map((text) => ({ speaker: "you" as const, name: "You", text, at }))];
};

/** Labelled lines for one stretch, moved onto the pane's call clock at `startAt`. */
const onPaneClock = (labeled: TranscriptLine[], startAt: number): TranscriptLine[] => {
  const shift = startAt - (labeled[0]?.at ?? 0);
  return labeled.map((l) => ({ ...l, at: Math.max(0, Math.round(l.at + shift)) }));
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
  recordings: Promise<CallRecording[]> | null,
  liveLines: TranscriptLine[],
  { donorName, timeoutMs = LABEL_TIMEOUT_MS, fetchImpl = fetch, local = DATA_MODE === "local" }: LabelOptions,
): Promise<LabelResult> => {
  const keep = (reason: string, matched = 0): LabelResult =>
    ({ lines: liveLines, labeled: false, stretches: { labeled: 0, matched }, reason });
  if (!recordings || !local) return keep("no recording or no service");
  const abort = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => {
      abort.abort();
      resolve("timeout");
    }, timeoutMs);
  });

  const labelOne = async (rec: CallRecording): Promise<TranscriptLine[] | null> => {
    if (!rec.audio.size) return null;
    const form = new FormData();
    form.append("audio", rec.audio, rec.audio.type.includes("ogg") ? "call.ogg" : "call.webm");
    form.append("first_speaker", "you");
    form.append("you_name", "You");
    form.append("them_name", donorName ? firstName(donorName) : "Them");
    const response = await fetchImpl(`${API_URL}/transcribe/file`, { method: "POST", body: form, signal: abort.signal });
    if (!response.ok) return null;
    const { segments } = (await response.json()) as { segments?: TranscriptLine[] };
    return segments?.length ? segments : null;
  };

  try {
    const stretches = await Promise.race([recordings, timedOut]);
    if (stretches === "timeout") return keep(`recording not ready within ${timeoutMs / 1000} s`);
    const matched = matchStretches(liveLines, stretches);
    if (!matched.length) return keep(stretches.length ? "recording doesn't match the transcript" : "no recording");
    // Each stretch's answer lands here as it arrives; a timeout keeps whatever came back.
    const results: (TranscriptLine[] | null)[] = matched.map(() => null);
    const all = Promise.all(
      matched.map((m, i) => labelOne(m.stretch).then((r) => (results[i] = r), () => null)),
    );
    const outcome = await Promise.race([all.then(() => "done" as const), timedOut]);

    const lines: TranscriptLine[] = [];
    let at = 0;
    matched.forEach((m, i) => {
      lines.push(...liveLines.slice(at, m.start));
      const labeled = results[i];
      lines.push(...(labeled ? onPaneClock(labeled, liveLines[m.start].at) : withTail(liveLines.slice(m.start, m.end), m.stretch)));
      at = m.end;
    });
    lines.push(...liveLines.slice(at));
    const done = results.filter(Boolean).length;
    if (!done) {
      const reason = outcome === "timeout" ? `speaker pass took over ${timeoutMs / 1000} s` : "speaker pass failed";
      return { lines, labeled: false, stretches: { labeled: 0, matched: matched.length }, reason };
    }
    return {
      lines,
      labeled: true,
      stretches: { labeled: done, matched: matched.length },
      reason: done < matched.length ? `${matched.length - done} stretch(es) kept live lines` : undefined,
    };
  } finally {
    clearTimeout(timer);
  }
};
