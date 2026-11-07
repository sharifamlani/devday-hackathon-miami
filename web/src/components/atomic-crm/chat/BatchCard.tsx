import { useState } from "react";
import { AlertTriangle, ExternalLink, Mail, MessageSquare, Star } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import { APPROVER_NAME } from "../providers/local/config";
import { useApproveSendBatch } from "../providers/local/crmHooks";
import type { SendBatch, SendItem } from "../providers/local/crmTypes";
import {
  approvedCount,
  canSend,
  channelCounts,
  defaultSelection,
  flagReason,
  itemKind,
  openItems,
  perItemFor,
  toggleItem,
} from "./batchRules";
import type { BatchReceipt } from "./threadStore";

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

const ItemRow = ({
  item,
  checked,
  onToggle,
  expanded,
  onExpand,
}: {
  item: SendItem;
  checked: boolean;
  onToggle: () => void;
  expanded: boolean;
  onExpand: () => void;
}) => {
  const kind = itemKind(item);
  const id = `batch-item-${item.id}`;
  return (
    <li className="rounded-md border bg-background p-2" data-testid="batch-item" data-kind={kind}>
      <div className="flex items-start gap-2">
        <Checkbox
          id={id}
          checked={checked}
          disabled={kind === "flagged"}
          onCheckedChange={onToggle}
          aria-describedby={kind !== "ok" ? `${id}-why` : undefined}
          className="mt-0.5"
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <Label htmlFor={id} className="truncate font-medium">
              {item.name ?? item.to ?? "Recipient"}
            </Label>
            {item.channel === "email" ? (
              <Mail className="size-3.5 shrink-0 text-muted-foreground" aria-label="email" />
            ) : (
              <MessageSquare className="size-3.5 shrink-0 text-muted-foreground" aria-label="text" />
            )}
            <button
              type="button"
              onClick={onExpand}
              className="ml-auto shrink-0 text-xs text-muted-foreground underline-offset-2 hover:underline"
              aria-expanded={expanded}
            >
              {expanded ? "Hide" : "Preview"}
            </button>
          </div>
          {kind === "individual" && (
            <p id={`${id}-why`} className="mt-0.5 flex items-center gap-1 text-xs text-amber-700 dark:text-amber-400">
              <Star className="size-3" aria-hidden />
              Needs individual approval
              {item.approval_reason ? ` · ${item.approval_reason}` : ""}
            </p>
          )}
          {kind === "flagged" && (
            <p id={`${id}-why`} className="mt-0.5 flex items-center gap-1 text-xs text-destructive">
              <AlertTriangle className="size-3" aria-hidden />
              Can't send: {flagReason(item)}. Edit it first.
            </p>
          )}
          {expanded && <MessagePreview item={item} />}
        </div>
      </div>
    </li>
  );
};

