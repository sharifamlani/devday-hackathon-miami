/**
 * What really happened to a sent message, in words, from the API response or the
 * outbox row: "Dry run", "Sent via Gmail", "Failed via Gmail: <why>". Nothing here
 * is hardcoded to "simulated": a real send is never called a simulation and a dry
 * run is never called sent.
 */
import type {
  OutboxEntry,
  SendCampaignResult,
} from "../providers/local/campaignTypes";

export type Outcome = "dryrun" | "sent" | "failed";
export type Tone = "ok" | "dry" | "error";
export interface Segment {
  text: string;
  tone: Tone;
}

const PROVIDER_NAMES: Record<string, string> = {
  gmail: "Gmail",
  twilio: "Twilio",
  linq: "Linq",
};

export const providerName = (provider: string | null | undefined) =>
  !provider
    ? "provider"
    : (PROVIDER_NAMES[provider] ??
      provider.charAt(0).toUpperCase() + provider.slice(1));

const plural = (n: number) => `${n} message${n === 1 ? "" : "s"}`;
const failureReason = (status: string) =>
  status.replace(/^failed:?\s*/i, "").trim() || "no reason given";

type OutboxLike = Pick<
  OutboxEntry,
  "provider" | "simulated" | "delivery_status"
>;

/** Classify one outbox row. The failed status wins; then dry run; the rest were really sent. */
export const outboxOutcome = (entry: OutboxLike): Outcome =>
  entry.delivery_status?.startsWith("failed")
    ? "failed"
    : entry.simulated || entry.provider === "dryrun"
      ? "dryrun"
      : "sent";

/** The per-row label. `stamp` is the already formatted time shown after a real send. */
export const outboxLabel = (
  entry: OutboxLike,
  stamp?: string,
): { text: string; tone: Tone } => {
  const outcome = outboxOutcome(entry);
  const via = providerName(entry.provider);
  if (outcome === "failed")
    return {
      text: `Failed via ${via}: ${failureReason(entry.delivery_status ?? "")}`,
      tone: "error",
    };
  if (outcome === "dryrun") return { text: "Dry run", tone: "dry" };
  return {
    text: `Sent via ${via}${stamp ? ` · ${stamp}` : ""}`,
    tone: "ok",
  };
};

/** The label for a campaign's list row, from its outbox rows (none yet: nothing claimed). */
export const campaignOutcomeLabel = (
  entries: OutboxLike[],
): { text: string; tone: Tone } => {
  if (!entries.length) return { text: "Completed", tone: "dry" };
  const real = [
    ...new Set(
      entries
        .filter((e) => outboxOutcome(e) === "sent")
        .map((e) => providerName(e.provider)),
    ),
  ];
  const dry = entries.some((e) => outboxOutcome(e) === "dryrun");
  const failed = entries.some((e) => outboxOutcome(e) === "failed");
  if (failed) return { text: "Some failed", tone: "error" };
  if (!real.length) return { text: "Dry run", tone: "dry" };
  return {
    text: `Sent via ${real.join(", ")}${dry ? " + dry run" : ""}`,
    tone: "ok",
  };
};

const count = (n: number, noun: string) => `${n} ${noun}${n === 1 ? "" : "s"}`;

/**
 * The counter line under a campaign: "3 messages · 0 approved · 2 sent via Gmail · 1 dry run".
 * 'sent' in the DB only means processed, so the sent messages are split by their outbox rows.
 * Rows not loaded (undefined) or missing for a message: "processed", never a claim of delivery.
 */
export const campaignCounterSegments = (
  counts: { total: number; approved: number; sent: number },
  entries: OutboxLike[] | undefined,
): Segment[] => {
  const out: Segment[] = [
    { text: count(counts.total, "message"), tone: "dry" },
    { text: `${counts.approved} approved`, tone: "dry" },
  ];
  if (!counts.sent) return out;
  const rows = entries ?? [];
  const byProvider = new Map<string, number>();
  let dry = 0;
  let failed = 0;
  for (const e of rows) {
    const o = outboxOutcome(e);
    if (o === "dryrun") dry += 1;
    else if (o === "failed") failed += 1;
    else {
      const name = providerName(e.provider);
      byProvider.set(name, (byProvider.get(name) ?? 0) + 1);
    }
  }
  for (const [name, n] of byProvider)
    out.push({ text: `${n} sent via ${name}`, tone: "ok" });
  if (dry) out.push({ text: `${dry} dry run`, tone: "dry" });
  if (failed) out.push({ text: `${failed} failed`, tone: "error" });
  const unknown = Math.max(0, counts.sent - rows.length);
  if (unknown) out.push({ text: `${unknown} processed`, tone: "dry" });
  return out;
};

/** The confirmation after pressing send: one segment per outcome. Empty when nothing happened. */
export const sendSummary = (result: SendCampaignResult): Segment[] => {
  const out: Segment[] = [];
  // Older services send no per-provider counts: fall back to the simulated flag.
  const providers =
    result.providers ??
    (result.sent ? { [result.simulated ? "dryrun" : ""]: result.sent } : {});
  const dry = providers.dryrun ?? 0;
  const real = Object.entries(providers).filter(
    ([name, n]) => name !== "dryrun" && n > 0,
  );
  if (real.length)
    out.push({
      text: `${real
        .map(([name, n]) => `Sent ${n} via ${providerName(name)}`)
        .join(", ")}.`,
      tone: "ok",
    });
  if (dry)
    out.push({
      text: `Dry run: ${plural(dry)} logged to the outbox. Nothing was delivered.`,
      tone: "dry",
    });
  for (const f of result.failed ?? [])
    out.push({
      text: `Failed via ${providerName(f.provider)}: ${f.donor_name} (${failureReason(f.reason)}).`,
      tone: "error",
    });
  if (result.no_address.length)
    out.push({
      text: `Not sent, no address: ${result.no_address
        .map((n) => `${n.donor_name} (${n.reason})`)
        .join(", ")}.`,
      tone: "dry",
    });
  if (!out.length)
    out.push({ text: "Nothing was sent: no approved messages.", tone: "dry" });
  return out;
};

/** Text colour per tone, for inline counters. */
export const TEXT_TONE_CLASS = {
  ok: "",
  dry: "",
  error: "text-destructive",
};

/** Pill colours per tone (Tailwind classes). */
export const TONE_CLASS = {
  ok: "bg-good text-good-foreground",
  dry: "bg-quiet text-quiet-foreground",
  error: "bg-destructive/10 text-destructive",
};
