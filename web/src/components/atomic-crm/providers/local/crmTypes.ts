/**
 * Phase 5E (plan.md §17): one CRM, three tabs (Givers · Neighbors · Community),
 * an event calendar, community stats and the chat agent with approval-gated
 * sends. None of these routes exist yet, so the raw shapes below are the
 * proposed contract and crmParse.ts accepts the reasonable variants.
 */

import type { ApiJson } from "./apiTypes";

/* ---------- Tabs ---------- */

/** The three locked tabs, by contact_type. */
export type Tab = "giver" | "neighbor" | "community";
export const TABS: Tab[] = ["giver", "neighbor", "community"];
export const TAB_LABELS: Record<Tab, string> = {
  giver: "Givers",
  neighbor: "Neighbors",
  community: "Community",
};

/** Upload screen: pick a tab, or let the agent sort ("auto", the default). */
export type UploadTarget = Tab | "auto";

/* ---------- Raw API shapes (proposed) ---------- */

export interface ApiPerson {
  id: number;
  full_name: string;
  org_name?: string | null;
  // giver | neighbor | community; "donor"/"beneficiary"/"prospect" accepted
  contact_type?: string | null;
  email?: string | null; // masked by the API
  phone?: string | null; // masked by the API
  city?: string | null;
  tags?: ApiJson<string[]>; // e.g. ["has a dog"]
  // Community only: what the nonprofit recorded; null/absent = not recorded
  demographics?: ApiJson<Record<string, string | number | null>>;
  // Givers only (from donor_scores)
  score?: number | null;
  tier?: string | null;
  is_star?: boolean | number | null;
  status?: string | null;
  last_touch?: string | null; // ISO date of the last gift, visit or message
  next_step?: string | null; // suggested by the agent
  needs_review?: boolean | number | null; // unclear sort or cross-file duplicate
  review_reason?: string | null;
}

/** GET /people?type=X: a list, or {items|people, counts}. */
export type ApiPeopleResponse =
  | ApiPerson[]
  | {
      items?: ApiPerson[];
      people?: ApiPerson[];
      counts?: Partial<Record<string, number>>;
    };

export interface ApiEvent {
  id: number;
  title: string;
  starts_at: string; // ISO date or datetime
  ends_at?: string | null;
  place?: string | null;
  audience?: string | null; // "Givers, lapsing first"
  audience_label?: string | null;
  source?: string | null; // website | news | x | linkedin | instagram
  source_url?: string | null;
  url?: string | null;
  audience_count?: number | null;
  drafts_ready?: number | null;
}

export interface ApiEventRecipient {
  person_id: number;
  full_name?: string;
  name?: string;
  contact_type?: string | null;
  reason?: string | null; // why this person was picked ("tagged: has a dog")
}

export interface ApiSendItem {
  id: number;
  person_id?: number | null;
  full_name?: string | null;
  name?: string | null;
  contact_type?: string | null;
  channel?: string | null; // email | text
  to?: string | null; // masked address
  subject?: string | null;
  body: string;
  facts_used?: ApiJson<{ fact: string; url?: string; source_url?: string }[]>;
  needs_individual_approval?: boolean | number | null; // ★, big tier, organizations
  approval_reason?: string | null;
  flags?: ApiJson<string[]>; // a flagged item can't be approved until edited
  status?: string | null; // draft | approved | sent | skipped
}

/** GET /events/{id}: the event plus its audience and pre-drafted invites. */
export interface ApiEventDetail extends ApiEvent {
  recipients?: ApiEventRecipient[];
  audience_people?: ApiEventRecipient[];
  drafts?: ApiSendItem[];
}

export interface ApiStatBucket {
  label?: string | null;
  value?: string | null;
  key?: string | null;
  count: number;
}

/** GET /community/stats */
export interface ApiCommunityStats {
  total?: number;
  // {dimension: {bucket: count}} or [{dimension|label, buckets: [...]}]
  breakdowns?:
    | Record<string, Record<string, number> | ApiStatBucket[]>
    | { dimension?: string; label?: string; buckets: ApiStatBucket[] }[];
  trends?: { label?: string; metric?: string; points: { period: string; count: number }[] }[];
  as_of?: string | null;
  note?: string | null;
}

export interface ApiChatStep {
  tool?: string;
  name?: string;
  label?: string | null;
  input?: unknown;
  summary?: string | null;
  output?: unknown;
  status?: string | null; // done | error | running
}

export interface ApiSendBatch {
  id: number | string;
  batch_id?: number | string;
  title?: string | null;
  channel?: string | null;
  items: ApiSendItem[];
}

/** POST /chat */
export interface ApiChatResponse {
  reply?: string;
  message?: string;
  steps?: ApiChatStep[];
  tool_calls?: ApiChatStep[];
  pending_batch?: ApiSendBatch | null;
  batch?: ApiSendBatch | null;
  demo?: boolean;
}

