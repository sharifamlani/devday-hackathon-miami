import { useQuery } from "@tanstack/react-query";

import { call, qs } from "./endpoint";

/* plan.md §21.5: home summary, people attention, target quarters (owner 48, B2 + B13). */

/** GET /home/summary: "Today at a glance" and the chat's suggestion chips. */
export interface HomeSummary {
  gifts_at_risk: number;
  duplicates: number;
  tasks_today: number;
  next_event: { title: string; date: string; days: number } | null;
  reached_today: number; // distinct people contacted today
  suggestions: string[]; // chips, e.g. "Who's late on a usual gift?"
}

/** Badge from alerts and gift history (docs/ui-integration.md §1 row 8). */
// The service sends "failed" for a failed card payment; "card_failed" is accepted too.
export type AttentionBadge = "failed" | "card_failed" | "late" | "new" | "thanked" | "not_yet" | (string & {});

export interface AttentionPerson {
  id: number;
  name: string;
  initials: string;
  line: string; // one line of context
  badge: AttentionBadge;
}

export interface QuarterRaised {
  label: string; // "Q4 2026"
  start: string;
  end: string;
  raised: number;
}

/** GET /targets/quarters?as_of= */
export interface TargetQuarters {
  quarters: QuarterRaised[];
  ytd: { year: number; raised: number };
}

export const homeKeys = {
  summary: ["donor-desk", "home-summary"] as const,
  attention: (limit: number) => ["donor-desk", "people-attention", limit] as const,
  quarters: (asOf?: string) => ["donor-desk", "targets", "quarters", asOf ?? "today"] as const,
};

/* ---------- API ---------- */

export const getHomeSummary = () =>
  call<HomeSummary | null>("Today at a glance", "GET", "/home/summary", {
    snapshotValue: null,
    snapshot: (s) => s.home_summary as HomeSummary | undefined,
  });

export const getPeopleAttention = (limit = 6) =>
  call<AttentionPerson[]>("The attention list", "GET", `/people/attention${qs({ limit })}`, {
    snapshotValue: [],
    snapshot: (s) => (s.people_attention as AttentionPerson[] | undefined)?.slice(0, limit),
  });

export const getTargetQuarters = (asOf?: string) =>
  call<TargetQuarters | null>("Quarter totals", "GET", `/targets/quarters${qs({ as_of: asOf })}`, {
    snapshotValue: null,
    snapshot: (s) => s.target_quarters as TargetQuarters | undefined,
  });

/* ---------- Hooks ---------- */

/** In the snapshot build: home_summary from snapshot.json (null if an older export lacks it). */
export const useHomeSummary = () => useQuery({ queryKey: homeKeys.summary, queryFn: getHomeSummary });

export const usePeopleAttention = (limit = 6) =>
  useQuery({ queryKey: homeKeys.attention(limit), queryFn: () => getPeopleAttention(limit) });

export const useTargetQuarters = (asOf?: string) =>
  useQuery({ queryKey: homeKeys.quarters(asOf), queryFn: () => getTargetQuarters(asOf) });
