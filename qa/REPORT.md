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
| Q5 | enrich (42) | **fixed** in code (url_loads == 200); miamifoundation 202s still need a browser check |
| Q6 | data (8b) | **fixed** 222dbfa |
| Q7 | lead (Ideas) | open: local branch `qa/integration` (the lead's one-off QA worktree) tracks origin/main |
| Q8 | outreach (86) | low: DEMO_CASES still hard-code Amazon and Knight as ★; real runs use donor_scores, but delete the demo cases or relabel them so reports don't disagree with the seed |
