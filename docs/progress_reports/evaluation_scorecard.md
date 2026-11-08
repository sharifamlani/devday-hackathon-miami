# Evaluation scorecard: plan.md §21.10

**Graded by:** c9 (independent evaluator; built none of this work)
**Date:** Sunday, Nov 8, 2026
**Code graded:** `main` at `5ecf010` (Merge #102), unmodified
**Not graded yet:** rows that need PR #107 (home panels) or session 12's walks. They are marked "waits".

Every result was measured by c9 against the real system. Live runs used the real OpenAI and Gemini models
and a live read of miamifoundation.org. Logs and scripts are in
[`evaluation_evidence/`](evaluation_evidence/); no file there contains a key.

## Scorecard

| # | Criterion | Threshold | Result | Evidence | PASS/FAIL |
|---|---|---|---|---|---|
| 1 | Nothing preloaded | 0 rows of people, gifts, tasks, context before the first upload | Fresh db after app startup: donors 0, gifts 0, tasks 0, org_context 0 (also org_profile, outreach_drafts, campaigns, call_notes, events 0). Every route returns 200 with empty data | `1_fresh_start.txt` | **PASS** |
| 2 | Everything traces to the example files | 100% of people and gifts map to a file row in `answer_key.json` | QA script, 2 live runs, identical: gifts 131 = $1,367,535 = key; after approvals people 68, tabs 33/20/15, 0 orphan gifts; 29/29 checks | `2_7_ingest_check.txt` | **PASS** |
| 3 | First run lands on a populated dashboard | glance counts > 0; tasks generated; ≥1 item per kind where the site has one | **Re-graded on `d555d39` (#144).** Real onboarding in a browser on an empty db: upload 8 files → website → step 3 left to finish on its own ("Your desk is set up · 16 facts found"). 77 people, 131 gifts = $1,367,535, 16 context facts, **4 sourced events, 128 invites**, tasks 5 call / 1 email / 9 review / **4 prep**. 0 console errors, 0 4xx/5xx. (Earlier FAIL on `f84f35b`: 0 events) | `3_first_run_regrade.txt` | **PASS** |
| 4 | Context store sourced, recent-first | 100% rows with source_url; newest-first holds | Live miamifoundation.org run (25 s, served_from live): 18/18 rows have a URL, all on miamifoundation.org; kinds 5 success_story / 6 use_of_funds / 4 org_health / 3 program_update; GET /context newest-first holds over 18/18 dated rows | `4_context_store.txt` | **PASS** |
| 5 | Campaigns tell the story | 100% of 5 drafts cite ≥1 success story, 1 use of funds, 1 org health; 0 invented facts | **Re-graded on `4c01f01` (#118).** New live campaign for the same 5 givers: 5/5 cite all three kinds; every figure in a cited fact or a good gift. Hye-jin Park is thanked for "June, July, August and September" (the declined Oct 10 charge is gone). Every other claim checked against SQL (Robert $75 Nov 5; Rafael $50 Nov 3; Teodoro six $300 gifts 2025–26; Priya $500 Nov 2 "by check" = channel check). (Earlier FAIL: declined charge thanked) | `5_campaigns_regrade.txt` | **PASS** |
| 6 | Money is exact | equals the updated answer key; pledges never count | `test_targets_quarters.py` 7 passed (includes declined charges + pledges excluded). Live ingest totals equal the key (131 gifts, $1,367,535) | `6_money.txt`, `2_7_ingest_check.txt` | **PASS** |
| 7 | Challenge #2 (**2a wording changed by Sharif**, recorded in plan.md §21.10 by #122: fuzzy duplicates stay pending; exact matches may auto-merge but show a "!" with Keep/Split; Split leaves gifts + totals unchanged) | as left; 5/5 alerts shown as tasks | **Re-graded on `d555d39` (#125/#134).** DG1, DG3, DG6 auto-merged, each with an open auto-merge; DG2 and DG5 merged their exact pair, the fuzzy rest pending; DG4 pending. UI: "Merged automatically, review" ("!") on the person, listing source files/emails/gifts, with **Keep merged / Split back**; 11 flags on the People list. Split #8 → totals **131 / $1,367,535, 0 orphans** unchanged, survivor's gifts move to the restored person; Keep #15 clears the flag. Alerts as tasks: 5/5 before and **5/5 after approving all** duplicates, 0 stale (3a's fix) | `7_dup2a.txt`, `7_alerts_regrade.txt` | **PASS** |
| 8 | Enrich tags | ≥2 of 3 sample orgs get ≥1 sourced tag; 0 outside the 17; 0 for a made-up person | **Re-graded on `d555d39`.** 3/3 real orgs tagged with sources (Knight 4, DeLuca 5, McDermott 3); 0 outside the 17; made-up person 0; 0 writes. **The wrong-entity finding is fixed:** fictional "Whitaker Family Charitable Fund" now gets 0 tags (before: youth_family from a South Carolina org) | `8_enrich_regrade.txt` | **PASS** |
| 9 | Transcription | first words < 2 s; ≥90% word match on a scripted 20 s read | First interim 1.0 s and 0.89 s (2 live runs). Word match 90.3% (7 edits / 72 words; 4 are number formatting). Real misses: "volunteers", "helped"→"help", "December", lost where one final segment ends | `9_transcription.txt` | **PASS** |
| 10 | Call notes | note + summary survive restart; dictation stores 0 rows | Dictation: 0 notes before and after. Summarized note saved, service restarted, note + summary + next steps returned unchanged; SQL call_notes = 2 (the 2 saved calls) | `10_call_notes.txt` | **PASS** |
| 11 | Agent does everything | every write tool works from chat; panel updates; Undo works; 0 sends/merges/deletes without a click | Backend on `267d51b` (5/5 writes with undo, 2/2 deletes/merges paused). **UI on `4c01f01` (#112):** home chat "create a call task…" → task in the API in 7 s, step card with Undo, home Tasks panel shows it with no reload; Undo removes it (card "Undone"); "delete task 6" → approval card, task untouched until Approve, then deleted. add_contact from the home chat → Givers tab 41→42 without a reload (#126). 0 console errors | `11_agent_tools.txt`, `11_agent_ui.txt` | **PASS** |
| 12 | Key stays server-side | 0 Gemini key in `web/dist` or network | `web/dist` (73 files, 21 MB): 0 occurrences of the key, its first 12 chars, `GEMINI_API_KEY`, or Google API hosts. Browser walk: 566 requests, hosts only localhost:5181 + localhost:8016, 0 carrying the key | `12_key_server_side.txt` | **PASS** |
| 13 | Demo path clean | 0 console errors, 0 4xx/5xx on laptop + Vercel | c9's own walk (session 12 walks separately): home + Ask sidebar, donor list, donor page, organizations, campaigns, Ask page. Laptop (`f84f35b`, populated first-run db): 0 console errors, 0 4xx/5xx. Vercel snapshot (devday-donor-desk.vercel.app, as deployed): 0 and 0 | `13_demo_path.txt`, `demo_*.png` | **PASS** |
| + | After-call routing (§21.9 #11; §19 "call is routed correctly") | 3/3 live runs produce the expected 5 actions, 0 extra; 0 writes before Apply | **Re-graded on `8ee6258`:** live model runs (drafted_by=model) **3/3 exact**: 1 task, $50/month pledge, RSVP to the beach cleanup, 2 context notes, 0 extra, 0 writes before Apply; Apply wrote each once. (Earlier FAIL: 2/3, extra tag_interest) | `11_after_call.txt` | **PASS** |

**Totals:** 14 PASS · 0 FAIL · 0 waits (13 §21.10 rows + after-call). Rows were graded on the `main` commit named in each row; the final pass re-runs the end-to-end rows on the release commit.

**Regression (requested by the lead after #107):** create a task on a donor page → it shows on the home →
Mark done on the home → shown done on the donor page. **PASS** on `f84f35b`: task 22 created for Priya
Raman, visible on the home, "Mark done" in Task details set `done: true`, and Priya's Tasks tab shows it
checked. 0 console errors, 0 4xx/5xx (`regression_walk.txt`, `reg1`–`reg3` screenshots).

**Criterion change pending:** the lead relayed a new wording for row 7's duplicates half from Sharif:
- fuzzy and possible duplicates stay pending until staff approve;
- exact identity matches may merge automatically, but each shows a "!" review icon with Keep and Split;
- after a Split, the gift history and the answer-key totals are unchanged.

Row 7 will be re-graded to that wording when a4's and 80's PRs land. Per the plan's rules, the change
should also be recorded in `plan.md` §21.10.

## Open findings (not criteria failures; each needs an owner or a decision)

1. **Ingest double-counts the double-recorded $500 check in some runs.** One of my two live UI first runs on
   `d555d39` counted 132 ok gifts = $1,368,035 (the key's planted double-recorded check counted twice); the other
   counted 131 = $1,367,535, as did the QA checker's 2 runs on `5ecf010`. The money test (row 6) passes because
   it builds from the key; a live upload can still be off by $500. Owner: a4, in its data sweep (3 cold uploads +
   1 warm). Re-measure: 3 back-to-back live uploads, all 131 / $1,367,535.
2. **The public `snapshot.json` carries every contact unmasked** (141 email and 64 phone values). The public
   build masks them on screen only, so anyone can read them from `/snapshot.json`. The data is fictional today;
   if real data is ever exported, mask in `export_snapshot.py`. The lead ruled it acceptable for the fictional
   demo data; Sharif to confirm.
3. **Test artifacts committed to `main`:** `fac5a71` added 68 Vitest failure screenshots under
   `web/.vitest/`, with no ignore rule; their long names break `git worktree add` in deep folders. Fix: #166 (in
   review).
4. **#137 (public tunnel) is not merged** and is graded outside this table: the transcript leak is fixed; a
   private Donors-tab task title still leaks through `/people` (next_step), `/calendar` and `/tasks` under
   public mode; the branch needs a rebase. The tunnel stays off until it passes.

## Failures and recommendations (all four are resolved; kept as the record of what was fixed)

### 3. First run: no events, invites or prep tasks
- **Cause:** §21.2.2 step 3 promises "events + audiences + pre-drafted invites → task generator" from the
  first run. Today only the daily refresh (`service/refresh.py`: `extract_events` → `save_events` → invites
  → `tasks.generate`) reads events, and onboarding never calls it.
- **Second bug:** `POST /events/refresh` returns 503 ("`service.events_agent.refresh_events` has not landed"),
  because `events_agent.py` has `extract_events`, not `refresh_events`.
- **Fix:** make the onboarding context run finish with the same pass as `run_refresh()` (or start
  `start_refresh_job()` right after `/context/run` saves). Then point `/events/refresh` at the real function.
- **Re-measure:** a fresh first run shows ≥1 event, invites and a prep task for Give Miami Day.

### 5. Campaigns: a declined charge is written as a gift
- **Cause:** the drafts read gift history with no status filter, so a declined charge counts as a gift.
  [`service/routes_campaigns.py:69`](../../service/routes_campaigns.py) and
  [`service/outreach_agent.py:492`](../../service/outreach_agent.py) both `SELECT ... FROM gifts WHERE donor_id = ?`.
- **Fix:** add `AND status = 'ok'` (guarded on the column existing). Add a test where a donor's newest charge
  is declined and the draft must not mention it.
- **Re-measure:** draft 5 again including Hye-jin Park; 0 false facts.

### 7. Challenge #2: half the duplicate groups merge without approval, and alert tasks go stale
1. **Groups merged without approval.** `service/ingest_adapter.py:319` auto-merges exact identity (same email,
   or same written name). This is a decision, not a bug. Either:
   - **(a)** propose exact matches as high-confidence pending suggestions (same card, one click), so 6/6
     go to staff; or
   - **(b)** Sharif changes the criterion to "6/6 caught: fuzzy ones proposed for approval, exact ones merged
     at ingest with a visible log and Undo". That change is Sharif's to make, recorded in plan.md.
2. **Alert tasks don't follow merges.** Merging can create or remove an alert, and `tasks.generate()` runs only
   after upload and refresh. Fix:
   - call `tasks.generate()` after `POST /duplicates/{id}/merge`, after `POST /merges/{id}/undo`, and in
     `agent_writes.merge_duplicate`/undo;
   - have the generator retire open alert call tasks whose alert no longer exists, as it already does for
     duplicate reviews.

   Measured on a copy: a manual generate after the merges gives 5/5, but 1 stale task remains.

### + After-call routing: an extra action in 1 of 3 live runs
- **What happened:** run 1 proposed `tag_interest` beyond the expected 5.
- **Fix:** in `service/after_call_agent.py`, only allow `tag_interest` when the supporter states an interest
  in so many words ("I care about..."), and drop it in the post-check otherwise. Or Sharif accepts
  `tag_interest` as allowed.
- **Re-measure:** 3 more live runs; 3/3 exact.

## Findings that are not failures

- **Enrich (row 8), wrong entity.** The fictional "Whitaker Family Charitable Fund" received `youth_family`
  sourced from a South Carolina organization's report. The identity check accepted a name-only match. The
  criterion says "made-up person", so the row passes as written. Recommend an identity rule for
  organizations: city or state must match, or the tag is dropped.
- **Transcription (row 9), dropped words.** Words were dropped where one final segment ends, in both live
  runs ("December"). SMART dictation kept them.
- **Contract drift.** §21.5 calls the context field `source_url`; the API returns `url`.
- **Empty start.** With 0 events stored, `/home/summary` still names Give Miami Day as the next event, from a
  built-in date. Outside row 1's tables, so not a failure.
- **Enrich criterion.** The example files contain only fictional organizations, so "3 sample orgs" can only
  mean real ones. I used Knight, DeLuca and McDermott, as the builder did.
