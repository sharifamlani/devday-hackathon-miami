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
