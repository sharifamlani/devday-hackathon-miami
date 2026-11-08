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
  is_sample?: boolean | number | null; // gift history is invented sample data
  status: string | null;
  why: ApiWhy | null;
  score_as_of: string | null;
  contact_type?: string | null; // giver | neighbor | community (#60)
  auto_merged?: boolean | null; // an exact-match merge staff haven't reviewed (#125)
  merged_from?: number | null; // how many source records it joined
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

/** One item of GET /donors/{id} "merges": a merge into this donor. */
export interface ApiMergeLogEntry {
  id: number;
  kept_id: number;
  merged_id: number;
  merged_name: string;
  merged_email?: string | null;
  merged_emails?: string[] | null;
  gifts_moved?: number | null;
  merged_at: string;
  approved_by?: string | null;
  undone_at?: string | null;
  can_undo?: boolean | null;
}

/** GET /donors/{id} */
export interface ApiDonorDetail extends ApiDonorRow {
  gifts: ApiGift[];
  research_facts: ApiResearchFact[];
  outreach_drafts: ApiOutreachDraft[];
  // Absent on older servers and snapshots.
  merges?: ApiMergeLogEntry[] | null;
  // The donor's saved call notes, newest first (routes_calls.py); absent on
  // older servers, [] in the snapshot. Parsed leniently by parseApiCallNotes.
  call_notes?: unknown;
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
  merge_id?: number | null; // absent on servers that predate the merge log
}

/** POST /merges/{merge_id}/undo */
export interface ApiUndoMergeResult {
  kept_id: number;
  restored_id: number;
  donor?: ApiDonorRow | null;
  restored?: unknown;
}

/** web/public/snapshot.json */
export interface ApiSnapshot {
  meta: {
    as_of: string | null;
    generated_at: string;
    label: string;
    donor_count: number;
    source: string;
    // Which donors the ids stand for (export_snapshot.snapshot_id); absent
    // on older snapshots. Browser-saved notes are tied to it.
    snapshot_id?: string;
  };
  donors: ApiDonorRow[];
  donor_details: Record<string, ApiDonorDetail>;
  duplicates: ApiDuplicate[];
  // Added with ICP + prospects (PR #15); older snapshots omit them.
  icp?: ApiIcpProfile | null;
  prospects?: ApiProspect[]; // == GET /prospects (no drafts, dismissed excluded)
  prospect_details?: Record<string, ApiProspect>; // == GET /prospects/{id}
  context?: ApiContext | null; // == GET /context (§15)
  org_profile?: ApiOrgProfile | null; // == GET /org-profile, if exported separately
  targets?: ApiTargets | null; // == GET /targets (issue #37); older snapshots omit it
}

/*
 * ICP + prospects (docs/briefs/icp-and-prospects.md). The JSON columns are
 * not pinned down yet, so their element types are loose here and parse.ts
 * accepts the reasonable shapes (list or key→value map, string or parsed).
 */

export type ApiJson<T> = T | string | null | undefined;

export interface ApiEvidence {
  donor?: string | null;
  donor_name?: string | null;
  donor_id?: number | null;
  fact?: string;
  url?: string;
  source_url?: string;
}

/** GET /icp (icp_profile row). 42's trait shape:
 *  {trait, value, evidence: [{donor, donor_id?, fact, url}]} */
export interface ApiIcpProfile {
  id: number;
  traits: ApiJson<unknown>;
  stats: ApiJson<unknown>;
  evidence: ApiJson<ApiEvidence[]>;
  /** Newest org context facts the ICP leaned on: {source, url, posted_at, fact} */
  recent_context?: ApiJson<ApiContextFactLite[]>;
  created_at: string;
}

export interface ApiContextFactLite {
  source?: string;
  url?: string;
  source_url?: string;
  posted_at?: string | null;
  fact?: string;
}