const MessagePreview = ({ item }: { item: SendItem }) => (
  <div className="mt-2 space-y-1.5 rounded bg-muted/50 p-2 text-xs" data-testid="message-preview">
    {item.subject && <p className="font-medium">{item.subject}</p>}
    <p className="whitespace-pre-wrap leading-relaxed">{item.body}</p>
    {item.facts_used.length > 0 && (
      <div>
        <p className="font-medium text-muted-foreground">Facts used</p>
        <ul className="mt-0.5 space-y-0.5">
          {item.facts_used.map((f, i) => (
            <li key={i}>
              {f.fact}{" "}
              <a
                href={f.source_url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-0.5 text-primary underline-offset-2 hover:underline"
              >
                [src]
                <ExternalLink className="size-2.5" aria-hidden />
                <span className="sr-only">(opens source)</span>
              </a>
            </li>
          ))}
        </ul>
      </div>
    )}
  </div>
);

export const BatchCard = ({
  batch,
  demo,
  onResolved,
}: {
  batch: SendBatch;
  demo: boolean;
  onResolved: (receipt: BatchReceipt) => void;
}) => {
  const approve = useApproveSendBatch();
  const [selected, setSelected] = useState(() => defaultSelection(batch));
  const [approver, setApprover] = useState(APPROVER_NAME);
  const [expandedId, setExpandedId] = useState<number | null>(openItems(batch)[0]?.id ?? null);
  const items = openItems(batch);
  const counts = channelCounts(batch);
  const n = approvedCount(batch, selected);
  const approverId = `approver-${batch.id}`;

  const send = async () => {
    try {
      const result = await approve.mutateAsync({
        batchId: batch.id,
        approvedBy: approver,
        perItem: perItemFor(batch, selected),
      });
      onResolved({
        batchId: batch.id,
        title: batch.title,
        outcome: "sent",
        sent: result.sent,
        skipped: result.skipped,
        blocked: result.blocked,
        simulated: result.simulated,
        approvedBy: approver.trim(),
        at: new Date().toISOString(),
      });
    } catch {
      /* approve.error renders below */
    }
  };

  const discard = () =>
    onResolved({
      batchId: batch.id,
      title: batch.title,
      outcome: "discarded",
      sent: 0,
      skipped: items.length,
      blocked: [],
      simulated: true,
      approvedBy: null,
      at: new Date().toISOString(),
    });

  return (
    <section
      aria-label={`Pending batch: ${batch.title ?? "messages"}`}
      className="space-y-2 rounded-lg border border-primary/30 bg-card p-3 shadow-sm"
      data-testid="batch-card"
    >
      <header className="space-y-1">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold">{batch.title ?? "Messages ready for review"}</h3>
          {demo && <Badge variant="secondary">Demo run (cached sample)</Badge>}
        </div>
        <p className="text-xs text-muted-foreground" data-testid="channel-counts">
          {plural(counts.email, "email")} · {plural(counts.text, "text")} · nothing sends until you approve
        </p>
      </header>

      <ul className="max-h-72 space-y-1.5 overflow-y-auto pr-1">
        {items.map((item) => (
          <ItemRow
            key={item.id}
            item={item}
            checked={selected.has(item.id)}
            onToggle={() => setSelected((s) => toggleItem(batch, s, item.id))}
            expanded={expandedId === item.id}
            onExpand={() => setExpandedId((id) => (id === item.id ? null : item.id))}
          />
        ))}
      </ul>

      <div className="space-y-1">
        <Label htmlFor={approverId} className="text-xs">
          Approved by (required)
        </Label>
        <Input
          id={approverId}
          value={approver}
          onChange={(e) => setApprover(e.target.value)}
          placeholder="Your name"
          aria-required
          className="h-8 text-sm"
        />
      </div>

      {approve.error && (
        <p role="alert" className="text-xs text-destructive">
          {approve.error.message}
        </p>
      )}

      <div className="flex gap-2">
        <Button
          size="sm"
          className="flex-1"
          disabled={!canSend(batch, selected, approver) || approve.isPending}
          onClick={send}
        >
          {approve.isPending ? "Sending…" : `Send ${n} approved`}
        </Button>
        <Button size="sm" variant="ghost" onClick={discard} disabled={approve.isPending}>
          Discard
        </Button>
      </div>
    </section>
  );
};

export const ReceiptCard = ({ receipt }: { receipt: BatchReceipt }) => (
  <section
    aria-label="Send receipt"
    className="space-y-1 rounded-lg border bg-muted/40 p-3 text-xs"
    data-testid="receipt"
  >
    <p className="text-sm font-medium">
      {receipt.outcome === "discarded"
        ? `Discarded: ${receipt.title ?? "batch"}`
        : `${plural(receipt.sent, "message")} approved by ${receipt.approvedBy}`}
    </p>
    {receipt.outcome === "sent" && receipt.simulated && (
      <p className="font-medium text-amber-700 dark:text-amber-400">Test mode: not actually sent</p>
    )}
    {receipt.outcome === "sent" && (receipt.skipped > 0 || receipt.blocked.length > 0) && (
      <p className="text-muted-foreground">
        {receipt.skipped > 0 && `${receipt.skipped} skipped`}
        {receipt.skipped > 0 && receipt.blocked.length > 0 && " · "}
        {receipt.blocked.length > 0 && `${receipt.blocked.length} held back`}
      </p>
    )}
    {receipt.blocked.length > 0 && (
      <ul className="list-disc pl-4 text-muted-foreground">
        {receipt.blocked.map((b) => (
          <li key={b.id}>#{b.id}: {b.reason}</li>
        ))}
      </ul>
    )}
  </section>
);
