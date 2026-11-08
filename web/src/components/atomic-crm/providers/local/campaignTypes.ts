/**
 * Campaigns (#38): bulk drafts, human approval, simulated outbox. Shapes of
 * service/routes_campaigns.py. Nothing here ever sends a real email or text.
 */
import type { Tier } from "./types";
import type { ContextItem } from "./contextSearch";

export type CampaignIntent = "thank_you" | "re_engage" | "check_in";
export type CampaignChannel = "email" | "text";
export type CampaignMessageStatus = "draft" | "approved" | "sent" | "skipped";

export interface CampaignFact {
  fact: string;
  source_url: string;
  date: string | null;
}

export interface CampaignMessage {
  id: number;
  campaign_id: number;
  donor_id: number;
  donor_name: string;
  donor_type: string | null;
  tier: Tier | null;
  is_star: boolean;
  is_sample: boolean;
  why_short: string; // built from score.py's why JSON, like the call list
  needs_individual_approval: boolean; // star, big tier or organization
  approval_reason: string | null; // "Star donor" | "Organization" | "Big donor"
  channel: CampaignChannel;
  to: string | null; // always masked: r***@example.com, ***-***-0101
  subject: string | null;
  body: string;
  facts_used: CampaignFact[];
  /** plan.md §21.2.4 (C2): context items the draft cites by id, newest first. */
  sources: ContextItem[];
  flags: string[]; // output guardrail findings; non-empty blocks approval
  drafted_by: "model" | "template";
  draft_note: string | null;
  status: CampaignMessageStatus;
  approved_by: string | null;
  approved_via: "individual" | "bulk" | null;
  approved_at: string | null;
  sent_at: string | null;
}

export interface CampaignCounts {
  total: number;
  draft: number;
  approved: number;
  sent: number;
  skipped: number;
  needs_individual_approval: number; // still drafts
  flagged: number;
  bulk_approvable: number;
}

export interface CampaignSummary {
  id: number;
  name: string;
  intent: CampaignIntent;
  channel: CampaignChannel;
  created_at: string;
  created_by: string | null;
  status: "draft" | "sent";
  counts: CampaignCounts;
}

export interface CampaignDetail extends CampaignSummary {
  messages: CampaignMessage[];
}

export interface CreateCampaignInput {
  donor_ids: number[];
  intent: CampaignIntent;
  channel: CampaignChannel;
  name?: string | null;
}

export interface UpdateCampaignMessageInput {
  body?: string;
  subject?: string | null;
  status?: "approved" | "skipped" | "draft";
}

export interface ApproveSmallResult {
  approved: number;
  left_for_individual_approval: number;
  flagged: number;
}

/** Who handled a message: "dryrun" delivers nothing; the rest are real providers. */
export type OutboxProvider = "dryrun" | "gmail" | "twilio" | "linq";

export interface SendCampaignResult {
  /** True only when nothing real was delivered (every sent message was a dry run). */
  simulated: boolean;
  sent: number;
  /** Sent messages per provider, e.g. { gmail: 2 } or { dryrun: 3 }. Absent on older services. */
  providers?: Record<string, number>;
  no_address: { message_id: number; donor_name: string; reason: string }[];
  /** Provider refused the send; the message stays approved. reason is "failed: <why>". */
  failed?: {
    message_id: number;
    donor_name: string;
    reason: string;
    detail?: string | null;
    provider?: string;
  }[];
  not_approved: number;
}

/** One row of the outbox, which is also the contact log. */
export interface OutboxEntry {
  id: number;
  campaign_id: number | null;
  campaign_name: string | null;
  campaign_message_id: number | null;
  donor_id: number | null;
  donor_name: string | null;
  channel: CampaignChannel;
  to: string | null; // masked
  subject: string | null;
  body: string;
  sent_at: string;
  /** True for a dry run: logged, not delivered. */
  simulated: boolean;
  provider?: OutboxProvider | string;
  /** "queued (dry run)" | "sent" | "failed: <why>" */
  delivery_status?: string;
  provider_id?: string | null;
}

export interface CampaignMethods {
  createCampaign(input: CreateCampaignInput): Promise<CampaignDetail>;
  getCampaigns(): Promise<CampaignSummary[]>; // newest first
  getCampaign(id: number): Promise<CampaignDetail>;
  updateCampaignMessage(
    campaignId: number,
    messageId: number,
    input: UpdateCampaignMessageInput,
  ): Promise<CampaignMessage>;
  /** Bulk-approves only drafts that need no individual approval and have no flags. */
  approveSmallDrafts(campaignId: number): Promise<ApproveSmallResult>;
  /** Approved messages go through the delivery hook: a dry run unless Gmail/SMS sending is switched on. */
  sendCampaign(campaignId: number): Promise<SendCampaignResult>;
  getOutbox(): Promise<OutboxEntry[]>;
}
