import type { CampaignMethods } from "./campaignTypes";

export type * from "./campaignTypes";
import type { AskAnswer, AskFilter, AskIntent } from "./ask";
import type { CallNote } from "../../voice/callNotes";

/**
 * The view model the Donor Desk screens render. parse.ts builds it from the
 * API shapes in apiTypes.ts. Every number here comes from score.py; the UI
 * never computes a score.
 */

export type DonorType = "individual" | "organization";
export type Tier = "big" | "mid" | "small";
/** donor_scores.status, written by score.py */
export type DonorStatus =
  "lapsing" | "due" | "on_track" | "lapsed" | "no_gifts";

export interface Gift {
  id: number;
  amount: number;
  gift_date: string; // ISO YYYY-MM-DD
  channel: string | null;
  fund_type: string | null;
  /** "ok", or "declined"/"failed": a charge kept on record that is never a gift. */
  status?: string | null;
}

export interface DonorSummary {
  id: number;
  full_name: string;
  org_name: string | null;
  donor_type: DonorType;
  email: string | null;
  city: string | null;
  fund_type: string | null;
  tier: Tier;
  is_star: boolean;
  is_sample: boolean;
  score: number;
  status: DonorStatus;
  why_short: string;
  last_gift_date: string | null;
  last_gift_amount: number | null;
  usual_cadence: string | null; // "yearly · Nov", "quarterly", ...
  gift_count: number;
  total_given: number;
  give_miami_day_days_away: number | null;
  /** Which CRM tab the person is in; null when the API doesn't say (older builds). */
  contact_type?: "giver" | "neighbor" | "community" | null;
  /** An automatic merge waiting for staff review (#125); absent on older APIs. */
  auto_merged?: boolean;
  /** The giver's next open task ("Call Hye-jin Park · Nov 12"); null with none, and for other tabs. */
  next_step?: string | null;
  merged_from?: number;
}

/** One of score.py's four point buckets (they sum to the score). */
export interface ScoreFactor {
  label: string;
  points: number;
  max: number;
  detail: string;
}

export interface ResearchFact {
  id: number;
  fact: string;
  source_url: string;
  retrieved_at: string;
}

export interface FactUsed {
  fact: string;
  source_url: string;
}

export interface OutreachDraft {
  id: number;
  channel: string | null;
  subject: string | null;
  body: string;
  call_script: string | null;
  facts_used: FactUsed[];
  status: string; // draft | ready | approved | sent
  approved_by: string | null;
  approved_at: string | null;
}

export interface DonorDetail extends DonorSummary {
  phone: string | null;
  notes: string | null;
  why: string; // sentence built from score.py's why JSON
  score_factors: ScoreFactor[];
  gifts: Gift[];
  research: ResearchFact[];
  merges: MergeLogEntry[]; // merges into this donor, newest first ([] if none)
  draft: OutreachDraft | null; // newest outreach_drafts row
  call_notes: CallNote[]; // the service's saved call notes, newest first ([] if none)
}

export interface DuplicateDonor {
  id: number;
  full_name: string;
  email: string | null;
  city: string | null;
  gift_count: number;
  total_given: number;
}

export interface DuplicatePair {
  id: number;
  reasons: string[];
  confidence: number;
  donors: [DuplicateDonor, DuplicateDonor];
}

/** A claim behind an ICP trait: which donor, what fact, which page. */
export interface IcpEvidence {
  donor: string | null;
  fact: string;
  source_url: string;
}

/** One trait of the ideal donor profile, e.g. "Causes funded". */
export interface IcpTrait {
  label: string;
  value: string;
  evidence: IcpEvidence[];
}

/** A deterministic number from Python, e.g. "Median gift" → "$50,000". */
export interface IcpStat {
  label: string;
  value: string;
}

export interface IcpProfile {
  id: number;
  created_at: string;
  traits: IcpTrait[];
  stats: IcpStat[];
  evidence: IcpEvidence[]; // profile-level evidence not tied to one trait
  recent_context: DatedFact[]; // newest org facts the ICP leaned on
}

/** A sourced, dated fact (org context matched to an ICP or a prospect). */
export interface DatedFact {
  source: string | null; // "website", ...
  fact: string;
  source_url: string;
  posted_at: string | null;
}

/** One component of a prospect's fit score, e.g. Geography 12. */
export interface FitComponent {
  label: string;
  points: number;
}

export type ProspectStatus = "new" | "drafted" | "dismissed";

export interface ProspectSummary {
  id: number;
  name: string;
  org_type: string | null; // "company", "foundation", ...
  city: string | null;
  fit_score: number; // 0-100, computed in Python from matched traits
  matched_traits: string[];
  priority: string | null; // the Foundation priority it fits
  status: ProspectStatus;
  facts: FactUsed[]; // sourced facts, every one with a URL
  fit_breakdown: FitComponent[]; // biggest first; sums to fit_score
  matched_context: DatedFact[]; // org facts this prospect lines up with
}

