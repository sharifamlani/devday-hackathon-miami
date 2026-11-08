import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  saveCallNote,
  type CallNote,
  type NoteDestination,
  type TranscriptLine,
} from "../../voice/callNotes";
import { DATA_MODE, type DataMode } from "./config";
import { request } from "./httpClient";

/**
 * Call notes from the live transcript pane, wired to the Python service
 * (service/routes_calls.py) in local mode:
 *
 *   POST /calls/summarize  summary + next steps (the model with a key, else rules)
 *   POST /calls            save one note (upsert by id)
 *   GET  /calls            saved notes, newest first (?donor_id=&project_id=)
 *
 * In snapshot mode (Vercel) nothing is sent: the summary comes from the
 * caller's own fallback and notes stay in this browser (voice/callNotes.ts).
 */

// ---------------------------------------------------------------------------
// API shapes (snake_case, as the service sends them)
// ---------------------------------------------------------------------------

export interface ApiCallNote {
  id: string;
  title: string;
  created_at: string;
  duration_sec: number;
  destinations: NoteDestination[];
  transcript: TranscriptLine[];
  notes: string;
  summary: string[];
  next_steps: string[];
  saved_at?: string;
}

export interface ApiCallSummary {
  summary: string[];
  next_steps: string[];
  source: "model" | "rules";
  detail?: string | null;
}

export type SummarySource = "model" | "rules";

export interface CallSummary {
  summary: string[];
  nextSteps: string[];
  source: SummarySource;
  /** Why the rules answered (no key, timeout, offline), when they did. */
  detail?: string | null;
}

export interface SummarizeCallInput {
  title: string;
  transcript: TranscriptLine[];
  notes: string;
  donorId?: number | string | null;
  /** The browser's own summary, used in snapshot mode or when the API can't answer. */
  fallback: () => { summary: string[]; nextSteps: string[] };
}

export interface CallNotesFilter {
  donorId?: number | string | null;
  projectId?: string | null;
}

export interface SavedCallNote {
  note: CallNote;
  /** "server" when the service saved it too; "browser" when only this browser has it. */
  savedTo: "server" | "browser";
  /** Why the server save didn't happen, in local mode. */
  error?: string;
}

// ---------------------------------------------------------------------------
// Mapping
// ---------------------------------------------------------------------------

const strings = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((s): s is string => typeof s === "string")
    : [];

export const toCallNote = (api: ApiCallNote): CallNote => ({
  id: api.id,
  title: api.title,
  createdAt: api.created_at,
  durationSec: api.duration_sec ?? 0,
  destinations: (api.destinations ?? []).map((d) => ({
    kind: d.kind,
    id: String(d.id),
    label: d.label ?? "",
  })),
  transcript: api.transcript ?? [],
  notes: api.notes ?? "",
  summary: strings(api.summary),
  nextSteps: strings(api.next_steps),
});

export const toApiCallNote = (
  note: CallNote,
): Omit<ApiCallNote, "saved_at"> => ({
  id: note.id,
  title: note.title.trim() || "Untitled call",
  created_at: note.createdAt,
  duration_sec: Math.max(0, Math.round(note.durationSec)),
  destinations: note.destinations,
  transcript: note.transcript,
  notes: note.notes,
  summary: note.summary,
  next_steps: note.nextSteps,
});

const donorIdOf = (id: number | string | null | undefined): number | null => {
  if (id == null || id === "") return null;
  const n = Number(id);
  return Number.isInteger(n) ? n : null;
};

const reason = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

// ---------------------------------------------------------------------------
// Calls (mode passed in so tests can pick it; the hooks use DATA_MODE)
// ---------------------------------------------------------------------------

export const summarizeCall = async (
  input: SummarizeCallInput,
  mode: DataMode = DATA_MODE,
): Promise<CallSummary> => {
  const fallback = (detail: string): CallSummary => ({
    ...input.fallback(),
    source: "rules",
    detail,
  });
  if (mode !== "local") return fallback("Summarized in this browser.");
  try {
    const body = await request<ApiCallSummary>("/calls/summarize", {
      method: "POST",
      body: {
        title: input.title,
        transcript: input.transcript,
        notes: input.notes,
        donor_id: donorIdOf(input.donorId),
      },
    });
    return {
      summary: strings(body.summary),
      nextSteps: strings(body.next_steps),
      source: body.source === "model" ? "model" : "rules",
      detail: body.detail ?? null,
    };
  } catch (error) {
    // Offline, an API build without /calls, or an error: the browser summary still works.
    return fallback(
      `The service couldn't summarize this call (${reason(error)}).`,
    );
  }
};

export const saveCallNoteEverywhere = async (
  note: CallNote,
  mode: DataMode = DATA_MODE,
): Promise<SavedCallNote> => {
  if (mode !== "local") {
    saveCallNote(note);
    return { note, savedTo: "browser" };
  }
  try {
    const saved = toCallNote(
      await request<ApiCallNote>("/calls", {
        method: "POST",
        body: toApiCallNote(note),
      }),
    );
    saveCallNote(saved);
    return { note: saved, savedTo: "server" };
  } catch (error) {
    // Never lose a note: keep it in this browser and say the server didn't get it.
    saveCallNote(note);
    return { note, savedTo: "browser", error: reason(error) };
  }
};

export const callNotesPath = (filter?: CallNotesFilter): string => {
  const params = new URLSearchParams();
  const donorId = donorIdOf(filter?.donorId);
  if (donorId != null) params.set("donor_id", String(donorId));
  if (filter?.projectId) params.set("project_id", filter.projectId);
  const query = params.toString();
  return query ? `/calls?${query}` : "/calls";
};

export const listServerCallNotes = async (
  filter?: CallNotesFilter,
): Promise<CallNote[]> =>
  (await request<ApiCallNote[]>(callNotesPath(filter))).map(toCallNote);

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

export const callKeys = {
  all: ["donor-desk", "calls"] as const,
  list: (filter?: CallNotesFilter) =>
    ["donor-desk", "calls", callNotesPath(filter)] as const,
};

/** Summary + next steps: the service in local mode, else the caller's fallback. */
export const useSummarizeCall = () =>
  useMutation({
    mutationFn: (input: SummarizeCallInput) => summarizeCall(input),
  });

/** Save a note to the service (local mode) and to this browser's list, then refetch donors. */
export const useSaveCallNote = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (note: CallNote) => saveCallNoteEverywhere(note),
    onSuccess: () => {
      // GET /donors/{id} lists recent call notes; hooks.ts donorDeskKeys.donor(id) starts with this prefix.
      queryClient.invalidateQueries({ queryKey: ["donor-desk", "donor"] });
      queryClient.invalidateQueries({ queryKey: callKeys.all });
    },
  });
};

/** Notes saved on the service (local mode only; disabled on the snapshot). */
export const useServerCallNotes = (filter?: CallNotesFilter) =>
  useQuery({
    queryKey: callKeys.list(filter),
    queryFn: () => listServerCallNotes(filter),
    enabled: DATA_MODE === "local",
  });
