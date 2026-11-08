import { useSyncExternalStore } from "react";

/**
 * Saved call notes from the live transcript pane (voice/LiveTranscriptPane).
 * Kept in this browser (localStorage) so the demo works on the static Vercel
 * snapshot; the home page lists them under Artifacts and the Ask pane can
 * read them as context. No server write in this version.
 */
export type NoteDestinationKind = "donor" | "group" | "project";

export interface NoteDestination {
  kind: NoteDestinationKind;
  /** Donor id, donor-list id or campaign id, as a string. */
  id: string;
  label: string;
}

export interface TranscriptLine {
  speaker: "you" | "them";
  name: string;
  text: string;
  /** Seconds from the start of the call. */
  at: number;
}

export interface CallNote {
  id: string;
  title: string;
  createdAt: string; // ISO timestamp
  durationSec: number;
  destinations: NoteDestination[];
  transcript: TranscriptLine[];
  notes: string;
  summary: string[];
  nextSteps: string[];
}

const KEY = "donor-desk.call-notes.v1";
const listeners = new Set<() => void>();
let cache: CallNote[] | null = null;

const read = (): CallNote[] => {
  if (cache) return cache;
  try {
    const raw = window.localStorage.getItem(KEY);
    cache = raw ? (JSON.parse(raw) as CallNote[]) : [];
  } catch {
    cache = [];
  }
  return cache;
};

const write = (notes: CallNote[]) => {
  cache = notes;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(notes));
  } catch {
    // private mode or full storage: keep the in-memory copy
  }
  listeners.forEach((fn) => fn());
};

const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

/** Newest first. */
export const useCallNotes = (): CallNote[] =>
  useSyncExternalStore(subscribe, read, () => []);

export const saveCallNote = (note: CallNote) =>
  write([note, ...read().filter((n) => n.id !== note.id)]);

export const deleteCallNote = (id: string) =>
  write(read().filter((n) => n.id !== id));

/** For tests. */
export const __resetCallNotesForTests = () => {
  cache = null;
  listeners.clear();
};
