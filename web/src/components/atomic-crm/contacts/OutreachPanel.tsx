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
  const approve = useApproveDraft(donor.id);
  const draft = donor.draft;
  const [isEditing, setIsEditing] = useState(false);
  const [body, setBody] = useState(draft?.body ?? "");

  useEffect(() => {
    setBody(draft?.body ?? "");
    setIsEditing(false);
  }, [draft?.id, draft?.body]);

  const isApproved = draft?.status === "approved" || draft?.status === "sent";

  return (
    <section aria-label="Draft" className="space-y-3">
      <PanelHeading
        title="Draft"
        caption="Outreach agent · written in the Foundation's voice"
      >
        {!draft && (
          <Button
            size="sm"
            variant="outline"
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
          {draft.subject && (
            <p className="text-sm">
              <span className="text-muted-foreground">Subject: </span>
              <span className="font-medium">{draft.subject}</span>
            </p>
          )}
          {isEditing ? (
            <Textarea
              aria-label="Draft body"
              value={body}
              onChange={(event) => setBody(event.target.value)}
              className="min-h-56 text-sm"
            />
          ) : (
            <p className="whitespace-pre-line rounded-md border bg-background p-3 text-sm leading-relaxed">
              {body}
            </p>
          )}
          {draft.facts_used.length > 0 && (
            <div className="text-xs">
              <p className="text-muted-foreground">↳ facts used:</p>
              <ul className="ml-3 space-y-1">
                {draft.facts_used.map((fact) => (
                  <li key={fact.source_url + fact.fact}>
                    {fact.fact} <SourceLink href={fact.source_url} />
                  </li>
                ))}
              </ul>
            </div>
          )}
          {draft.call_script && (
            <details className="text-xs">
              <summary className="cursor-pointer text-muted-foreground">
                Call script
              </summary>
              <p className="mt-1 whitespace-pre-line">{draft.call_script}</p>
            </details>
          )}
          {isApproved ? (
            <p className="flex items-center gap-1 text-sm font-medium text-emerald-700 dark:text-emerald-400">
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
                onClick={() => setIsEditing((editing) => !editing)}
                disabled={approve.isPending}
              >
                <PenLine />
                {isEditing ? "Done editing" : "Edit"}
              </Button>
              <Button
                size="sm"
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
    className="rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-900 dark:bg-amber-950 dark:text-amber-200"
    title="This donor's gifts are invented sample data, not the Foundation's records."
  >
    Sample history
  </span>
);

const SendPolicy = ({ isStar }: { isStar: boolean }) =>
  isStar ? (
    <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
      ★ Big donor: never sent automatically. A person reviews, approves and
      sends.
    </p>
  ) : (
    <p className="text-xs text-muted-foreground">
      Small or lapsed donor: can go out automatically once approved.
    </p>
  );