export interface ProspectDetail extends ProspectSummary {
  created_at: string;
  draft: OutreachDraft | null; // newest first-touch draft (always "draft")
}

/* ---------- Onboarding (plan.md §15) ---------- */

export type SocialPlatform = "x" | "linkedin" | "instagram";

/** A social URL the org entered. Only the website is researched for now. */
export interface SocialLink {
  platform: SocialPlatform;
  label: string; // "X", "LinkedIn", "Instagram"
  url: string;
  connected: boolean; // false today: "saved, not connected"
  status: string; // "saved, not connected"
}

export interface OrgProfile {
  name: string | null;
  website: string | null;
  socials: SocialLink[]; // only the ones the org entered
  priorities: string[];
  voice: string[]; // tone notes for the outreach agent
  updated_at: string | null;
}

export interface ContextFact {
  id: number;
  source: string; // "website" (only one researched today), "news", ...
  source_url: string;
  posted_at: string | null; // YYYY-MM-DD
  fact: string;
  quote: string | null; // the exact words the fact was verified against
  priority: string | null; // which Foundation priority it supports
  kind?: string | null; // success_story | use_of_funds | org_health | program_update | ...
  title?: string | null; // the fact's short headline
}

export interface OrgContext {
  profile: OrgProfile | null;
  facts: ContextFact[]; // newest first
  cached: boolean; // from the last successful run or the snapshot
}

export interface ContextRunInput {
  website: string | null;
  x_url?: string | null;
  linkedin_url?: string | null;
  instagram_url?: string | null;
  refresh?: boolean; // re-read even if a recent run is saved
}

export type SourceState =
  "done" | "blocked" | "failed" | "not_provided" | "saved_not_connected"; // social URLs: saved, never fetched (scope cut)

export interface ContextRunSource {
  source: string; // "website", "news", "x", "linkedin", "instagram"
  label: string; // "Website", "News", "X", "LinkedIn", "Instagram"
  state: SourceState;
  status_text: string; // the API's words, e.g. "saved, not connected"
  fact_count: number;
  detail: string | null; // block reason, or the saved URL for socials
}

export interface ContextRun {
  status: "done" | "failed";
  // Drive the UI from this: "fallback" → show "Showing saved context" with
  // detail as a tooltip. "cache" is a normal, requested cache read.
  served_from: "live" | "cache" | "fallback";
  cached: boolean; // true only when served_from is "fallback"
  detail: string | null; // why, for a tooltip
  sources: ContextRunSource[]; // website and news first, then socials
  profile: OrgProfile | null;
  facts: ContextFact[]; // newest first
  finished_at: string | null;
}

/** What POST /ingest reports. Carlos owns the route; fields are optional. */
export interface IngestResult {
  donors: number | null;
  gifts: number | null;
  duplicates: number | null;
  message: string | null;
  raw: unknown; // the full response, for anything not mapped yet
}

export interface MergeResult {
  kept_id: number;
  merged_id: number;
  /** merge_log row for this merge; pass to undoMerge. null if the server predates the log. */
  merge_id: number | null;
}

/**
 * One merge into this donor, newest first on DonorDetail.merges. The merged
 * record is kept whole in the log (GET /donors/{id} "merges"), so nothing is
 * lost and the merge can be undone.
 */
export interface MergeLogEntry {
  id: number;
  kept_id: number;
  merged_id: number;
  merged_name: string;
  merged_email: string | null;
  merged_emails: string[]; // every email the merged record carried
  gifts_moved: number;
  merged_at: string; // ISO timestamp
  approved_by: string | null;
  undone_at: string | null;
  /** true only for the newest merge into this donor that has not been undone */
  can_undo: boolean;
}

export interface UndoMergeResult {
  kept_id: number;
  restored_id: number;
}

/** One gift parsed from an uploaded list, in the ingest contract's shape (plan §13). */
export interface ImportedGift {
  amount: number;
  gift_date: string; // YYYY-MM-DD
  channel: string | null;
  fund_type: string | null;
}

/** One donor parsed from an uploaded list, in the ingest contract's shape (plan §13). */
export interface ImportedDonorRow {
  full_name: string;
  first_name: string | null;
  last_name: string | null;
  org_name: string | null;
  donor_type: DonorType;
  email: string | null;
  phone: string | null;
  city: string | null;
  state: string | null;
  notes: string | null; // unmapped columns, verbatim
  source_row: string; // "<file name>#<row number>"
  gifts: ImportedGift[];
}

