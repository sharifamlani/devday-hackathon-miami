/**
 * Response shapes of the local Python API (service/main.py), as the UI reads
 * them. Donor and gift fields follow the plan.md §13 contract; the rest
 * (score, why, research, drafts) come from score.py, enrich_agent.py and
 * outreach_agent.py. A snapshot file is the same data in one JSON document.
 */

export type DonorType = "individual" | "organization";
export type Tier = "big" | "mid" | "small";
/** Written by score.py. The UI only displays it. */
export type DonorStatus = "lapsing" | "overdue" | "due soon" | "on track";

export interface Gift {
  id: number;
  donor_id: number;
  amount: number;
  gift_date: string; // ISO YYYY-MM-DD
  channel: string | null;
  fund_type: string | null;
}

/** One row of GET /donors: a §13 donor plus its donor_scores row. */
export interface DonorSummary {
  id: number;
  full_name: string;
  org_name: string | null;
  donor_type: DonorType;
  email: string | null;
  city: string | null;
  state: string | null;
  fund_type: string | null;
  tier: Tier;
  is_star: boolean;
  score: number; // 0-100, computed in Python, never by the model
  status: DonorStatus;
  why_short: string; // e.g. "no gift yet in 2026"
  last_gift_date: string | null;
  last_gift_amount: number | null;
  usual_cadence: string | null; // e.g. "yearly · Dec"
  gift_count: number;
  total_given: number;
}

/** The deterministic inputs behind the score, shown next to the explanation. */
export interface ScoreFactor {
  label: string; // "Recency", "Frequency", "Amount", "Gap vs. usual cadence"
  value: string; // "312 days", "5 gifts in 5 yrs", ...
}

export interface ResearchFact {
  id: number;
  fact: string;
  source_url: string;
  retrieved_at: string; // ISO timestamp
}

export interface FactUsed {
  fact: string;
  source_url: string;
}

export type DraftStatus = "draft" | "approved" | "sent";

export interface OutreachDraft {
  id: number;
  donor_id: number;
  channel: "email";
  subject: string;
  body: string;
  facts_used: FactUsed[];
  status: DraftStatus;
  approved_by: string | null;
  approved_at: string | null;
}

/** GET /donors/{id} */
export interface DonorDetail extends DonorSummary {
  phone: string | null;
  notes: string | null;
  why: string; // plain-words explanation the model writes from the factors
  score_factors: ScoreFactor[];
  gifts: Gift[];
  research: ResearchFact[];
  draft: OutreachDraft | null;
}

export interface DuplicateDonor {
  id: number;
  full_name: string;
  email: string | null;
  city: string | null;
  gift_count: number;
  total_given: number;
}

/** One row of GET /duplicates (from duplicate_suggestions). */
export interface DuplicatePair {
  id: number;
  reason: string; // e.g. "same email", "similar name + same city"
  donors: [DuplicateDonor, DuplicateDonor];
}

export interface MergeResult {
  kept_id: number;
  merged_id: number;
}

/** The static export used when VITE_DATA_MODE=snapshot. */
export interface Snapshot {
  generated_at: string;
  donors: DonorDetail[];
  duplicates: DuplicatePair[];
}

/** Donor Desk methods, added to the ra-core data provider as custom methods. */
export interface DonorDeskMethods {
  getDonors(): Promise<DonorSummary[]>;
  getDonor(id: number): Promise<DonorDetail>;
  getDuplicates(): Promise<DuplicatePair[]>;
  mergeDuplicate(pairId: number, keepId: number): Promise<MergeResult>;
  enrichDonor(id: number): Promise<ResearchFact[]>;
  draftOutreach(id: number): Promise<OutreachDraft>;
  approveDraft(id: number, body: string): Promise<OutreachDraft>;
}
