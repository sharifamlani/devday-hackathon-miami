import { useQueryClient, type QueryClient } from "@tanstack/react-query";

/**
 * After the main-UI agent writes something (plan.md §21.2.5: everything runs
 * through the agent), the screens refetch. The chat panel calls
 * useAgentRefetch()(scopes) with what the tool touched; no scopes = all.
 */
export type RefetchScope =
  | "tasks"
  | "calendar"
  | "people"
  | "targets"
  | "summary"
  | "context"
  | "artifacts"
  | "interests"
  | "call_notes"
  | "campaigns";

const ROOT = "donor-desk";

/** Query-key prefixes each scope covers (every key starts with ROOT). */
export const SCOPE_KEYS: Record<RefetchScope, readonly (readonly unknown[])[]> = {
  tasks: [[ROOT, "tasks"]],
  calendar: [[ROOT, "calendar"], [ROOT, "events"], [ROOT, "event"]],
  people: [
    [ROOT, "people"],
    [ROOT, "donors"],
    [ROOT, "donor"],
    [ROOT, "duplicates"],
    [ROOT, "people-attention"],
    [ROOT, "community-stats"],
  ],
  targets: [[ROOT, "targets"]],
  summary: [[ROOT, "home-summary"]],
  context: [[ROOT, "context"], [ROOT, "context-status"], [ROOT, "org-profile"]],
  artifacts: [[ROOT, "artifacts"]],
  interests: [[ROOT, "interests"], [ROOT, "interest-tags"]],
  // calls.ts (#78) keys its notes under ["donor-desk", "calls"].
  call_notes: [[ROOT, "calls"], [ROOT, "pledges"]],
  campaigns: [["campaigns"], [ROOT, "batch"]],
};

/** Which scopes each agent tool's write touches (plan.md §21.6.3 B10 tool names). */
export const TOOL_SCOPES: Record<string, RefetchScope[]> = {
  update_person: ["people", "summary"],
  add_contact: ["people", "summary"],
  add_interest: ["interests", "people"],
  remove_interest: ["interests", "people"],
  accept_enrichment: ["interests", "people"],
  log_gift: ["people", "targets", "summary"],
  merge_duplicate: ["people", "summary", "tasks", "calendar"],   // the generator retires/creates tasks (3a)
  dismiss_duplicate: ["people", "summary", "tasks", "calendar"],   // the generator retires/creates tasks (3a)
  add_event: ["calendar", "summary"],
  move_event: ["calendar", "summary"],
  delete_event: ["calendar", "summary"],
  add_calendar_item: ["calendar", "summary"],
  move_calendar_item: ["calendar", "summary"],
  delete_calendar_item: ["calendar", "summary"],
  rsvp_event: ["calendar", "summary"],
  create_task: ["tasks", "calendar", "summary"],
  update_task: ["tasks", "calendar", "summary"],
  complete_task: ["tasks", "calendar", "summary"],
  delete_task: ["tasks", "calendar", "summary"],
  save_call_note: ["call_notes", "artifacts", "summary", "targets"],
  apply_after_call_actions: ["tasks", "calendar", "interests", "call_notes", "context", "summary"],
  draft_email: ["campaigns", "artifacts"],   // a new campaign is a Files & drafts row
  draft_sms: ["campaigns", "artifacts"],
  send: ["campaigns", "artifacts", "targets", "summary"],
};

/** Non-hook form, for code that already holds the QueryClient. */
export const refetchAfterAgent = (queryClient: QueryClient, scopes?: RefetchScope[]) => {
  if (!scopes?.length) return queryClient.invalidateQueries({ queryKey: [ROOT] });
  const keys = scopes.flatMap((scope) => SCOPE_KEYS[scope]);
  return Promise.all(keys.map((queryKey) => queryClient.invalidateQueries({ queryKey })));
};

/** Scopes for a tool name; unknown or undo-like tools refetch everything. */
export const scopesForTool = (tool: string): RefetchScope[] | undefined => TOOL_SCOPES[tool];

/**
 * const refetch = useAgentRefetch();
 * refetch(["tasks", "calendar"]);        // after create_task
 * refetch(scopesForTool("log_gift"));    // by tool name
 * refetch();                             // everything (e.g. after undo)
 */
export const useAgentRefetch = () => {
  const queryClient = useQueryClient();
  return (scopes?: RefetchScope[]) => refetchAfterAgent(queryClient, scopes);
};