/** contract field -> source column header (null = not mapped) */
export type ImportMapping = Record<string, string | null>;

export interface ImportInput {
  files: File[];
  mapping: ImportMapping;
  rows: ImportedDonorRow[];
}

/* ---------- Donation targets (issue #37) ---------- */

export type TargetPeriod = "month" | "quarter";

/** Raised vs. goal for one calendar month or quarter. Every number comes
 *  from service/targets.py; goals are SAMPLE values from org_config.json. */
export interface DonationTarget {
  period: TargetPeriod;
  label: string; // "November 2026", "Q4 2026"
  start: string; // YYYY-MM-DD
  end: string;
  as_of: string;
  goal: number | null; // null when no goal is configured
  goal_is_sample: boolean;
  raised: number;
  percent: number | null; // of goal, one decimal; null without a goal
  days_left: number;
  donors_count: number;
  gifts_count: number;
  by_channel: { channel: string; amount: number }[]; // biggest first
  new_donors: number; // first gift ever fell in this period
  returning_donors: number;
  new_amount: number | null;
  returning_amount: number | null;
  give_miami_day: {
    date: string;
    days_until: number;
    in_period: boolean;
  } | null; // null once it has passed this year
  top_donor_ids: number[];
  donor_ids: number[]; // everyone who gave in the period, biggest first
  /** Distinct people contacted today (outbox + call notes); null until B2 lands. */
  reached_today: number | null;
}

import type { CrmMethods, UploadTarget } from "./crmTypes";

/** GET /targets: one entry per period the service returned. */
export type TargetsByPeriod = Partial<Record<TargetPeriod, DonationTarget>>;

/**
 * Donor Desk methods, added to the ra-core data provider as custom methods.
 * Writes resolve when the server is done; screens then refetch GET
 * /donors/{id}, so they never depend on a POST's response body.
 */
export interface DonorDeskMethods extends CampaignMethods, CrmMethods {
  getDonors(): Promise<DonorSummary[]>;
  getDonor(id: number): Promise<DonorDetail>;
  getDuplicates(): Promise<DuplicatePair[]>;
  mergeDuplicate(pairId: number, keepId: number): Promise<MergeResult>;
  dismissDuplicate(pairId: number): Promise<void>;
  enrichDonor(id: number): Promise<void>;
  draftOutreach(id: number): Promise<void>;
  /** Any outreach_drafts row, donor or prospect. */
  approveDraft(draftId: number, body: string): Promise<void>;
  /** null until the ICP has been built. */
  getIcp(): Promise<IcpProfile | null>;
  runIcp(): Promise<void>;
  getProspects(): Promise<ProspectSummary[]>; // highest fit first
  getProspect(id: number): Promise<ProspectDetail>;
  draftProspectOutreach(id: number): Promise<void>;
  dismissProspect(id: number): Promise<void>;
  /** Screen 1: multipart POST /ingest with every file under "files" and the
   *  tab under "target" (default "auto": the agent sorts, plan.md §17). */
  uploadFiles(files: File[], target?: UploadTarget): Promise<IngestResult>;
  /** Import dialog. Live: uploadFiles(files) to Carlos's /ingest, which maps
   *  columns itself. Snapshot: adds the parsed rows to this tab's data and
   *  flags duplicates by email or phone. */
  importDonors(input: ImportInput): Promise<IngestResult>;
  /** POST /merges/{mergeId}/undo: restores the merged donor exactly as it was. */
  undoMerge(mergeId: number): Promise<UndoMergeResult>;
  /** Screen 2: saves the URLs and researches the website. One call,
   *  up to 30 s; the result includes the saved profile and facts. */
  runContext(input: ContextRunInput): Promise<ContextRun>;
  getContext(): Promise<OrgContext>;
  /** null until the org has entered its URLs. */
  getOrgProfile(): Promise<OrgProfile | null>;
  /** "Cached sample" in snapshot mode; null when live. */
  getSourceLabel(): Promise<string | null>;
  /** Raised vs. SAMPLE goal; both periods when period is omitted. Empty
   *  ({}) for a snapshot exported before targets existed. */
  getTargets(period?: TargetPeriod): Promise<TargetsByPeriod>;

  /** Ask Donor Desk (ask.ts): question → read-only filter → matching donors.
   *  Pass `filter` (chip-edited) to skip the model and re-run it as given. */
  ask(
    question: string,
    filter?: AskFilter | null,
    intent?: AskIntent | null,
  ): Promise<AskAnswer>;
}

/** What httpClient/snapshotClient implement; the CRM methods live in crm*.ts. */
export type BaseDonorDeskMethods = Omit<DonorDeskMethods, keyof CrmMethods>;
