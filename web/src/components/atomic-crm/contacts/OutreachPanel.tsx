import { useEffect, useState } from "react";
import { Check, Mail, PenLine, Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { DATA_MODE } from "../providers/local/config";
import { useApproveDraft, useDraftOutreach } from "../providers/local/hooks";
import type { DonorDetail } from "../providers/local/types";
import { formatDay } from "./donorFormat";
import { SourceLink } from "./ResearchPanel";
import { PanelHeading } from "./ScoreWhyPanel";

/**
 * DRAFT: the outreach agent's email, the facts it used, and the human gate.
 * Nothing is ever sent from here without a click on Approve; for ★ donors
 * that is the only path (no automated send).
 */
export const OutreachPanel = ({ donor }: { donor: DonorDetail }) => {
  const draftOutreach = useDraftOutreach(donor.id);
  const approve = useApproveDraft();
  const draft = donor.draft;
  const [isEditing, setIsEditing] = useState(false);
  const [body, setBody] = useState(draft?.body ?? "");

  useEffect(() => {
    setBody(draft?.body ?? "");
    setIsEditing(false);
  }, [draft?.id, draft?.body]);

  const isApproved = draft?.status === "approved" || draft?.status === "sent";

  return (
    <section
      aria-label="Draft"
      className="space-y-3 rounded-[22px] bg-surface p-5"
    >
      <PanelHeading
        title="Draft"
        caption="Written in your organization's voice"
      >
        {!draft && (
          <Button
            size="sm"
            className="rounded-full bg-brand px-4 font-semibold text-brand-foreground hover:bg-brand/85 focus-visible:outline-2 focus-visible:outline-ring"
            onClick={() => draftOutreach.mutate()}
            disabled={draftOutreach.isPending}
          >
            {draftOutreach.isPending ? <Spinner /> : <Sparkles />}
            {draftOutreach.isPending ? "Drafting…" : "Draft email"}
          </Button>
        )}
      </PanelHeading>

      <SendPolicy isStar={donor.is_star} />
      {draft && donor.is_sample && (
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <SampleHistoryBadge />
          This draft cites an invented sample gift history.
        </p>
      )}

      {draft ? (
        <div className="space-y-3">
          <div className="space-y-2 rounded-[20px] rounded-br-md bg-brand-soft p-4 text-brand-soft-foreground">
            <p className="text-[11px] font-bold uppercase tracking-[0.12em]">
              Draft
            </p>
            {draft.subject && (
              <p className="text-sm">
                <span>Subject: </span>
                <span className="font-bold">{draft.subject}</span>
              </p>
            )}
            {isEditing ? (
              <Textarea
                aria-label="Draft body"
                value={body}
                onChange={(event) => setBody(event.target.value)}
                className="min-h-56 rounded-[14px] border-border bg-card text-sm text-foreground focus-visible:outline-2 focus-visible:outline-ring dark:bg-card"
              />
            ) : (
              <p className="whitespace-pre-line text-sm leading-relaxed text-foreground">
                {body}
              </p>
            )}
          </div>
          {draft.facts_used.length > 0 && (
            <div className="rounded-[18px] bg-card p-3.5 text-xs">
              <p className="text-muted-foreground">↳ facts used:</p>
              <ul className="ml-3 mt-1 space-y-1">
                {draft.facts_used.map((fact) => (
                  <li key={fact.source_url + fact.fact}>
                    {fact.fact} <SourceLink href={fact.source_url} />
                  </li>
                ))}
              </ul>
            </div>
          )}
          {draft.call_script && (
            <details className="rounded-[20px] bg-primary p-4 text-xs text-primary-foreground">
              <summary className="cursor-pointer rounded-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
                Call script
              </summary>
              <p className="mt-2 whitespace-pre-line text-sm leading-relaxed">
                {draft.call_script}
              </p>
            </details>
          )}
          {isApproved ? (
            <p className="flex flex-wrap items-center gap-1.5 rounded-full bg-good px-4 py-2 text-sm font-semibold text-good-foreground">
              <Check className="h-4 w-4" />
              Approved{draft.approved_by ? ` by ${draft.approved_by}` : ""}
              {draft.approved_at ? ` · ${formatDay(draft.approved_at)}` : ""}
              {DATA_MODE === "snapshot" && (
                <span className="ml-2 font-normal text-muted-foreground">
                  Demo only: not saved (cached sample)
                </span>
              )}
            </p>
          ) : (
            <div className="flex justify-end gap-2">
              <Button
                size="sm"
                variant="outline"
                className="rounded-full border-border bg-card px-4 font-semibold hover:bg-olive focus-visible:outline-2 focus-visible:outline-ring"
                onClick={() => setIsEditing((editing) => !editing)}
                disabled={approve.isPending}
              >
                <PenLine />
                {isEditing ? "Done editing" : "Edit"}
              </Button>
              <Button
                size="sm"
                className="rounded-full bg-primary px-5 font-semibold text-primary-foreground hover:bg-primary/85 focus-visible:outline-2 focus-visible:outline-ring"
                onClick={() => approve.mutate({ draftId: draft.id, body })}
                disabled={approve.isPending || !body.trim()}
              >
                {approve.isPending ? <Spinner /> : <Mail />}
                {donor.is_star ? "Approve & send (you)" : "Approve ✉"}
              </Button>
            </div>
          )}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          No draft yet. The outreach agent leads with what the Foundation did,
          then the ask.
        </p>
      )}
      {(draftOutreach.isError || approve.isError) && (
        <p role="alert" className="text-sm text-destructive">
          {(draftOutreach.error ?? approve.error)?.message}
        </p>
      )}
    </section>
  );
};

export const SampleHistoryBadge = () => (
  <span
    className="rounded-full bg-brand-soft px-2.5 py-0.5 text-xs font-semibold text-brand-soft-foreground"
    title="This donor's gifts are invented sample data, not the Foundation's records."
  >
    Sample history
  </span>
);

const SendPolicy = ({ isStar }: { isStar: boolean }) =>
  isStar ? (
    <p className="rounded-[18px] bg-brand-soft px-4 py-2.5 text-xs font-medium text-brand-soft-foreground">
      ★ Big donor: never sent automatically. A person reviews, approves and
      sends.
    </p>
  ) : (
    <p className="text-xs text-muted-foreground">
      Small or lapsed donor: can go out automatically once approved.
    </p>
  );
