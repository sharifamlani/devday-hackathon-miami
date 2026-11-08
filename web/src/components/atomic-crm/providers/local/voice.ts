import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { call } from "./endpoint";

/*
 * plan.md §21.5: file transcription (Agent Phone, B3), after-call actions +
 * pledges (90b, B6). Call notes are NOT here: Christian's calls.ts (#78)
 * owns saving and listing them (POST/GET /calls).
 */

export interface TranscriptSegment {
  speaker: string; // "staff" | "contact" | a label
  text: string;
  start: number; // seconds
  end: number;
}

export interface AfterCallAction {
  id: string;
  type: "create_task" | "rsvp_event" | "record_pledge" | "add_context_note" | "tag_interest" | (string & {});
  label: string;
  payload: Record<string, unknown>;
  /** The span of the transcript the action rests on. */
  evidence?: string;
}

/** service/after_call_agent.propose: nothing is written until apply. */
export interface AfterCallProposal {
  steps: string[];
  actions: AfterCallAction[];
  dropped?: { type: string; label: string; why: string }[];
  person?: { id: number; full_name: string | null; first_name: string | null } | null;
  drafted_by?: string;
}

export interface AfterCallResult {
  applied: { id: string; type: string; ref: string | number | null }[];
  skipped: { id: string; why: string; ref?: string | number | null }[];
}

export interface Pledge {
  amount: number;
  expected_by: string | null;
  status: string; // "open" | "fulfilled" | ...
}

export const voiceKeys = {
  pledges: (personId: number) => ["donor-desk", "pledges", personId] as const,
};

/* ---------- API ---------- */

/** Upload a recording; returns speaker-labelled segments. */
export const transcribeFile = (file: File) => {
  const form = new FormData();
  form.append("file", file, file.name);
  return call<{ segments: TranscriptSegment[] }>("File transcription", "POST", "/transcribe/file", {
    body: form,
  });
};

// Call note ids are text (routes_calls.py, #78).
export const proposeAfterCall = (callNoteId: string) =>
  call<AfterCallProposal>("After-call actions", "POST", `/call-notes/${callNoteId}/actions`);

export const applyAfterCall = (callNoteId: string, actionIds: string[]) =>
  call<AfterCallResult>(
    "Applying after-call actions",
    "POST",
    `/call-notes/${callNoteId}/apply`,
    { body: { action_ids: actionIds } },
  );

export const getPledges = (personId: number) =>
  call<Pledge[]>("Pledges", "GET", `/people/${personId}/pledges`, { snapshotValue: [] });

/* ---------- Hooks ---------- */

export const useTranscribeFile = () => useMutation({ mutationFn: transcribeFile });

/** The after-call card: propose, then apply the ticked actions. */
export const useAfterCall = () => {
  const queryClient = useQueryClient();
  const propose = useMutation({ mutationFn: proposeAfterCall });
  const apply = useMutation({
    mutationFn: ({ callNoteId, actionIds }: { callNoteId: string; actionIds: string[] }) =>
      applyAfterCall(callNoteId, actionIds),
    // Actions create tasks, RSVPs, pledges, notes and tags: refetch everything.
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["donor-desk"] }),
  });
  return { propose, apply };
};

export const usePledges = (personId: number | null) =>
  useQuery({
    queryKey: voiceKeys.pledges(personId ?? -1),
    queryFn: () => getPledges(personId as number),
    enabled: personId != null,
  });
