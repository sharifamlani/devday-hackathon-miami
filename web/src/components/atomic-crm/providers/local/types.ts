/**
 * The view model the Donor Desk screens render. parse.ts builds it from the
 * API shapes in apiTypes.ts. Every number here comes from score.py; the UI
 * never computes a score.
 */

export type DonorType = "individual" | "organization";
export type Tier = "big" | "mid" | "small";
/** donor_scores.status, written by score.py */
export type DonorStatus = "lapsing" | "due" | "on_track" | "lapsed" | "no_gifts";

export interface Gift {
  id: number;
  amount: number;
  gift_date: string; // ISO YYYY-MM-DD
  channel: string | null;
  fund_type: string | null;
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
  draft: OutreachDraft | null; // newest outreach_drafts row
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

export interface MergeResult {
  kept_id: number;
  merged_id: number;
}

/**
 * Donor Desk methods, added to the ra-core data provider as custom methods.
 * Writes resolve when the server is done; screens then refetch GET
 * /donors/{id}, so they never depend on a POST's response body.
 */
export interface DonorDeskMethods {
  getDonors(): Promise<DonorSummary[]>;
  getDonor(id: number): Promise<DonorDetail>;
  getDuplicates(): Promise<DuplicatePair[]>;
  mergeDuplicate(pairId: number, keepId: number): Promise<MergeResult>;
  dismissDuplicate(pairId: number): Promise<void>;
  enrichDonor(id: number): Promise<void>;
  draftOutreach(id: number): Promise<void>;
  /** id: the donor (snapshot lookup); draftId: the outreach_drafts row. */
  approveDraft(id: number, draftId: number, body: string): Promise<void>;
  /** "Cached sample" in snapshot mode; null when live. */
  getSourceLabel(): Promise<string | null>;
}
