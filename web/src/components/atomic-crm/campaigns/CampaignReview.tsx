import { useState } from "react";
import {
  Check,
  CheckCheck,
  PenLine,
  RotateCcw,
  Send,
  SkipForward,
} from "lucide-react";
import { useParams } from "react-router";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { tierLabel } from "../contacts/donorFormat";
import { SourceLink } from "../contacts/ResearchPanel";
import {
  useApproveSmallDrafts,
  useCampaign,
  useSendCampaign,
  useUpdateCampaignMessage,
} from "../providers/local/hooks";
import type {
  ApproveSmallResult,
  CampaignDetail,
  CampaignMessage,
  SendCampaignResult,
} from "../providers/local/campaignTypes";
import { formatStamp, intentLabel, pillButton } from "./campaignFormat";
import { ChannelLabel, LinkPill, PageShell, SimulatedNote } from "./campaignUi";

const SMS_MAX = 320;

/** /campaigns/:id: every draft, editable, approved one by one or (small donors) together. */
export const CampaignReview = () => {
  const { id } = useParams();
  const campaignId = Number(id);
  const {
    data: campaign,
    isPending,
    error,
  } = useCampaign(Number.isInteger(campaignId) ? campaignId : null);

  if (isPending) {
    return (
      <PageShell eyebrow="CAMPAIGN" title="Loading…">
        <Skeleton className="h-40 w-full rounded-[22px]" />
      </PageShell>
    );
  }
  if (error || !campaign) {
    return (
      <PageShell
        eyebrow="CAMPAIGN"
        title="Campaign not found"
        actions={<LinkPill to="/campaigns">All campaigns</LinkPill>}
      >
        <p role="alert" className="text-sm text-destructive">
          {error?.message ?? "This campaign does not exist."}
        </p>
      </PageShell>
    );
  }
  return <Review campaign={campaign} />;
};

const Review = ({ campaign }: { campaign: CampaignDetail }) => {
  const approveSmall = useApproveSmallDrafts(campaign.id);
  const send = useSendCampaign(campaign.id);
  const [approved, setApproved] = useState<ApproveSmallResult | null>(null);
  const [sent, setSent] = useState<SendCampaignResult | null>(null);
  const { counts } = campaign;

  return (
    <PageShell
      eyebrow={`CAMPAIGN · ${intentLabel(campaign.intent).toUpperCase()}`}
      title={campaign.name}
      caption={
        <span className="inline-flex flex-wrap items-center gap-x-3 gap-y-1">
          <ChannelLabel channel={campaign.channel} />
          <span>Created {formatStamp(campaign.created_at)}</span>
          <span>
            {counts.total} messages · {counts.approved} approved · {counts.sent}{" "}
            sent
            {counts.skipped ? ` · ${counts.skipped} skipped` : ""}
          </span>
        </span>
      }
      actions={
        <>
          <LinkPill to="/outbox">Outbox</LinkPill>
          <LinkPill to="/campaigns">All campaigns</LinkPill>
        </>
      }
    >
      <section
        aria-label="Approve and send"
        className="space-y-3 rounded-[22px] bg-card p-5"
      >
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            className={cn(
              pillButton,
              "border-border bg-surface hover:bg-olive",
            )}
            disabled={!counts.bulk_approvable || approveSmall.isPending}
            onClick={async () => {
              setSent(null);
              try {
                setApproved(await approveSmall.mutateAsync());
              } catch {
                // shown below
              }
            }}
          >
            {approveSmall.isPending ? <Spinner /> : <CheckCheck />}
            Approve all small-donor drafts ({counts.bulk_approvable})
          </Button>
          <Button
            className={cn(
              pillButton,
              "bg-primary text-primary-foreground hover:bg-primary/85",
            )}
            disabled={!counts.approved || send.isPending}
            onClick={async () => {
              setApproved(null);
              try {
                setSent(await send.mutateAsync());
              } catch {
                // shown below
              }
            }}
          >
            {send.isPending ? <Spinner /> : <Send />}
            Send to outbox (simulated)
            {counts.approved ? ` · ${counts.approved}` : ""}
          </Button>
        </div>
        <SimulatedNote />
        <p className="text-xs text-muted-foreground">
          Star, big and organization donors are never approved in bulk: approve
          each one below ({counts.needs_individual_approval} waiting). Drafts
          the guardrail flagged can't be approved until you edit them.
        </p>
        <div role="status" className="text-sm empty:hidden">
          {approved &&
            `Approved ${approved.approved} small-donor draft${approved.approved === 1 ? "" : "s"}. ${approved.left_for_individual_approval} still need individual approval${approved.flagged ? `, ${approved.flagged} flagged` : ""}.`}
          {sent && (
            <>
              {`Moved ${sent.sent} message${sent.sent === 1 ? "" : "s"} to the simulated outbox. Nothing was delivered.`}
              {sent.no_address.length > 0 &&
                ` Not sent: ${sent.no_address.map((n) => `${n.donor_name} (${n.reason})`).join(", ")}.`}
            </>
          )}
        </div>
        {(approveSmall.isError || send.isError) && (
          <p role="alert" className="text-sm text-destructive">
            {(approveSmall.error ?? send.error)?.message}
          </p>
        )}
      </section>

      <ol className="space-y-4" aria-label="Messages">
        {campaign.messages.map((message) => (
          <li key={message.id}>
            <MessageCard campaignId={campaign.id} message={message} />
          </li>
        ))}
      </ol>
    </PageShell>
  );
};

