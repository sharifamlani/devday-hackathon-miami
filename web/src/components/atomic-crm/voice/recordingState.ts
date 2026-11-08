import { useSyncExternalStore } from "react";

/**
 * Is a live call transcript recording right now? A tiny module-level store so
 * the header's live-transcript button can show its red dot while the
 * transcript pane (voice/LiveTranscriptPane) owns the recording. The pane
 * calls setRecording; anything can read it with useRecording.
 */
let recording = false;
const listeners = new Set<() => void>();

export const getRecording = () => recording;

export const setRecording = (on: boolean) => {
  if (recording === on) return;
  recording = on;
  listeners.forEach((listener) => listener());
};

export const subscribeRecording = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

/** True while a call is being recorded; re-renders when that changes. */
export const useRecording = (): boolean =>
  useSyncExternalStore(subscribeRecording, getRecording, () => false);