/** POST /send */
export interface ApiSendResult {
  batch_id?: number | string;
  sent?: number;
  skipped?: number;
  blocked?: number | { id: number; reason: string }[];
  simulated?: boolean;
  detail?: string | null;
}

/* ---------- View model ---------- */

export interface Person {
  id: number;
  name: string;
  org_name: string | null;
  tab: Tab;
  email: string | null;
  phone: string | null;
  city: string | null;
  tags: string[];
  /** Community: every recorded field; missing values are "not recorded". */
  demographics: { label: string; value: string }[];
  score: number | null;
  tier: string | null;
  is_star: boolean;
  status: string | null;
  last_touch: string | null;
  next_step: string | null;
  needs_review: boolean;
  review_reason: string | null;
}

export interface PeoplePage {
  people: Person[];
  /** People per tab. null when the API didn't report that tab's count. */
  counts: Record<Tab, number | null>;
  needs_review: number; // people in this list flagged for review
}

export interface CrmEvent {
  id: number;
  title: string;
  starts_at: string;
  ends_at: string | null;
  place: string | null;
  audience: string | null;
  source: string | null;
  source_url: string | null; // every event has a source; null = show "no source"
  audience_count: number | null;
  drafts_ready: number | null;
}

export interface EventRecipient {
  person_id: number;
  name: string;
  tab: Tab | null;
  reason: string | null;
}

export interface SendItem {
  id: number;
  person_id: number | null;
  name: string | null;
  tab: Tab | null;
  channel: "email" | "text";
  to: string | null;
  subject: string | null;
  body: string;
  facts_used: { fact: string; source_url: string }[];
  needs_individual_approval: boolean;
  approval_reason: string | null;
  flags: string[];
  status: string;
}

export interface CrmEventDetail extends CrmEvent {
  recipients: EventRecipient[];
  drafts: SendItem[];
}

export interface StatBucket {
  label: string; // "not recorded" for a missing value
  count: number;
}

export interface CommunityStats {
  total: number | null;
  breakdowns: { dimension: string; buckets: StatBucket[] }[];
  trends: { label: string; points: { period: string; count: number }[] }[];
  as_of: string | null;
  note: string | null;
}

export interface ChatStep {
  tool: string; // "find_people", "draft_email", ...
  label: string; // human words for the tool
  summary: string | null; // what it found or did
  status: "done" | "error" | "running";
}

export interface SendBatch {
  id: string;
  title: string | null;
  items: SendItem[];
  /** Items a bulk approval may cover: no individual approval needed, no flags. */
  bulk_approvable: number;
  needs_individual_approval: number;
  flagged: number;
}

export interface ChatMessage {
  role: "user" | "assistant";
  text: string;
  steps: ChatStep[];
  batch: SendBatch | null; // waiting for approval; nothing is sent without it
  demo: boolean; // a canned run (snapshot mode)
}

/** Where the chat is opened; the agent tailors its tools to it. */
export interface ChatContext {
  screen: Tab | "calendar" | "home";
  person_id?: number;
  event_id?: number;
}

export interface SendResult {
  sent: number;
  skipped: number;
  blocked: { id: number; reason: string }[];
  simulated: boolean; // the demo outbox: nothing leaves the laptop
}

/** Per-item decisions; items needing individual approval must be listed. */
export type PerItemApproval = { id: number; approve: boolean }[];

/** GET /context/status (proposed). */
export interface ApiContextStatus {
  last_refreshed_at?: string | null; // ISO datetime of the last refresh
  refreshed_at?: string | null;
  last_change?: {
    summary?: string | null; // "2 new events"
    new_events?: number | null;
    new_facts?: number | null;
  } | null;
  summary?: string | null;
  new_events?: number | null;
  new_facts?: number | null;
  refreshing?: boolean | null; // a refresh is running now
}

export interface ContextStatus {
  last_refreshed_at: string | null;
  new_events: number | null;
  new_facts: number | null;
  change_summary: string | null; // "2 new events", "no changes"
  refreshing: boolean;
  /** Ready to show: "Context updated today 7:00 AM · 2 new events". */
  label: string;
}

export interface CrmMethods {
  getPeople(tab: Tab): Promise<PeoplePage>;
  setTab(personId: number, tab: Tab): Promise<void>;
  getEvents(): Promise<CrmEvent[]>;
  getEvent(id: number): Promise<CrmEventDetail>;
  getCommunityStats(): Promise<CommunityStats>;
  chat(history: ChatMessage[], text: string, context: ChatContext): Promise<ChatMessage>;
  approveSendBatch(
    batchId: string,
    approvedBy: string,
    perItem?: PerItemApproval,
  ): Promise<SendResult>;
  getContextStatus(): Promise<ContextStatus>;
  /** POST /context/refresh: re-read the Foundation's sources now. */
  refreshContext(): Promise<ContextStatus>;
}