const initialsOf = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");

const MessageCard = ({
  campaignId,
  message: m,
}: {
  campaignId: number;
  message: CampaignMessage;
}) => {
  const update = useUpdateCampaignMessage(campaignId);
  const [editing, setEditing] = useState(false);
  const [subject, setSubject] = useState(m.subject ?? "");
  const [body, setBody] = useState(m.body);
  const isText = m.channel === "text";
  const locked = m.status === "sent";
  const headingId = `message-${m.id}-name`;

  const save = (
    input: Parameters<typeof update.mutate>[0]["input"],
    onSaved?: () => void,
  ) => update.mutate({ messageId: m.id, input }, { onSuccess: onSaved });

  const startEdit = () => {
    setSubject(m.subject ?? "");
    setBody(m.body);
    setEditing(true);
  };

  return (
    <article
      aria-labelledby={headingId}
      className={cn(
        "space-y-4 rounded-[22px] bg-card p-5",
        m.status === "skipped" && "opacity-75",
      )}
    >
      <header className="flex items-start gap-3">
        <div
          aria-hidden
          className="grid size-11 shrink-0 place-items-center rounded-full bg-brand text-sm font-bold text-brand-foreground"
        >
          {initialsOf(m.donor_name)}
        </div>
        <div className="min-w-0 flex-1">
          <h2
            id={headingId}
            className="text-sm font-semibold [overflow-wrap:anywhere]"
          >
            {m.is_star && <span aria-label="Star donor">★ </span>}
            {m.donor_name}
          </h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {m.tier ? `${tierLabel[m.tier]} tier · ` : ""}
            {m.why_short}
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5 text-[11px] font-semibold">
            {m.needs_individual_approval && (
              <span className="rounded-full bg-brand-soft px-2.5 py-0.5 text-brand-soft-foreground">
                {m.approval_reason ?? "Big donor"}: approve individually
              </span>
            )}
            {m.is_sample && (
              <span className="rounded-full bg-quiet px-2.5 py-0.5 text-quiet-foreground">
                Sample history
              </span>
            )}
            <span className="rounded-full bg-quiet px-2.5 py-0.5 text-quiet-foreground">
              To: {m.to ?? (isText ? "no phone on file" : "no email on file")}
            </span>
          </div>
        </div>
        <StatusChip message={m} />
      </header>

      <p className="text-xs text-muted-foreground">
        {m.drafted_by === "model"
          ? "Drafted by the outreach agent from this donor's record and your organization's facts."
          : (m.draft_note ?? "Template draft (no AI).")}
      </p>

      {editing ? (
        <div className="space-y-2 rounded-[18px] bg-surface p-4">
          {!isText && (
            <div className="space-y-1">
              <label
                htmlFor={`subject-${m.id}`}
                className="text-xs font-medium text-muted-foreground"
              >
                Subject
              </label>
              <Input
                id={`subject-${m.id}`}
                value={subject}
                onChange={(event) => setSubject(event.target.value)}
                className="min-h-11 rounded-[12px] border-border bg-card"
              />
            </div>
          )}
          <div className="space-y-1">
            <label
              htmlFor={`body-${m.id}`}
              className="text-xs font-medium text-muted-foreground"
            >
              Message
            </label>
            <Textarea
              id={`body-${m.id}`}
              value={body}
              onChange={(event) => setBody(event.target.value)}
              aria-describedby={isText ? `count-${m.id}` : undefined}
              className="min-h-48 rounded-[12px] border-border bg-card text-sm"
            />
            {isText && (
              <p
                id={`count-${m.id}`}
                className={cn(
                  "text-right text-xs",
                  body.length > SMS_MAX
                    ? "font-semibold text-destructive"
                    : "text-muted-foreground",
                )}
              >
                {body.length} / {SMS_MAX} characters
              </p>
            )}
          </div>
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              className={cn(pillButton, "border-border bg-card")}
              onClick={() => setEditing(false)}
            >
              Cancel
            </Button>
            <Button
              className={cn(
                pillButton,
                "bg-primary text-primary-foreground hover:bg-primary/85",
              )}
              disabled={!body.trim() || update.isPending}
              onClick={() => {
                save({ body, ...(isText ? {} : { subject }) }, () =>
                  setEditing(false),
                );
              }}
            >
              {update.isPending ? <Spinner /> : <Check />}
              Save edit
            </Button>
          </div>
        </div>
      ) : (
        <div className="rounded-[18px] bg-surface px-5 py-4">
          {m.subject && (
            <p className="mb-2 text-base font-medium tracking-tight [overflow-wrap:anywhere]">
              {m.subject}
            </p>
          )}
          <p className="whitespace-pre-line text-sm leading-relaxed [overflow-wrap:anywhere]">
            {m.body}
          </p>
          {isText && (
            <p className="mt-2 text-right text-xs text-muted-foreground">
              {m.body.length} / {SMS_MAX} characters
            </p>
          )}
        </div>
      )}

      {m.flags.length > 0 && (
        <div className="flag rounded-[12px] bg-warn p-4 text-xs leading-relaxed text-warn-foreground">
          <strong className="block text-sm">Flagged by the guardrail</strong>
          <ul className="ml-4 mt-1 list-disc">
            {m.flags.map((flag) => (
              <li key={flag}>{flag}</li>
            ))}
          </ul>
          <p className="mt-1">
            Edit the message so it only uses facts from the record.
          </p>
        </div>
      )}

      {m.facts_used.length > 0 && (
        <div className="text-xs">
          <p className="text-muted-foreground">↳ facts used:</p>
          <ul className="ml-3 mt-1 space-y-1">
            {m.facts_used.map((fact) => (
              <li
                key={fact.source_url + fact.fact}
                className="[overflow-wrap:anywhere]"
              >
                {fact.fact} <SourceLink href={fact.source_url} />
              </li>
            ))}
          </ul>
        </div>
      )}

      {!locked && !editing && (
        <div className="flex flex-wrap justify-end gap-2">
          <Button
            variant="outline"
            className={cn(pillButton, "border-border bg-card hover:bg-olive")}
            onClick={startEdit}
            disabled={update.isPending}
          >
            <PenLine />
            Edit
          </Button>
          {m.status === "skipped" || m.status === "approved" ? (
            <Button
              variant="outline"
              className={cn(pillButton, "border-border bg-card hover:bg-olive")}
              onClick={() => save({ status: "draft" })}
              disabled={update.isPending}
            >
              <RotateCcw />
              {m.status === "approved" ? "Undo approval" : "Restore"}
            </Button>
          ) : (
            <>
              <Button
                variant="outline"
                className={cn(
                  pillButton,
                  "border-border bg-card hover:bg-olive",
                )}
                onClick={() => save({ status: "skipped" })}
                disabled={update.isPending}
              >
                <SkipForward />
                Skip
              </Button>
              <Button
                className={cn(
                  pillButton,
                  "bg-primary text-primary-foreground hover:bg-primary/85",
                )}
                onClick={() => save({ status: "approved" })}
                disabled={update.isPending || m.flags.length > 0}
                aria-describedby={
                  m.flags.length ? `flagnote-${m.id}` : undefined
                }
              >
                {update.isPending ? <Spinner /> : <Check />}
                Approve
              </Button>
            </>
          )}
        </div>
      )}
      {m.flags.length > 0 && m.status === "draft" && (
        <p id={`flagnote-${m.id}`} className="sr-only">
          Approval is blocked until the flagged figures are fixed.
        </p>
      )}
      {update.isError && (
        <p role="alert" className="text-sm text-destructive">
          {update.error.message}
        </p>
      )}
    </article>
  );
};

const StatusChip = ({ message: m }: { message: CampaignMessage }) => {
  const [label, tone] =
    m.status === "sent"
      ? [
          `Sent (simulated) · ${formatStamp(m.sent_at)}`,
          "bg-good text-good-foreground",
        ]
      : m.status === "approved"
        ? [
            `Approved${m.approved_via === "bulk" ? " in bulk" : ""}${m.approved_by ? ` by ${m.approved_by}` : ""}`,
            "bg-good text-good-foreground",
          ]
        : m.status === "skipped"
          ? ["Skipped", "bg-quiet text-quiet-foreground"]
          : ["Draft", "bg-brand-soft text-brand-soft-foreground"];
  return (
    <span
      className={cn(
        "max-w-40 shrink-0 rounded-full px-3 py-1 text-right text-[11px] font-semibold",
        tone,
      )}
    >
      {label}
    </span>
  );
};
