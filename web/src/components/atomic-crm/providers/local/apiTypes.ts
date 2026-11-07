/**
 * Raw shapes returned by the local Python API (service/routes_data.py) and
 * written by `python -m service.export_snapshot`. parse.ts turns them into
 * the view model in types.ts; both data modes go through that one parser.
 */

export interface ApiWhy {
  status: string;
  reasons: string[];
  as_of: string;
  gift_count: number;
  // Absent for a donor with no gifts:
  points?: {
    urgency: number;
    value: number;
    frequency: number;
    engagement: number;
  };
  lifetime_total?: number;
  largest_gift?: number;
  last_gift?: { date: string; amount: number; channel: string | null };
  days_since_last_gift?: number;
  usual_cadence_days?: number;
  cadence_basis?: "median_interval" | "assumed_yearly" | string;
  overdue_ratio?: number;
  gave_this_year?: boolean;
  pattern?: {
    month: number;
    month_name: string;
    channel: string | null;
    years: number[];
    gave_this_year: boolean;
  } | null;
  days_left_in_year?: number;
  give_miami_day?: { date: string; days_away: number } | null;
}

/** One row of GET /donors (a donor joined with its donor_scores row). */
export interface ApiDonorRow {
  id: number;
  full_name: string;
  first_name: string | null;
  last_name: string | null;
  org_name: string | null;
  donor_type: "individual" | "organization" | null;
  email: string | null;
  emails_all: string[];
  phone: string | null;
  city: string | null;
  state: string | null;
  fund_type: string | null;
  notes: string | null;
  score: number | null;
  tier: "big" | "mid" | "small" | null;
  is_star: boolean;
  status: string | null;
  why: ApiWhy | null;
  score_as_of: string | null;
}

export interface ApiGift {
  id: number;
  donor_id: number;
  amount: number;
  gift_date: string;
  channel: string | null;
  fund_type: string | null;
}

export interface ApiResearchFact {
  id: number;
  donor_id: number;
  fact: string;
  source_url: string;
  retrieved_at: string;
  agent_run_id: string | null;
}

export interface ApiOutreachDraft {
  id: number;
  donor_id: number;
  channel: string | null;
  subject: string | null;
  body: string;
  status: string;
  approved_by: string | null;
  approved_at: string | null;
  created_at: string;
  // Written by outreach_agent.py; not columns in service/db.py yet.
  call_script?: string | null;
  facts_used?:
    | string
    | { fact: string; url?: string; source_url?: string }[]
    | null;
}

/** GET /donors/{id} */
export interface ApiDonorDetail extends ApiDonorRow {
  gifts: ApiGift[];
  research_facts: ApiResearchFact[];
  outreach_drafts: ApiOutreachDraft[];
}

/** One item of GET /duplicates */
export interface ApiDuplicate {
  id: number;
  donor_a_id: number;
  donor_b_id: number;
  reasons: string[];
  confidence: number;
  status: string;
  donor_a: ApiDonorRow | null;
  donor_b: ApiDonorRow | null;
  donor_a_gift_count: number;
  donor_b_gift_count: number;
}

/** POST /duplicates/{id}/merge */
export interface ApiMergeResult {
  kept_donor_id: number;
  removed_donor_id: number;
}

/** web/public/snapshot.json */
export interface ApiSnapshot {
  meta: {
    as_of: string | null;
    generated_at: string;
    label: string;
    donor_count: number;
    source: string;
  };
  donors: ApiDonorRow[];
  donor_details: Record<string, ApiDonorDetail>;
  duplicates: ApiDuplicate[];
}
