import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { call } from "./endpoint";

/* plan.md §21.5: call notes + file transcription (Agent Phone, B3), after-call actions + pledges (90b, B6). */

export interface TranscriptSegment {
  speaker: string; // "staff" | "contact" | a label
  text: string;
  start: number; // seconds
  end: number;
}

export interface CallNoteInput {
  title: string;
  folder: string;
  transcript: string;
  segments: TranscriptSegment[];
  staff_name: string;
  contact_name: string;
  duration_s: number;
}

export interface CallNote {
  id: number;
  summary: string | null;
  created_at: string;
  // The list endpoint may echo the saved fields too.
  title?: string;
  folder?: string;
  duration_s?: number;
}

export interface AfterCallAction {
  id: string | number;
  type: "create_task" | "rsvp_event" | "record_pledge" | "add_context_note" | "tag_interest" | (string & {});
  label: string;
  payload: Record<string, unknown>;
}

export interface AfterCallProposal {
  steps: string[];
  actions: AfterCallAction[];
}

export interface Pledge {
  amount: number;
  expected_by: string | null;
  status: string; // "open" | "fulfilled" | ...
}

export const voiceKeys = {
  callNotes: (personId: number) => ["donor-desk", "call-notes", personId] as const,
  pledges: (personId: number) => ["donor-desk", "pledges", personId] as const,
};

/* ---------- API ---------- */

export const saveCallNote = (personId: number, input: CallNoteInput) =>
  call<CallNote>("Saving the call note", "POST", `/people/${personId}/call-notes`, { body: input });

export const getCallNotes = (personId: number) =>
  call<CallNote[]>("Call notes", "GET", `/people/${personId}/call-notes`, { snapshotValue: [] });

/** Upload a recording; returns speaker-labelled segments. */
export const transcribeFile = (file: File) => {
  const form = new FormData();
  form.append("file", file, file.name);
  return call<{ segments: TranscriptSegment[] }>("File transcription", "POST", "/transcribe/file", {
    body: form,
  });
};

export const proposeAfterCall = (callNoteId: number) =>
  call<AfterCallProposal>("After-call actions", "POST", `/call-notes/${callNoteId}/actions`);

export const applyAfterCall = (callNoteId: number, actionIds: (string | number)[]) =>
  call<{ applied: { id: string | number; type: string; ref: string | number | null }[] }>(
    "Applying after-call actions",
    "POST",
    `/call-notes/${callNoteId}/apply`,
    { body: { action_ids: actionIds } },
  );

export const getPledges = (personId: number) =>
  call<Pledge[]>("Pledges", "GET", `/people/${personId}/pledges`, { snapshotValue: [] });

/* ---------- Hooks ---------- */

export const useCallNotes = (personId: number | null) =>
  useQuery({
    queryKey: voiceKeys.callNotes(personId ?? -1),
    queryFn: () => getCallNotes(personId as number),
    enabled: personId != null,
  });

export const useSaveCallNote = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ personId, ...input }: CallNoteInput & { personId: number }) => saveCallNote(personId, input),
    onSuccess: (_note, { personId }) =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: voiceKeys.callNotes(personId) }),
        queryClient.invalidateQueries({ queryKey: ["donor-desk", "artifacts"] }),
        queryClient.invalidateQueries({ queryKey: ["donor-desk", "home-summary"] }),
      ]),
  });
};

export const useTranscribeFile = () => useMutation({ mutationFn: transcribeFile });

/** The after-call card: propose, then apply the ticked actions. */
export const useAfterCall = () => {
  const queryClient = useQueryClient();
  const propose = useMutation({ mutationFn: proposeAfterCall });
  const apply = useMutation({
    mutationFn: ({ callNoteId, actionIds }: { callNoteId: number; actionIds: (string | number)[] }) =>
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
