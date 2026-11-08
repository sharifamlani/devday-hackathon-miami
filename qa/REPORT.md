# QA report: running scorecard against plan.md §9

Graded by the QA session (not a builder). Re-run: from a checkout with every open feature branch merged,
`python qa/integration_check.py` (exit 0 = all checks pass).

## Round 1: Sat 2026-11-07, main 7ba085e + feat/data 9e540b3 + feat/enrich 9ded6fb + feat/outreach d3298da

Merge: no conflicts. `pytest service/tests`: 27 passed. Integration script: 27/30 PASS.

| Criterion (§9) | Result | Evidence | PASS/FAIL |
|---|---|---|---|
| Ranked "call today" list renders ≤ 10 s on production | no service or UI to test yet | feat/service and feat/ui not pushed | NOT YET |
| Duplicates caught: 6/6, 0 false merges | the seed has 1 planted pair; 1/1 suggested, merge route works (8 → 7 donors); no `data/answer_key.json` yet | integration_check `GET /duplicates`, `POST /merge` | FAIL (pending Carlos's sample + answer key) |
| Propensity ranking: planted lapsing giver is #1, score tests pass | Maria Delgado (lapsing Give Miami Day giver) is #1, score 89; 27/27 tests pass | pytest; `GET /donors` first row | PASS |
| Enrichment is sourced: 100% of facts have a working link | every fact has a URL; 5 miamifoundation.org URLs return 202 (bot challenge) to a script; the ★ seed donor has 0 facts; a fictional donor got a real person's facts | integration_check link check + research_facts dump | FAIL |
| Drafts use real org news: ≥ 3/3 | 2/2 drafts cite an org fact (check_draft enforces O1), but the small-donor draft can't be saved (status 'ready' fails the CHECK) | integration_check outreach rows | FAIL (1 saved of 3 needed) |
| Big donors are never auto-sent | ★ draft saved as 'draft'; trigger blocks unapproved 'sent' on insert and update | integration_check trigger checks | PASS |
| Live demo: 0 console errors, 0 4xx/5xx | no UI yet | — | NOT YET |

Guardrails (every round): no invented figures PASS · no Press Forward total PASS · dates and weekdays
(Sat Nov 14, Thu Nov 19, 2026) PASS · no hard-coded "12 days" PASS · ★ never 'ready'/'sent' PASS.

### Bugs open

| # | Owner | Bug | Status |
|---|---|---|---|
| Q1 | enrich (42) | Live research on a fictional individual returns a real person: "Maria Delgado of Coke Florida, Pace Center board" saved as her research_facts. Breaks §3 (individuals are fictional; invented gifts must never attach to a real person) | open |
| Q2 | outreach (86) + data (8b) | 'ready' fails the outreach_drafts CHECK; subject/call_script/facts_used are silently dropped on save. Lead decided: add 'ready' and the columns | open |
| Q3 | outreach (86) | `DB_PATH` is hard-coded and ignores `DONORS_DB`, unlike db.py and enrich | open |
| Q4 | outreach (86) | `today` defaults to the real date; score uses as_of 2026-11-08, so day counts disagree | open |
| Q5 | enrich (42) | url_loads accepts any status < 400 (the lead saw a 406 on oicsfl.org); must require 200 | open |
| Q6 | data (8b) | the ★ seed donor (Biscayne Harbor) is fictional, so research is empty in the drawer; seed the 4 real org donors that are in research_cache.json | open |

## Round 2: Sat 2026-11-07, main + feat/data af541bc + feat/enrich 9ded6fb (unchanged) + feat/outreach d3298da (unchanged)

`pytest service/tests`: 31 passed. Integration script: 32/33 PASS (after fixing my own trigger-message match).

| Criterion (§9) | Change since round 1 | PASS/FAIL |
|---|---|---|
| Enrichment sourced | ★ DeLuca now has 4 sourced facts; miamifoundation.org still 202 to a script (browser check pending) | FAIL (links unverified) |
| Drafts cite org news ≥ 3/3 | both drafts now save, with call_script + facts_used stored; 2 of 3 so far | FAIL (need 3) |
| ★ never auto-sent | trigger now also refuses 'ready' for ★ (insert) | PASS |

New check: no local branch tracks origin/main. FAIL: `qa/integration` (the lead's one-off QA worktree).

| # | Owner | Status |
|---|---|---|
| Q1 | enrich (42) | open: no push yet. Maria Delgado got 0 facts this run only because the live search came back empty, not because of a code fix |
| Q2 | data (8b) | **fixed** (8c3bce3, af541bc): 'ready' accepted, columns stored; outreach side (86) still to confirm its writes |
| Q3, Q4 | outreach (86) | open: no push yet |
| Q5 | enrich (42) | open: no push yet |
| Q6 | data (8b) | **fixed** (222dbfa): 4 real orgs seeded, DeLuca ★ has research |

## Round 3: Sat 2026-11-07, main + feat/data af541bc + feat/enrich c2f62a9 + feat/outreach 6ba5f17

Merges are now done in a separate detached worktree (`../dd-qa-merge`); `dd-qa` stays on qa/checks.
(The round-2 commit had landed on a throwaway branch and never reached origin; restored here.)
`pytest service/tests`: 31 passed. Integration script: 43/45 PASS.

| Criterion (§9) | Result | Evidence | PASS/FAIL |
|---|---|---|---|
| Call-today list ≤ 10 s on prod | no service/UI yet | — | NOT YET |
| Duplicates 6/6, 0 false | 1/1 seed pair; merge 12 → 11 | /duplicates, /merge | PENDING (Carlos's sample + answer key) |
| Ranking | Maria Delgado #1 (89); 31/31 tests | pytest, GET /donors | PASS |
| Enrichment sourced, 100% working links | 0 facts on individuals; DeLuca 3, McDermott 3, all with URLs; 5 miamifoundation.org URLs 202 to a script | link check | FAIL until a real-browser check (Playwright busy in another session) |
| Drafts cite org news ≥ 3/3 | 3/3 drafts saved, each with call_script + facts_used, numeric check passed | outreach_drafts rows 1–3 | PASS |
| ★ never auto-sent | ★ → draft, non-★ → ready (from donor_scores, CLI too); trigger blocks ★ 'sent' unapproved and ★ 'ready' | trigger + CLI checks | PASS |
| 0 console errors / 4xx-5xx | no UI yet | — | NOT YET |

Guardrails PASS: figures, Press Forward, Sat Nov 14 / Thu Nov 19, no "12 days", 0 research on individuals.
Smoke 5 PASS: `python -m service.outreach_agent 11 12` with DONORS_DB=scratch writes only to scratch.

| # | Owner | Status |
|---|---|---|
| Q1 | enrich (42) | **fixed** c2f62a9: individuals return [] with no model call; 0 rows on individuals |
| Q2 | data (8b) + outreach (86) | **fixed** 8c3bce3 / 6ba5f17 |
| Q3 | outreach (86) | **fixed** 6ba5f17: DONORS_DB honoured (CLI wrote only to scratch) |
| Q4 | outreach (86) | **fixed** 6ba5f17: today = as_of 2026-11-08 |
| Q5 | enrich (42) | **fixed** (url_loads == 200; all 9 research_cache URLs are 200) |
| Q9 | outreach (86) | open: the 5 miamifoundation.org URLs in service/org_facts.json return 202 (bot challenge) to scripts; needs a real-browser check. Round 3 wrongly listed this under enrich |
| Q6 | data (8b) | **fixed** 222dbfa |
| Q7 | lead (Ideas) | open: local branch `qa/integration` (the lead's one-off QA worktree) tracks origin/main |
| Q8 | outreach (86) | low: DEMO_CASES still hard-code Amazon and Knight as ★; real runs use donor_scores, but delete the demo cases or relabel them so reports don't disagree with the seed |

## Service probe: Sat 2026-11-07, live http://localhost:8000 (dd-service: feat/pipeline + enrich + outreach + feat/service bad1884)

`python qa/service_check.py http://localhost:8000`: 24/24 PASS (duplicate merge not run, to keep the demo data).
Real-browser link check (`qa/link_check.py`): 11/11 sources load (9 pages, 2 PDFs). The miamifoundation.org 202s were a script-only challenge.

- GET /donors: 200 in 0.00 s, 12 donors, Maria Delgado #1.
- Enrich: individual → 0 facts, no model call; ★ DeLuca → 3 sourced facts.
- Outreach: ★ → draft, org → draft, individual → ready; each saved with an id and facts_used. About 11 s per draft.
- Approve: refused with no body, empty or whitespace approved_by (422); a named person → approved; unknown draft → 404.
- No route sends anything. Unknown ids → 404; a bad id → 422. CORS allows :5174 and refuses other origins.

| Criterion (§9) | Status now |
|---|---|
| Ranking | PASS |
| Enrichment sourced, 100% working links | **PASS** (browser) |
| Drafts cite org news ≥ 3/3 | PASS |
| ★ never auto-sent | PASS (no send route; approval needs a named person; DB triggers) |
| Duplicates 6/6 | PENDING (Carlos's sample + answer key) |
| Upload → ranked list ≤ 10 s on prod | NOT YET: list API is 0.00 s, but /ingest isn't mounted (`ingest: false`) and there's no UI/prod URL yet |
| 0 console errors / 4xx-5xx | NOT YET (needs the UI) |

| # | Owner | Status |
|---|---|---|
| Q7 | lead | **fixed** (upstream unset) |
| Q8 | outreach (86) | fixed 6f36336, re-verify next merged round |
| Q9 | outreach (86) | **closed**: links load in a browser; the "WordPress feed" string was a label, not a fact |
| Q10 | UI (80) + service (90) | FYI: a draft takes ~11 s. The drawer must show progress, or drafts must be pre-generated for the demo donors before going on stage |

Q10 update (service, 90): pre-generation already exists. `python -m service.pipeline --top N` rebuilds the db and drafts the
top N donors plus every ★ in advance; the lead picks N. /ingest mounts automatically once `service/ingest/router.py`
exists (/health will then show ingest:true). QA will re-run the walk after the lead's pre-demo rebuild.

## Round 4: Sat 2026-11-07, main + feat/pipeline f41ffce (contains feat/data) + feat/enrich + feat/outreach + feat/service

Merge clean. `pytest service/tests`: 44 passed. Integration: 47/48. Snapshot (`qa/snapshot_check.py --live`): 28/28.

- Q8 **verified**: DEMO_CASES is gone (0 matches); the CLI drafts db ids only.
- Org → draft rule **verified**: every organization draft (CLI, route, snapshot) is 'draft'; individuals 'ready'.
- No invented gift amount appears in any real-org draft (integration + all 5 snapshot drafts).
- `is_sample` is on every donor; the snapshot's meta label is "Cached sample".
- Live :8000 /donors matches the snapshot exactly (order, score, ★, status) for 12 donors.

| # | Owner | Status |
|---|---|---|
| Q8 | outreach (86) | **fixed**, verified |
| Q11 | whoever owns `docs/roadmap-v03` | open: the local branch tracks origin/main |

## Merge gate: Sat 2026-11-07 (QA verdicts; the lead merges only the exact approved SHA)

Each PR was stacked on the then-current origin/main plus the PRs before it. Checks: clean merge, `pytest service/tests`,
owner-lane files only, no secrets / .env / *.db, plus a live check where the PR has one.

| PR | SHA | Tests at that point | Live check | Verdict |
|---|---|---|---|---|
| #4 docs/team-assignments | 72c443e | n/a | .env and donors.db stay ignored | APPROVE |
| #8 feat/data | af541bc | 31 passed | — | APPROVE |
| #10 feat/pipeline | f4b3c4f | 40 passed | — | APPROVE |
| #5 feat/enrich | c2f62a9 | 40 passed | — | APPROVE |
| #7 feat/outreach | 5b5c658 | 46 passed | — | APPROVE |
| #12 feat/service | 13874e8 → **39a741f** | 46 passed | uvicorn on :8100: /health 200, /donors 200 in 0.24 s, /icp/run + /prospects/1/outreach → 503 "not landed" | APPROVE (re-done at the new head) |
| #13 docs/roadmap-v03 | 1babf9b | 46 passed | docs only | APPROVE |
| #11 feat/ui | 9a291d4 → **dcda650** | 46 passed; parse.test.ts 7/7 | build:demo exit 0; the built demo renders in 1.5 s, SAMPLE chip, drawer WHY/RESEARCH/DRAFT, 0 console errors, 0 4xx/5xx | APPROVE (re-done at the new head) |
| #14 fix/enrich-idempotent | f9a43e0 | 48 passed | enrich ×2 on DeLuca → 3 rows, no duplicates | APPROVE |
| #15 feat/icp-schema | 43b9ef4 | 53 passed | XOR CHECK; prospect drafts never ready/unapproved-sent; empty routes 200 [] or 404 (no 500); in-place upgrade keeps drafts + triggers | APPROVE |

Open:
- Q11 (Sharif): local branch `docs/roadmap-v03` (in the shared devday_hackathon folder) still tracks origin/main.
  The lead says they lack permission to change it. QA didn't change it on their behalf. It's merged and won't be pushed again.
- The live :8000 db still has duplicate research rows from before #14. Rebuild before the demo walk.

| PR | SHA | Tests | Live / content check | Verdict |
|---|---|---|---|---|
| #15 feat/icp-schema (re-check) | **6f0ef8e** | 55 passed | only snapshot.json changed since 43b9ef4; snapshot_check 27/27, no duplicate research | APPROVE |
| #16 feat/sample-inputs | 2c868d3 | 48 passed | all 5 inputs open; 35 emails all example.com/.org; phones 305-555-01xx; all 8 answer-key totals recomputed (33 donors, 101 gifts = $1,268,910, 6 duplicate groups) | APPROVE |
| #17 docs/onboarding-plan | a944b59 | 48 passed | docs only | APPROVE |

§9 "Duplicates 6/6" can now be measured: data/sample_inputs/answer_key.json has 6 planted groups. It runs once ingest lands.

| #17 docs/onboarding-plan (re-check) | **a2faffb** | n/a | docs only; Sat Nov 7 weekday correct | APPROVE |

### Gate protocol addition (Sharif, Sat 2026-11-07): overlap and integration across all open PRs
Each verdict also runs:
1. **Overlap map:** every file touched by more than one open PR, with both owners. Overlaps get a joint check or an agreed order.
2. **All-open integration:** merge every open PR together into one throwaway tree on current main; run `pytest service/tests`,
   and `npm run build:demo` when web/ is touched. A PR that passes alone but breaks with another is REJECTed until the owners reconcile.

### Gate round: #18, #19, #20 on main adbd458 (all-open overlap + combined tree)
No shared files; all three merge together; pytest 70 passed; no secrets.

| PR | SHA | Checks | Verdict |
|---|---|---|---|
| #20 feat/org-outreach | 39f6906 | 31 org facts, all on miamifoundation.org; 12/12 distinct URLs load in a browser; 2 live prospect drafts are 'draft', no money ask, no relationship claim | APPROVE |
| #18 feat/icp | 49a000b | 7 prospects, all organizations, none an existing donor, 3 facts each; 9/10 URLs pass outright | APPROVE + follow-ups Q12 (Peacock: 2 facts cited to a homepage that doesn't show them) and Q13 (no "via web search" provenance on prospect facts) |
| #19 feat/social-context | 02ced45 | not imported anywhere in service/; tests pass | APPROVE (no-harm, post-demo) |

### Gate round: #21, #23, #24, #26 (all-open overlap + combined tree)

| PR | SHA | Checks | Verdict |
|---|---|---|---|
| #21 feat/service-onboarding | 40dfac3 | /context/run: cached 18 facts in 2.1 s, live 16 in 17.6 s (≤30 s cap); socials "saved, not connected"; 404 leaks no path | APPROVE (merged) |
| #23 feat/org-outreach | a40881f → bd26456 → b718649 | unreachable site reported "done" (a40881f, bd26456); a live run dirtied the committed cache (a40881f, fixed in bd26456); at b718649 its own cached-run test fails on main (LinkedIn 'not provided') | REJECT (owner 86), plus 2 cached-path bugs from the lead's UI walk |
| #24 feat/ui-onboarding | 37f4c64 → 395bf50 | web/ only; 28/28 tests; build:demo ok; demo with #26 snapshot renders 0.67 s, 0 console errors, 0 4xx/5xx | APPROVE |
| #26 feat/icp-schema | 7a9eef1 | 83 passed alone; empty-db /icp and /org-profile 200 null; 7 prospects × 1 'draft', donor_id null, no money ask; 0 mojibake; profile matches org_config | APPROVE |

The combined tree caught 1 failure (87/1); isolation showed it was #23's own test, not a clash.

| PR | SHA | Checks | Verdict |
|---|---|---|---|
| #23 feat/org-outreach | **782e830** | combined with #27: 93 passed; X-only cached run keeps X, no Instagram, saved to /org-profile; unreachable site → failed; live run 18 facts / 17 s, git status clean; 0 mojibake | APPROVE |
| #27 feat/service-onboarding | 6ed1860 | dismissed prospect → 409 in 0.01 s with no model call or draft; unknown → 404; a fact-less prospect's draft makes no claims about the org | APPROVE |

Logic overlap (no file overlap): #23 and #27 both make user URLs win. They agree; nothing double-applies.
Minor (90): top-level `state` stays "done" when every source failed.
| #28 feat/ui-onboarding | de6c306 | web/ only; 31/31; build:demo ok; 409/404 messages match #27's live responses; demo 0.86 s, 0 console errors | APPROVE |
| #29 docs/three-classes-plan | 7d4c097 | docs only; Sat Nov 7 correct | APPROVE |
| #30 fix/context-state | 7b61cf1 | 98 passed; unreachable site → state "failed"; cached/live MF → done; git status clean | APPROVE (note to 90: with no website, the fallback news row says "done") |
| #31 fix/context-fallback-rows | fe06538 | combined with #32: 105 passed; X-only, another-org.org, example.org (cached) and unreachable all → failed with 0 Foundation facts; Foundation (incl. www + trailing slash) → done | APPROVE |
| #32 fix/context-empty-site | 1ab958c | resolvable-but-empty site → failed, name null, clear error detail; agrees with #31 in the merged tree | APPROVE |
| #33 fix/icp-sources | fd389a1 | combined with #31+#32: 109 passed; provenance on 15/15 facts; per-fact page check: Taft ×2 not on the cited page (even after loading all grantees), White & Case ×2 cited page 403 | REJECT (owner 42) |

## Live :8000 on main 8859b82 (fresh pipeline rebuild, as of 2026-11-08)
`qa/service_check.py`: 24/24. `qa/snapshot_check.py --live`: 28/28; live /donors matches the snapshot exactly.
DeLuca research: 3 rows, all distinct (the #14 fix holds live). Prospects 7, all 'drafted'; /icp 200; /org-profile = The Miami Foundation.
No context probes for other sites were run on :8000: a failed run still overwrites the saved profile there (90's fix is pending).
| #34 fix/context-no-save-on-fail | 335a1ba | combined with #33: 111 passed; after a good run, typo (cached and live), unreachable and X-only runs → failed, /org-profile and /context unchanged | APPROVE (decision for lead: X-only socials no longer saved, which conflicts with #27's "user URLs always saved") |
| #35 fix/website-required | 91b7684 | web/ only; 33/33; build:demo ok; fetch is never called for "", "   " or null (stubbed-fetch test); snapshot client guarded too | APPROVE (browser network check once the onboarding screen exists) |
| #33 fix/icp-sources (re-check) | **985ceef** | 112 passed; 25/25 prospect facts: browser 200 + key words on the rendered page; 8/8 figures verbatim; Peacock now cites /grants/; provenance 25/25; no existing donors | APPROVE (Q12, Q13 closed) |
| #42 docs/three-crm-calendar-plan | ade239e → **7a0ae17** (tab names locked) | docs only; Sat Nov 7 / Sat Nov 14 / Sun Nov 15 / Thu Nov 19 all correct; ROADMAP overlap with #41 merges cleanly | APPROVE |

Unqueued open PR: #41 codex/kindred-landing-design @37791d6 (FayeSMR). With #42: pytest 112, build:demo ok, a landing gate in front
of the CRM ("Try sample data" → Call today in 0.22 s), 0 console errors. Open questions for the lead/Sharif: "kindred" vs "Donor Desk"
branding, and the codex/ branch vs CLAUDE.md rule 10. #36-#40 are issues, not PRs.

### Gate round: backlog fan-out (Sat evening), 3 parallel review agents + QA lead

| PR | SHA | Checks | Verdict |
|---|---|---|---|
| #41 codex/kindred-landing-design | 37791d6 | landing 0.78 s → Try sample data → Call today 0.26 s; honest upload dialog in the snapshot build; deep links skip the landing; 0 console errors | APPROVE (merged) |
| #43 docs/roadmap-v09 | b5e4f78 | docs only | APPROVE (merged) |
| #44 feat/sample-inputs-3tabs | 9876765 → 2a88c4f → **edbd237** | at 2a88c4f Park's declined charge was dated after as_of (REJECT); at edbd237 the Oct 10 decline is in the xlsx and out of the totals, 113 gifts = $1,269,470, nothing after Nov 8 | APPROVE (merged) |
| #48 feat/gift-alerts | c16d648 | Park flagged for the wrong reason; 2 extra yearly lates; route unmounted; its own test broke with #44 | REJECT → re-grading at the new head |
| #49 feat/events | bac83c9 | givemiamiday ×2 state their dates (real Chrome); the 5K page states neither Nov 15 nor Ferré Park, yet the invite says both; pet rule picks exactly the 16 has_dog people; invites carry no ask | REJECT (owner 86) |
| #51 feat/ingest-adapter | a12d73e | conflicts with main (hooks/snapshotClient/types) | superseded by the lead |
| #53 feat/three-crm-data | f070f73 | conflicts with main (4 provider files); POST /context/refresh, /chat, /send not provided by #60 | REJECT → re-grading at the new head with #60 |
| #54 docs/context-db-daily | a8cfdbd | docs only; 166 passed | APPROVE (merged) |
| #59 feat/stat-mcp-transaction-import | 31bf441 | conflicts in plan.md; CLAUDE.md/sample.env edit is a port move only; no secrets | REJECT (rebase), then the full suite |
| #61 docs/nonprofit-calendar-research | 1bc41a7 | docs only; 9 weekday pairs correct | APPROVE |
| #63 feat/landing-sample-go | 6ce5db2 | conflicts in KindredLanding.tsx; no answer_key.json under web/ | REJECT (rebase) |
| #65 feat/dedupe-names | 1b92a24 | 6/6 planted groups, 0 false pairs, 0 auto-merges (name-only rows); 175 passed | APPROVE |

Integration: #45/#46/#47/#53 conflict in shared provider files; agreed merge order #46 → #45 → #47 → #53 (owners rebase in turn); #58 after #47; #67 after #53.

### Resumed round (Sat night): Sharif resumed QA; lead lane split with c9 (wave-1 PRs → c9)

| PR | SHA | Checks | Verdict |
|---|---|---|---|
| #73 fix/openai-client-loops | f129c36 | 262 passed on main 14df268 with and without it; "Event loop is closed" NOT reproducible on main (sequential run_sync, live ping ×6 + outreach ×3, alternating thread/async/live enrich) | APPROVE (defensive; bug unproven) |
| #77 docs/problem-solution-mapping | 7bd10f0 | 62 weekday pairs correct; 13/13 smokes complete; ~10 §21.5 endpoints missing from ui-integration §2 | APPROVE (follow-up doc fix) |
| #69 feat/chat-panel | c6e529f | live mode: the Chat tab crashes (ChatPanel.tsx:113, AskSidebar omits context/selection); 20/20 tests; MIT | CHANGES (grade only) |

Merged without a final QA pass while QA was paused (by Christian): #60, #53, #48, #62, #63, #58, #67, #74 → retro-check of main in progress.
Upstream trap still live locally: dev/ingest-v2 and feat/ingest-adapter-v2 track origin/main.
| #80 docs/contract-sync | f873011 | all 10 drifted endpoints now in ui-integration §2/§2.1; accept shape explicit; owner note: /tasks 3a (ui) vs 86 (plan §21.5 l.1034) | APPROVE |

Merged by the lead on QA verdict: #73 (918cd24), #77 (067fa19). #69 parked (Christian's #78 shipped its own Ask pane; B10 reuses #69's pieces).
| retro d5e3812 (stat-mcp, pushed to main) | 970c5ca..d5e3812 | 5 stat-mcp tests pass; 5 fixes have code + tests; stat-mcp only; no secrets | OK |
| retro 6976578 (ingest adapter, pushed to main) | d5e3812..6976578 | gifts exact both runs (113 / $1,269,470, declined excluded); people 82 and 85 vs 68; tabs 39/28/15, 39/31/15 vs 33/20/15; NOT deterministic (LLM extraction + tab judge); grouping key (name, org) leaves same-name dupes | PROBLEM (adapter owner) |
| dedupe 10-vs-6 | — | the cause is the adapter (pre-merges + uncollapsed dupes + fragments), not dedupe.py or the key; Marrow Lane ~ Okoye is a true pair per key D32 | diagnosed |
| #49 feat/events | 4dd9847 | 11 passed; weekdays right; runsignup/eventbrite state Nov 15; givemiamiday verified earlier in real Chrome; no Community ask | APPROVE |
| #57 feat/refresh | c2ff468 | superset of #49 + refresh.py; 35 targeted tests pass | APPROVE |
| #68 fix/mergeimport-browser-tests (Christian) | a51fa2d | mergeImport 4/8 → 8/8; provider vitest 93/97 → 97/97; test seam only | APPROVE |
| main retro 6a18d17 | — | pytest 175; chat answers with 7 tool steps; BLOCKER: /duplicates, /people?type=community, /community/stats → 500 after a real upload (free-text demographics vs json.loads; ingest_adapter.py:585 / routes_data.py:66); tabs 39/31/14, dupes 16, alerts 4 (adapter non-determinism); landing sample manifest ships 5 of 7 files | PROBLEMS (adapter owner; landing manifest owner) |
| #81 feat/hooks-finish (B9) | c2b51e4 | tsc/eslint clean; provider vitest 174/174; mocks only with VITE_MOCK_ENDPOINTS=1 (0 in dist); snapshot reads empty, writes refused; Apache-2.0 headers + NOTICE; home/ untouched; live home renders (Q4 33%, 4 at risk, 6 tasks, attention list), 0 console errors | APPROVE |
| #82 feat/context-rag (C1/C2) | cdac139 | 296 passed (16 new); guarded ADD COLUMNs only; one main.py line; no embedding in GET /context; /context/search shape + ranking ok; live smoke #5: 16 rows with source_url + embedding, newest first per kind; live drafts cite all 3 kinds, no Community ask, stars/prospects 'draft' | APPROVE |
| #88 feat/interest-tags (B1) | 3c02d48 | routing/fallback/seeding/CHECK/undo/no-donor-writes all PASS; 309 passed; smoke #9 15/17 URLs 200 (2 LinkedIn 403); conflicts with main 8638c66 in db.py; accept omits the `contact` key | CHANGES (rebase + contract key) |
| #87 feat/empty-start (D1/D2) | e901d5f | fresh start = 0 rows, no seeding; caches only on live failure, flagged; seed/cache only via `python -m service.pipeline`; key 131 = $1,367,535, Q4 $98,815; landing lists 8 files, 1 POST /ingest; first-run walk renders the home (Q4 66%), 0 console errors | APPROVE |

Ingest on #87's dataset: 132 gifts = $1,367,575 vs the key's 131 = $1,367,535 → the declined $40 (Park) is counted as a gift; added to the ingest-fix target.
| #90 feat/after-call (B6) | e18d4fa | 358 passed; empty start ok; guarded db adds; no own /tasks route; temp file in OS temp; smoke #11 run 1 = 1/1/2/1, idempotent Apply, undo ok. Defects: re-propose wipes `applied`, so a second Apply duplicates the pledge; live run 2 gives 1 note instead of 2 | CHANGES (owner 86) |
| #96 fix/ingest-adapter-determinism | 63648eb | ingest_check 27/29: 68 people, 33/20/15, 131 = $1,367,535, 5 alerts, routes 200, deterministic; FAIL: 0 pending suggestions (all 6 groups auto-merged, breaks challenge #2) | verdict held for the next head |
| #88 feat/interest-tags (re-check) | d642f00 | accept saved now includes contact (+ contact_persisted: false); POST /undo 200 → 422 repeat, malformed 422; 39 targeted tests pass; conflicts with main e24a985 in main.py (#91 voice router line) | CHANGES (rebase only, keep interests router before /enrich) |
| #95 feat/home-integration (preliminary) | 2bd9cfc | panels = API (tasks 18, glance, CRM 6, calendar, artifacts); Mark done persists; 0 console errors at 1536/390; Q4 gauge hides the sample goal (goal_is_sample); header date Nov 7 vs as_of Nov 8; d14b6b1 adds onboarding-localStorage logic beyond the avatar removal; snapshot mode reads "all caught up" (#98 addresses this) | preliminary CHANGES (small) |
| #90 feat/after-call (re-check) | bb985a0 | smoke #11 live twice = 1/1/2/1 (fix B PASS); warm-store re-propose writes 0; cold store (proposals file wiped) writes a duplicate note + task (backstop keyed on model wording; no task backstop); conflicts with main e24a985 in main.py | CHANGES (owner 86) |
| #98 feat/snapshot-home (preliminary) | ae748b0 | home_snapshot reuses live functions; 0 console errors; snapshot.json only request; UI gifts-at-risk 4 vs snapshot 2 and "12 days" vs next_event 6 (UI's own today); no persistent sample label on home; missing tests for old-snapshot fallback + refused-write message | preliminary CHANGES |
| #88 feat/interest-tags (merge check) | cc7dabd | dry_run on the branch writes 0 and returns the proposal; no dry_run delegates (saves 4); conflicts again with main ade7eed (main.py) | CHANGES (rebase only) |
| #96 fix/ingest-adapter-determinism | c56c2f9 | ingest_check 29/29 on main 2ef8a44 (routes 200, 131 = $1,367,535, DG1/3/6 merged on exact identity, DG2/4/5 pending, 10 approvals ok, 0 orphans, then 68 / 33-20-15 / 5 alerts, deterministic); cold-cache run 14/14 with 9 pending (Tamarind varies); pytest 414 passed | APPROVE |
| #95 feat/home-integration (final) | 6ae1dd9 | all items fixed (sample-goal gauge 66%, as_of date, honest snapshot copy, neutral Account); 1 upload → context → tasks; panels = API; BUG: after onboarding completes the landing reappears at / (useHasPeople reads /donors once on mount, KindredLanding.tsx ~52) | CHANGES |
| #90 feat/after-call (re-check 2) | 5b5763b | cold-store re-apply writes 0 (also reworded); markers in rows; smoke #11 1/1/2/1; BREAKS test_agent_tools.py::test_writes_not_on_this_build_say_so (event_audience.rsvp switches on agent_writes.rsvp_event); undone task returns after a cold-store re-apply (judgment call) | CHANGES (small) |
| #98 feat/snapshot-home (final, stacked with #95) | f850d83 | snapshot home = snapshot.json (Nov 8, 2 at risk, 1 dup, 6 tasks, 6 days, $50.1k/$150k); "Sample data" badge + tooltip at 1280; Mark done → one refusal toast, 0 writes; no crm data exported; live mode reads live routes; badge missing at 390 (follow-up) | APPROVE |

Process note: the #98 review agent ran `taskkill /IM node.exe` (ended all Node processes machine-wide); reported to the lead. Reviewer briefs now forbid image-name kills (stop by owned PID or port only).
| #88 feat/interest-tags (final) | 5f444aa | merge clean on f8329f6; router order crm → interests → voice, interests before /enrich; 63 targeted tests pass; full suite only fails test_crm snapshot test (fails on plain main) | APPROVE |
| #90 feat/after-call (final) | 009e670 | RSVP via agent_writes.rsvp_event with undo; staff undo sticks across a lost store; smoke #11 1/1/2/1; only failure = main's test_crm snapshot test | APPROVE |
| #95 feat/home-integration | e93e231 | re-grade parked mid first-run walk (Sharif pause) | PARKED |

Open on main (not from a PR under review): test_crm.py::test_snapshot_never_exports_crm_records fails on plain main f8329f6 (#98 × #100 privacy leak); the lead assigned it to 3a.
PAUSED Sun Nov 8 at Sharif's request; all review agents and their servers stopped.

### Resumed after the overnight pause (Sun Nov 8)
Main 5ecf010 baseline: answer key unchanged; ingest_check cold + 2 warm, 0 FAIL, 9 pending each run.

| PR | SHA | Checks | Verdict |
|---|---|---|---|
| #108 docs/readme-demo | 5d20dba | models/limits/licenses/dates/Vercel ok; Knight Enrich beat premature (no add-contact path, no Save button on main); counts stated without "after approvals" and without excluding answer_key.json/_README.md; "Let the agent sort" not in UI | CHANGES (owner 86) |
| #108 docs/readme-demo (re-check) | 82602de | 8 named inputs = main's folder (excl. key/_README); counts after approval; steps match OnboardingSteps.tsx strings; Knight beat gated on #111 + Enrich UI; fallback model row | APPROVE |
| #109 context-note undo (3a) | e74ebd7 | 464 passed; after_call change minimal (2 hunks), smoke #11 1/1/2/1; undo add/delete/newer-change 409/reuse 409/malformed 4xx; deleted notes invisible to all research_facts readers + snapshot; cold-store re-apply writes 0 | APPROVE |
| #114 scripts/demo-reset (8b) | 17fef69 | busy port → exit 2 REFUSED, db untouched; --force → backup + empty; --warm primes the cache (77 people / 132 gifts / 9 suggestions) then resets; --check works on a copy (real db sha256 unchanged), exit 1 on empty; 10/10 tests | APPROVE (nits: no backup for an empty db; also exclude _README.md in the printed instructions) |

#107 merged by the lead on the in-session reviewer's APPROVE (c05ecaa → f84f35b). QA's independent walk is repurposed as the post-merge regression on main.
| #119 docs/claude-md-codex | 7c44fb0 → c3eb54f | at 7c44fb0, "README says so" was false (0 Codex mentions in README); clause dropped at c3eb54f | APPROVE (c3eb54f) |
| #117 fix/dedupe-person-org | 0cda330 | full suite main 481 → main+#117 485 passed (an earlier 13F/33E run was contention); real upload + `demo_reset --check` PASS: 33/20/15 after approval, 131 / $1,367,535 before and after, 5 alerts, the real db unchanged; fuzzy stays pending; nits fixed | APPROVE |
| #112 agent chat | 815be5d | Approve crashes: chat_agent.py:607-609 KeyError 'needs_individual_approval' → 404; card stays live; add/undo without reload, Decline, guardrail all PASS | CHANGES |
| main post-#107 regression | 8f6aa51 | first run → dashboard (no landing loop), panels = API, Mark done persists, snapshot badge at 390; flags: a new browser re-shows onboarding over a filled db; snapshot dataset ≠ answer key | OK (flags assigned) |
| #114 → #110/#113 | — | the calendar pair moved to reviewer db; my reviewer was stopped and its 3 processes ended by PID | — |

Process incident: the #112 reviewer stopped another session's Vite on :5191 (it killed by port owner). Rule tightened to own recorded PIDs only. Disk hit 99%; QA node_modules (verified not junctions) deleted, C: free 7.9 GB.
| #125 auto-merge "!" flag (a4) | d91e40f | flag = 15 exact same-email merges with differing names; keep-all / split-all keep 131 / $1,367,535, 0 orphans; fuzzy pending 11 = main; routes 404/422/409; ingest_check 0 FAIL; split → approve-all gives 69 not 68 (Marrow Lane Print not re-suggested; routes_data.py:530) | CHANGES |
| #112 agent chat (re-review, on fc93c69) | 74336289 (short 7433628) | Approve end to end "Approved: batch #3, 2 sent, 1 blocked (dry run)", sends simulated, the org stays draft; failed decide → "Already handled"; Markdown + DOMPurify; regressions pass | APPROVE (merged) |
| main #129 retro | a684912 | home/layout vitest 36/36; chat grounded (Park/Salinas/Brandt match the API), add + undo with no reload; 8 sidebar links ok; 0 errors | OK |
| main #132 retro | a79ef67 | onboarding vitest 83/83 (#131 fix holds); first run → dashboard, POSTs ingest → context → tasks once; #128 gate survives (a new browser on a filled db skips onboarding); nit: the import summary says 132 gifts (includes the declined charge) vs 131 | OK (nit) |

Pipeline: devday-hackathon-20 = the Integrate + Test Wheel (ports 8000/5173/8101/5174 reserved). Scope (Sharif): Givers first; Neighbors/Community issues informational unless they break the Givers flow or the counts.
| #125 auto-merge flags (re-check) | fd4ca51 | split all → approve all = 68; approve all without split = 68; demo_reset --check PASS; dismissed stays dismissed; 5 alert tasks, 0 stale; negatives 409/404/422; e2e test passes alone | APPROVE |
| #134 auto-merge review UI (on #126 e0bd3d8) | b36e204 | 15 "!" icons = API (12/2/1); keep → 14; split refetches without reload; labels Neighbor/Community member; 0 errors, no overflow at 390 | APPROVE |
| #151 integration-wheel scripts (20) | 8dfae7d | own-PID kills, scoped reset, state outside the repo, real count assertions; ports hard-coded (live_stack.ps1:33-34, --reset ignores --api/--db); CORS blocks spare ports; PID-reuse risk (:55/:99); pids.json no lock | CHANGES |
| #148 CompanyShow + snapshot chat (0f) | f4c27bf | CompanyShow mobile test fails on main / passes with the PR (real fix); snapshot free text still POSTs /api/ask (a console error each), failing the PR's own S1 | CHANGES |
| #151 integration-wheel (re-check) | c9cf238 | ports/CORS/PID verification/lock all PASS; spare-port walk 12/13 (33 givers, 131 / $1,367,535, 5 at-risk); --reset lacks --state-dir (could stop the live TEST service); step 6c approval-card selector never found the button | CHANGES |
| #151 integration-wheel (re-check 2) | b0b4df3 | refused reset on spare ports with the shared state dir → exit 2, TEST untouched; 6c now waits for the pending card; the live 6c run in progress | pending 6c |
| #150 agent tools fix | 9af105c | campaign 79.5 s → 34.7 s; chat 4-7 s; lapsing 15 = db, 200-day filter = SQL; interest filter exact, unknown → none; approval gates sends; undo ok; AgentCards UI not browser-walked (→ IT step 5) | APPROVE |
| #123 composer dictation (3c) | edd5f06 | Dictate in the home composer: words in 2.5-2.8 s, appends, Esc restores, send → agent task, 0 db rows from dictation; 390 ok; snapshot mic disabled "needs the live service" | APPROVE |

Possible main issue: #116 Ask-prompt dictation stays "listening" with no text (fake mic), also with #123 reverted; the same WAV works on home → real-mic check on the LIVE app requested (owner: voice lane).
| #151 integration-wheel (final) | c0f1f1a | the tooling is safe (refused reset, PID verification, lock, ports, CORS); spare-port walk 14/16: 6c approval PASS (dry run, 0 sent), counts 33 / 131 / $1,367,535 / 5 at-risk | APPROVE |

Product findings from the #151 walk on main 3ce79eb (routed): (1) the home Tasks tile shows 20 vs 21 open tasks due ≤ today (Faye home #152); (2) the Enrich button click is blocked by an overlapping div `flex min-h-9 … text-[13px]` (Givers flow, demo-visible).

### Integration tree (Sun Nov 8): main 3fe1f9a + #123 #148 #150 #151 #153 #159 @ 049e674
pytest 574 passed; tsc + build clean; vitest 804/815 (11 pre-existing failures on main). #137 conflicts with #150 (chat_agent.py) and #151 (config.py).
Live walk: onboarding → dashboard PASS; 33/20/15 → 68 / 131 / $1,367,535 PASS; chat, calendar, dictation, Enrich (real org) PASS; 0 ≥400; no overflow at 390.
Top blockers (Givers first): (1) 10 "Review possible duplicate" tasks stay open after merges (and the agent recommends them); (2) the import summary says 132 gifts (#145 needs a rebase); (3) the Givers tab shows 11/12 auto-merge flags; (4) Enrich finds nothing for the fictional sample orgs; (5) CampaignReview duplicate React keys.
Follow-up: blocker (3) withdrawn: the 12th flagged giver is on Givers page 2 (the #125/#134 run counted 12 + 2 + 1 = 15 across pages). (2) fixed by #145 (merged). (4) by design (fictional orgs; the demo adds the real Knight Foundation via chat). (5) → d1. (1) → 33, top priority.
| #160 calendar Refresh now (e6) | b04d3bd | card S1/S2/S-neg PASS: Refreshing… → refetch with no reload, failure detail shown, hidden in snapshot (0 calls), 390 ok; nits: 0 ms double-click → 2 POSTs; unreachable site reports done | APPROVE |
| #174 approval card names (+Undo) | 8cae595 | card names the recipient; mixed batch approve → dry run, orgs blocked; Undo greys and reverses; no-email → clear message; 390 ok | APPROVE |
| #160 / #163 / #171 / #161 | — | #163, #171, #161 moved to other reviewers (my reviewers stopped, worktrees reset; one leftover tsc PID stopped) | — |

Possible main bugs: (a) with two approval cards pending, approving one auto-declines the other (owner 90). (b) Blocker 1 baseline on main 8cdff72: after approve-all, 9 "Review possible duplicate" tasks stay open (#180 pending merge).