/** One item of GET /prospects (prospects row) */
export interface ApiProspect {
  id: number;
  name: string;
  org_type: string | null;
  city: string | null;
  fit_score: number | null;
  matched_traits: ApiJson<unknown[]>;
  facts: ApiJson<{ fact: string; url?: string; source_url?: string }[]>;
  priority: string | null;
  status: string;
  created_at: string;
  /** Why it scored what it did: {component: points}, summing to fit_score */
  fit_breakdown?: ApiJson<Record<string, number>>;
  /** Org context facts this prospect lines up with */
  matched_context?: ApiJson<ApiContextFactLite[]>;
  /** GET /prospects/{id}: drafts with prospect_id = id, newest first */
  outreach_drafts?: ApiOutreachDraft[];
}

/*
 * Onboarding (plan.md §15): upload → POST /ingest (Carlos), and the local
 * context dataset (org_profile + org_context). Routes are not built yet, so
 * these shapes follow §15 and parse.ts accepts the reasonable variants.
 */

export interface ApiOrgProfile {
  id?: number;
  name: string | null;
  website: string | null;
  x_url: string | null;
  linkedin_url: string | null;
  instagram_url: string | null;
  priorities?: ApiJson<unknown>;
  voice?: ApiJson<unknown>;
  updated_at?: string | null;
}

/** One org_context row: a dated, sourced fact about the organization. */
export interface ApiContextFact {
  id: number;
  source: string; // website | x | linkedin | instagram | news
  url: string;
  posted_at: string | null;
  fact: string;
  quote?: string | null;
  priority?: string | null;
  captured_at?: string | null;
}

/** GET /context, and the snapshot's "context" key. */
export type ApiContext =
  | ApiContextFact[]
  | {
      profile?: ApiOrgProfile | null;
      org_profile?: ApiOrgProfile | null;
      facts?: ApiContextFact[];
      org_context?: ApiContextFact[];
      items?: ApiContextFact[];
      cached?: boolean;
      captured_at?: string | null;
    };

/** POST /context/run (PR #21): synchronous, at most 30 s, always 200
 *  (503 until the context module lands). */
export interface ApiContextRun {
  state: string; // done | failed
  // live: refresh=true read the site · cache: refresh=false, served from the
  // cache by request · fallback: the live read failed or timed out (9c7c6d0)
  served_from?: "live" | "cache" | "fallback";
  cached: boolean; // true only on fallback
  detail: string | null;
  started_at?: string | null;
  finished_at?: string | null;
  // website | news | x | linkedin | instagram
  sources: Record<string, ApiContextRunSource>;
  profile?: ApiOrgProfile | null;
  facts?: ApiContextFact[];
  saved?: {
    org_profile_id: number;
    context_ids: number[];
    replaced_sources: string[];
  } | null;
}

export interface ApiContextRunSource {
  // done | blocked | failed | not provided | saved, not connected
  status: string;
  facts?: number;
  detail?: string | null; // block reason, or the saved URL for socials
}

/* ---------- Donation targets (issue #37, service/targets.py) ---------- */

/** One period of GET /targets?period=month|quarter. Goals are SAMPLE values. */
export interface ApiTarget {
  period: "month" | "quarter";
  reached_today?: number | null; // plan.md §21.5 (B2): people contacted today
  label: string; // "November 2026", "Q4 2026"
  start: string; // YYYY-MM-DD
  end: string;
  as_of: string;
  goal: number | null;
  goal_is_sample?: boolean;
  raised: number;
  percent: number | null;
  days_left: number;
  donors_count: number;
  gifts_count: number;
  by_channel: { channel: string; amount: number }[];
  new_vs_returning: {
    new: number;
    returning: number;
    new_amount?: number;
    returning_amount?: number;
  };
  give_miami_day: {
    date: string;
    days_until: number;
    in_period?: boolean;
  } | null;
  top_donor_ids: number[];
  donor_ids?: number[]; // every donor who gave in the period, biggest first
}

/** GET /targets with no period: both. */
export type ApiTargets = Partial<Record<"month" | "quarter", ApiTarget>>;
