import { useQuery } from "@tanstack/react-query";

import { request } from "./httpClient";

/**
 * Calling a donor from the staff member's own phone (service/routes_phone.py).
 * Local mode only: the Vercel snapshot has no service to place calls.
 *
 *   GET  /phone/preview?donor_id=   is everything in place? (numbers masked)
 *   POST /phone/calls               ring the staff phone, then the donor
 *   GET  /phone/calls/{id}          status while the call runs and is processed
 *   POST /phone/calls/{id}/hangup   end both legs
 *   POST /phone/calls/{id}/retry    Try again: finish a recorded call whose transcript failed
 *   POST /call-notes/{id}/apply     apply suggested follow-ups (after_call_agent)
 */

export type PhoneStatus =
  | "calling_you"
  | "calling_donor"
  | "connected"
  | "processing"
  | "done"
  | "failed";

export interface PhonePreview {
  ready: boolean;
  reason: string | null;
  donor_id: number;
  donor_name: string;
  donor_phone: string | null;
  staff_phone: string | null;
  notice: string;
}

export interface PhoneAction {
  id: string;
  type: string;
  label: string;
  evidence?: string | null;
}

export interface PhoneCall {
  id: string;
  donor_id: number;
  donor_name: string;
  status: PhoneStatus;
  detail: string | null;
  note_id: string | null;
  duration_sec: number;
  started_at: string;
  connected_at: string | null;
  ended_at: string | null;
  result: {
    summary?: string[];
    next_steps?: string[];
    summary_source?: string;
    steps?: string[];
    actions?: PhoneAction[];
    actions_detail?: string | null;
    /** Set when the call was recorded but its transcript failed: the recording is kept for Try again. */
    retryable?: boolean;
  };
}

export const ACTIVE_STATUSES: PhoneStatus[] = [
  "calling_you",
  "calling_donor",
  "connected",
  "processing",
];

export const isActive = (status: PhoneStatus | undefined) =>
  status !== undefined && ACTIVE_STATUSES.includes(status);

/** What the dialog says for each status. */
export const statusLabel = (call: Pick<PhoneCall, "status" | "detail" | "donor_name">): string => {
  switch (call.status) {
    case "calling_you":
      return "Ringing your phone…";
    case "calling_donor":
      return `Calling ${call.donor_name}…`;
    case "connected":
      return "Connected · recording";
    case "processing":
      return `${call.detail ?? "Processing"}…`;
    case "done":
      return "Saved to the call notes";
    case "failed":
      return call.detail ?? "The call didn't go through.";
  }
};

export const previewPhoneCall = (donorId: number) =>
  request<PhonePreview>(`/phone/preview?donor_id=${donorId}`);

export const startPhoneCall = (donorId: number) =>
  request<PhoneCall>("/phone/calls", { method: "POST", body: { donor_id: donorId } });

export const getPhoneCall = (callId: string) =>
  request<PhoneCall>(`/phone/calls/${encodeURIComponent(callId)}`);

export const hangUpPhoneCall = (callId: string) =>
  request<PhoneCall>(`/phone/calls/${encodeURIComponent(callId)}/hangup`, { method: "POST" });

export const retryPhoneCall = (callId: string) =>
  request<PhoneCall>(`/phone/calls/${encodeURIComponent(callId)}/retry`, { method: "POST" });

export const applyCallActions = (noteId: string, actionIds: string[]) =>
  request<{ applied: unknown[]; skipped: unknown[] }>(
    `/call-notes/${encodeURIComponent(noteId)}/apply`,
    { method: "POST", body: { action_ids: actionIds } },
  );

export const phoneKeys = {
  preview: (donorId: number) => ["donor-desk", "phone", "preview", donorId] as const,
  call: (callId: string) => ["donor-desk", "phone", "call", callId] as const,
};

/** Polls a call every 1.5 s until it is done or failed. */
export const usePhoneCall = (callId: string | null) =>
  useQuery({
    queryKey: phoneKeys.call(callId ?? ""),
    queryFn: () => getPhoneCall(callId as string),
    enabled: callId !== null,
    refetchInterval: (query) => (isActive(query.state.data?.status) ? 1500 : false),
  });
