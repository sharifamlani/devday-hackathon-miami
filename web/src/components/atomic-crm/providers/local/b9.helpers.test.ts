import { QueryClient } from "@tanstack/react-query";

import { parseCampaignMessage } from "./campaigns";
import { parseSources } from "./contextSearch";
import { applyMessage, wsUrl } from "./dictation";
import { findMock } from "./endpoint";
import { parseTarget } from "./parse";
import { refetchAfterAgent, scopesForTool, SCOPE_KEYS } from "./refetch";
import "./mocks";

describe("refetch helper (§21.2.5: the UI refetches after agent writes)", () => {
  it("invalidates exactly the keys of the scopes a tool touched", async () => {
    const qc = new QueryClient();
    const spy = vi.spyOn(qc, "invalidateQueries");
    await refetchAfterAgent(qc, scopesForTool("create_task"));
    const keys = spy.mock.calls.map((c) => (c[0] as { queryKey: unknown[] }).queryKey);
    expect(keys).toEqual([...SCOPE_KEYS.tasks, ...SCOPE_KEYS.calendar, ...SCOPE_KEYS.summary]);
  });

  it("refetches everything with no scopes (e.g. after undo or an unknown tool)", async () => {
    const qc = new QueryClient();
    const spy = vi.spyOn(qc, "invalidateQueries");
    await refetchAfterAgent(qc, scopesForTool("something_new"));
    expect(spy).toHaveBeenCalledWith({ queryKey: ["donor-desk"] });
  });

  it("maps every B10 write tool to at least one scope", () => {
    for (const tool of ["log_gift", "save_call_note", "apply_after_call_actions", "accept_enrichment", "send"]) {
      expect(scopesForTool(tool)?.length).toBeGreaterThan(0);
    }
  });
});

describe("dictation protocol (WS /transcribe/live)", () => {
  it("builds the ws URL from the API URL and purpose", () => {
    expect(wsUrl("dictation")).toMatch(/^ws:\/\/.+\/transcribe\/live\?purpose=dictation$/);
    expect(wsUrl("call")).toMatch(/purpose=call$/);
  });

  it("folds interim, final and error messages", () => {
    let s = { interim: "", finals: [] as { text: string; at: number }[], error: null as string | null };
    s = applyMessage(s, { type: "interim", text: "Who gave" }, 0.5);
    expect(s.interim).toBe("Who gave");
    s = applyMessage(s, { type: "final", text: " Who gave last year? " }, 1.2);
    expect(s).toMatchObject({ interim: "", finals: [{ text: "Who gave last year?", at: 1.2 }] });
    s = applyMessage(s, { type: "final", text: "  " }, 1.5); // empty finals are dropped
    expect(s.finals).toHaveLength(1);
    s = applyMessage(s, { type: "error", detail: "relay down" }, 2);
    expect(s.error).toBe("relay down");
  });
});

describe("contract additions on existing types", () => {
  it("campaign drafts carry sources[] (C2), keeping only sourced items", () => {
    const msg = parseCampaignMessage({
      id: 1, campaign_id: 1, donor_id: 1, donor_name: "Maria", donor_type: "individual", tier: "mid",
      is_star: false, is_sample: false, needs_individual_approval: false, approval_reason: null,
      channel: "email", to: "m***@example.com", subject: "s", body: "b", facts_used: [], flags: [],
      drafted_by: "model", draft_note: null, status: "draft", approved_by: null, approved_via: null,
      approved_at: null, sent_at: null, why: null,
      sources: [
        { id: 41, kind: "success_story", title: "398 hours", text: "…", source_url: "https://example.org/a", posted_at: "2026-10-01" },
        { id: 42, kind: "org_health", title: "no url" },
      ],
    } as Parameters<typeof parseCampaignMessage>[0]);
    expect(msg.sources.map((s) => [s.id, s.kind])).toEqual([[41, "success_story"]]);
    expect(parseSources(undefined)).toEqual([]);
  });

  it("targets carry reached_today (B2), null until it lands", () => {
    const base = {
      period: "quarter" as const, label: "Q4 2026", start: "2026-10-01", end: "2026-12-31", as_of: "2026-11-08",
      goal: 150000, goal_is_sample: true, raised: 41250, percent: 27.5, days_left: 53, donors_count: 9,
      gifts_count: 11, by_channel: [], new_donors: 1, returning_donors: 8, give_miami_day: null, top_donor_ids: [],
    };
    expect(parseTarget({ ...base, reached_today: 3 } as unknown as Parameters<typeof parseTarget>[0]).reached_today).toBe(3);
    expect(parseTarget(base as unknown as Parameters<typeof parseTarget>[0]).reached_today).toBeNull();
  });

  it("has a mock for every §21.5 route", () => {
    const routes: [Parameters<typeof findMock>[0], string][] = [
      ["GET", "/interest-tags"], ["GET", "/people/1/interests"], ["POST", "/people/1/interests"],
      ["DELETE", "/people/1/interests/arts"], ["POST", "/enrich/1?dry_run=1"], ["POST", "/people/1/enrichment/accept"],
      ["GET", "/targets/quarters"], ["GET", "/home/summary"], ["GET", "/people/attention?limit=6"],
      ["GET", "/tasks"], ["POST", "/tasks"], ["PATCH", "/tasks/1"], ["DELETE", "/tasks/1"], ["POST", "/tasks/generate"],
      ["GET", "/calendar"], ["GET", "/artifacts"], ["POST", "/undo/abc"], ["POST", "/transcribe/file"],
      ["POST", "/people/1/call-notes"], ["GET", "/people/1/call-notes"], ["POST", "/call-notes/1/actions"],
      ["POST", "/call-notes/1/apply"], ["GET", "/people/1/pledges"], ["GET", "/context/search?q=x"],
    ];
    for (const [method, path] of routes) expect(findMock(method, path), `${method} ${path}`).not.toBeNull();
  });
});
