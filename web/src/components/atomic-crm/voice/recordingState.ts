import { useSyncExternalStore } from "react";

/**
 * "A live transcript is streaming right now", shared by the header's
 * live-transcript button (red dot) and voice/LiveTranscriptPane.
 */
let recording = false;
const listeners = new Set<() => void>();

const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
};

const getSnapshot = () => recording;

export const useRecording = (): boolean =>
  useSyncExternalStore(subscribe, getSnapshot, () => false);

export const setRecording = (on: boolean) => {
  if (recording === on) return;
  recording = on;
  listeners.forEach((fn) => fn());
};
