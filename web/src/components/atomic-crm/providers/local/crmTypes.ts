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
  tags?: ApiJson<string[]>; // proposed name; PR #60 sends `interests`
  interests?: ApiJson<string[]>; // e.g. ["dogs", "arts"]
  has_dog?: boolean | null; // PR #60: true / false / null (not recorded)
  // Community: what the nonprofit recorded. PR #60: {field: {value, source_row}};
  // a field that wasn't recorded is absent. programs may be a list.
  demographics?: ApiJson<Record<string, unknown>>;
  is_sample?: boolean | null;
  // Givers only (from donor_scores)
  score?: number | null;
  tier?: string | null;
  is_star?: boolean | number | null;
  status?: string | null;
  last_touch?: string | null; // ISO date of the last gift, visit or message
  next_step?: string | null; // suggested by the agent
  needs_review?: boolean | number | null; // proposed; PR #60 sends tab_review
  review_reason?: string | null;
  tab_review?: string | null; // PR #60: null, or why the sort needs a person
}

/** GET /people?type=X: a list, or {items|people, counts}. */
export type ApiPeopleResponse =
  | ApiPerson[]
  | {
      items?: ApiPerson[];
      people?: ApiPerson[];
      counts?: Partial<Record<string, number>>; // PR #60 adds needs_review
      type?: string | null;
    };

export interface ApiEvent {
  id: number;
  title: string;
  starts_at: string; // ISO date or datetime
  ends_at?: string | null;
  place?: string | null;
  audience?: string | null; // "Givers, lapsing first"
  audience_label?: string | null;
  audience_hint?: string | null; // PR #60's name
  status?: string | null; // upcoming | changed | past
  event_kind?: string | null; // e.g. "donor", "community", "dog"
  rationale?: string | null; // why this audience
  batch_id?: number | string | null; // the event's pending send batch, once planned
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
  prospect_id?: number | null; // a first-touch draft to a prospect organization
  full_name?: string | null;
  name?: string | null;
  contact_type?: string | null;
  channel?: string | null; // email | text
  to?: string | null; // masked address
  subject?: string | null;
  body: string;
  sms?: string | null; // PR #60 event drafts: the text-message version
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

/** GET /campaigns/{id}: a send batch as routes_campaigns stores it. */
export interface ApiCampaign {
  id: number;
  name?: string | null;
  channel?: string | null;
  counts?: ApiSendBatch["counts"];
  messages: (Omit<ApiSendItem, "person_id" | "full_name"> & {
    donor_id?: number | null;
    donor_name?: string | null;
  })[];
}

/** POST /events/{id}/plan (proposed): pre-drafts the invites as a batch. */
export interface ApiPlanResult {
  batch_id: number | string;
  counts?: ApiSendBatch["counts"];
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
  args?: unknown; // the tool's arguments (PR #58); not shown
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
  /** Server-computed (PR #58); preferred over counting items. */
  counts?: {
    total?: number;
    draft?: number;
    needs_individual_approval?: number;
    flagged?: number;
    bulk_approvable?: number;
  } | null;
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
  tags: string[]; // interests
  has_dog: boolean | null; // null = not recorded
  /** Community: every field, with "not recorded" for anything missing. */
  demographics: { label: string; value: string }[];
  is_sample: boolean;
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
  needs_review: number; // people flagged for review (whole CRM when reported)
}

export interface CrmEvent {
  id: number;
  title: string;
  starts_at: string;
  ends_at: string | null;
  place: string | null;
  audience: string | null;
  status: string | null; // upcoming | changed | past
  kind: string | null;
  rationale: string | null; // why this audience
  batch_id: string | null; // open this batch in the chat panel ("Review")
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

export interface PlanResult {
  batch_id: string; // pass to getSendBatch / the chat panel
  bulk_approvable: number | null;
  needs_individual_approval: number | null;
  flagged: number | null;
  total: number | null;
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
  // PR #60: the newest context_refresh_log row
  last_run?: {
    started_at?: string | null;
    finished_at?: string | null;
    sources_read?: Record<string, string>;
    facts_added?: number;
    events_added?: number;
    events_changed?: number;
    errors?: string[];
  } | null;
}

export interface ContextStatus {
  last_refreshed_at: string | null;
  new_events: number | null;
  changed_events: number | null;
  new_facts: number | null;
  errors: string[]; // sources that couldn't be read on the last run
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
  /** POST /events/{id}/plan: draft the event's invites as a send batch. */
  planEventOutreach(eventId: number): Promise<PlanResult>;
  /** GET /campaigns/{id}: load a send batch, e.g. an event's, for review. */
  getSendBatch(batchId: string): Promise<SendBatch>;
  /** POST /context/refresh: re-read the Foundation's sources now. */
  refreshContext(): Promise<ContextStatus>;
}
