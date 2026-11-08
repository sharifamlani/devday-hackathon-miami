import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Loader2, Phone, PhoneOff } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { donorDeskKeys } from "../providers/local/hooks";
import {
  applyCallActions,
  hangUpPhoneCall,
  isActive,
  phoneKeys,
  previewPhoneCall,
  retryPhoneCall,
  startPhoneCall,
  statusLabel,
  usePhoneCall,
  type PhoneCall,
} from "../providers/local/phone";

const clock = (sec: number) =>
  `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, "0")}`;

const errorText = (error: unknown) => {
  const body = (error as { body?: { detail?: unknown } } | null)?.body;
  return typeof body?.detail === "string"
    ? body.detail
    : error instanceof Error
      ? error.message
      : "Something went wrong.";
};

/** Seconds since the call connected, ticking once a second while it is live. */
const useElapsed = (call: PhoneCall | undefined) => {
  const [now, setNow] = useState(() => Date.now());
  const live = call?.status === "connected";
  useEffect(() => {
    if (!live) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [live]);
  if (!call?.connected_at) return 0;
  const end = live ? now : Date.parse(call.ended_at ?? "") || now;
  return Math.max(0, (end - Date.parse(call.connected_at)) / 1000);
};

/**
 * "Call from my phone": the staff member's phone rings first; once they
 * answer, the donor's phone rings showing the staff member's number. The call
 * is recorded after a spoken notice, then transcribed, summarized and saved
 * as a call note on this donor, with follow-ups to apply.
 */
export const PhoneCallDialog = ({
  donorId,
  open,
  onOpenChange,
}: {
  donorId: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) => {
  const queryClient = useQueryClient();
  const [callId, setCallId] = useState<string | null>(null);
  const [applied, setApplied] = useState<string[]>([]);

  const preview = useQuery({
    queryKey: phoneKeys.preview(donorId),
    queryFn: () => previewPhoneCall(donorId),
    enabled: open && callId === null,
    staleTime: 0,
  });
  const { data: call } = usePhoneCall(callId);
  const elapsed = useElapsed(call);

  const start = useMutation({
    mutationFn: () => startPhoneCall(donorId),
    onSuccess: (started) => setCallId(started.id),
  });
  const hangUp = useMutation({ mutationFn: () => hangUpPhoneCall(callId as string) });
  // Try again: the call was recorded but its transcript failed; the service resumes from the kept recording
  const retry = useMutation({
    mutationFn: () => retryPhoneCall(callId as string),
    onSuccess: (row) => queryClient.setQueryData(phoneKeys.call(row.id), row),
  });
  const apply = useMutation({
    mutationFn: (actionId: string) => applyCallActions(call?.note_id as string, [actionId]),
    onSuccess: (_, actionId) => {
      setApplied((ids) => [...ids, actionId]);
      void queryClient.invalidateQueries({ queryKey: donorDeskKeys.all });
    },
  });

  // The saved note shows on the donor's record as soon as the call is done
  const done = call?.status === "done";
  useEffect(() => {
    if (done) void queryClient.invalidateQueries({ queryKey: donorDeskKeys.donor(donorId) });
  }, [done, donorId, queryClient]);

  const close = (next: boolean) => {
    if (next) return onOpenChange(true);
    onOpenChange(false);
    if (!isActive(call?.status)) {
      setCallId(null);
      setApplied([]);
      start.reset();
    }
  };

  const name = call?.donor_name ?? preview.data?.donor_name ?? "this donor";
  const actions = call?.result.actions ?? [];

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="sm:max-w-md" aria-describedby="phone-call-description">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Phone aria-hidden className="size-4" />
            Call {name}
          </DialogTitle>
          <DialogDescription id="phone-call-description">
            {call
              ? "From your own phone, recorded and saved to the call notes."
              : preview.data?.ready
                ? `Your phone (${preview.data.staff_phone}) rings first. When you pick up, ${name} (${preview.data.donor_phone}) is called and sees your number.`
                : "Rings your phone first, then the donor's."}
          </DialogDescription>
        </DialogHeader>

        {!call && (
          <div className="space-y-3 text-sm">
            {preview.isPending && (
              <p className="flex items-center gap-2 text-muted-foreground">
                <Loader2 aria-hidden className="size-4 animate-spin" /> Checking the phone setup…
              </p>
            )}
            {preview.error && <p role="alert" className="text-destructive">{errorText(preview.error)}</p>}
            {preview.data && !preview.data.ready && (
              <p role="alert" className="rounded-lg bg-muted p-3">✕ {preview.data.reason}</p>
            )}
            {preview.data?.ready && (
              <p className="rounded-lg bg-muted p-3 text-xs">
                ⓘ {name} hears “{preview.data.notice}” before the call connects.
              </p>
            )}
            {start.error && <p role="alert" className="text-destructive">✕ {errorText(start.error)}</p>}
          </div>
        )}

        {call && call.status !== "done" && (
          <div className="space-y-3 text-sm" aria-live="polite">
            <p className={call.status === "failed" ? "rounded-lg bg-muted p-3" : "flex items-center gap-2"}>
              {call.status === "failed" ? (
                "✕ "
              ) : call.status === "connected" ? (
                <span aria-hidden className="size-2.5 rounded-full bg-red-500" />
              ) : (
                <Loader2 aria-hidden className="size-4 animate-spin" />
              )}
              {statusLabel(call)}
              {call.status === "connected" && <span className="tabular-nums"> · {clock(elapsed)}</span>}
            </p>
            {retry.error && <p role="alert" className="text-destructive">{errorText(retry.error)}</p>}
          </div>
        )}

        {done && call && (
          <div className="space-y-3 text-sm" aria-live="polite">
            <p className="text-xs text-muted-foreground">
              <Check aria-hidden className="inline size-3.5" /> {statusLabel(call)}
              {call.duration_sec > 0 && ` · ${clock(call.duration_sec)}`}
            </p>
            {(call.result.summary ?? []).length > 0 && (
              <div>
                <h3 className="font-medium">Summary</h3>
                <ul className="mt-1 list-disc space-y-0.5 pl-5">
                  {call.result.summary?.map((line, i) => <li key={i}>{line}</li>)}
                </ul>
              </div>
            )}
            {actions.length > 0 && (
              <div>
                <h3 className="font-medium">Suggested follow-ups</h3>
                <ul className="mt-1 space-y-1.5">
                  {actions.map((action) => {
                    const isApplied = applied.includes(action.id);
                    return (
                      <li key={action.id} className="flex items-start justify-between gap-3">
                        <span>{action.label}</span>
                        <Button
                          size="sm"
                          variant={isApplied ? "ghost" : "outline"}
                          disabled={isApplied || apply.isPending}
                          onClick={() => apply.mutate(action.id)}
                        >
                          {isApplied ? "Applied" : "Apply"}
                        </Button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
            {call.result.actions_detail && (
              <p className="text-xs text-muted-foreground">{call.result.actions_detail}</p>
            )}
            {apply.error && <p role="alert" className="text-destructive">{errorText(apply.error)}</p>}
          </div>
        )}

        <DialogFooter>
          {!call && (
            <>
              <Button variant="outline" onClick={() => close(false)}>
                Cancel
              </Button>
              <Button
                disabled={!preview.data?.ready || start.isPending}
                onClick={() => start.mutate()}
              >
                <Phone aria-hidden />
                {start.isPending ? "Calling…" : "Call"}
              </Button>
            </>
          )}
          {call && ["calling_you", "calling_donor", "connected"].includes(call.status) && (
            <Button variant="destructive" disabled={hangUp.isPending} onClick={() => hangUp.mutate()}>
              <PhoneOff aria-hidden />
              Hang up
            </Button>
          )}
          {call && !isActive(call.status) && (
            <Button variant="outline" onClick={() => close(false)}>
              Close
            </Button>
          )}
          {call?.status === "failed" && call.result.retryable && (
            <Button disabled={retry.isPending} onClick={() => retry.mutate()}>
              {retry.isPending ? "Starting…" : "Try again"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
