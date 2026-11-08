# RESUME HERE: state at ~2:00 AM Sun Nov 8 (lead = "Ideas", now session devday-hackathon-fb)

Freeze: **Sun Nov 8, 4:15 PM ET**; repo public + MIT by 3:30 PM. Plan of record: `plan.md` §21. Map: `docs/ui-integration.md`.
Workflow: builders → PR → QA approves exact SHA → lead merges `gh pr merge N --merge --match-head-commit <sha>` →
session 12's watcher auto-deploys main to Vercel → 12 walks prod → c9 grades §21.10 at the end.

## Main = c28e2ac (green; #108 docs merged on top of 5ecf010)
Merged after resume: #103 voice pause labels, #88 interest tags, #90 after-call agent, #106 snapshot privacy fix, #102 schema race.
Earlier: #73 #77 #80 #57 #68 #81 #82 #79 #83 #89 #87 #91 #99 #94 #97 #96 #98 #100; Christian #78 #84 #85 #86 #93 #92; Faye #105 (dashboard design).

## Sessions after restart (names changed; reply via the `from=` pipe address, two are both "devday-hackathon-82")
| New name | Was | Doing now |
|---|---|---|
| db | c9 | Independent §21.10 grading on main → docs/progress_reports/evaluation_scorecard.md on branch eval/scorecard |
| 82 (pipe …52516c51) | 98 QA | Reviewing #108 (docs), #109, independent #107 walk; queue #110, #112, #113 |
| 1b | 12 | Vercel auto-deploy watcher running (restarted 01:24); walks prod per SHA |
| 0f | 90 | Reviewing #112; owns #111 (+ add_contact stacked, head 0c3c9c5; switching default tab to "giver") |
| d1 | 42 | Enrich UI (chips, Save to profile, one wording) + importDonors target "giver" fix; PR coming (base feat/home-integration-2) |
| 82 (pipe …149b4923) | 80 | #110 done (phone Calendar); NOW Givers/Neighbors/Community tabs on Donors page + add_contact refetch scope |
| 33 | 3a | #109 context-note undo (in QA) |
| e6 | 86 | #108 README + demo script: fixing QA's CHANGES |
| 3c | Agent Phone | 🎙 dictation in Ask sidebar + home composer (composer on top of #112's branch) |
| a4 | 8b | scripts/demo_reset.py (reset to empty, --warm ingest cache, --check vs answer key, print start commands) |
In-session lead subagents: reviewing #107 and #111.

## Open PRs
| # | What | Base | State |
|---|---|---|---|
| **#107** | Faye's #105 design + real-data home (supersedes #95) | main | in-session reviewer + QA walk running; MERGE FIRST, then close #95 |
| #111 | Agent tools live (interests, RSVP, after-call) + add_contact (0c3c9c5) | main | in-session review |
| #112 | Agent chat in home (supersedes #101) | feat/home-integration-2 | 90 + QA reviewing; retarget to main after #107; then close #101 |
| #113 | Calendar shows tasks; outreach plan = real tasks (supersedes #104) | feat/home-integration-2 | QA (with #110); retarget after #107; close #104 |
| #110 | Phone Calendar route | feat/home-integration-2 | QA; conflicts on CalendarPage with #113 (rebase whichever lands second) |
| #108 | README + demo script | main | **MERGED c28e2ac** (step 8 Knight beat gated on #111 + 42's Enrich UI; update labels when they land) |
| #109 | Context-note undo | main | **MERGED** |
| #95 #101 #104 | superseded | — | close when replacements merge |
| #76 #69 #70 | parked | — | don't merge |

## Decisions (Sharif)
- Enrich demo = option (b): add the REAL "John S. and James L. Knight Foundation" by hand as a contact with NO gifts (agent: "add the Knight Foundation as a contact", or Import a one-row CSV), then Enrich → cached sourced tags → Save to profile. Example data stays fictional; never invent gifts for real orgs.
- Laptop demo; Miami Foundation as example org; Sharif writes the call script.
- Pending: README wording on Codex (lead recommends "Codex wasn't used; built with Claude Code; OpenAI API + Agents SDK throughout"); brand "kindred" (landing) vs "Donor Desk" (lead recommends Donor Desk everywhere).

## Known gaps
- Neighbors/Community not visible in the web app until 80's tabs PR.
- No create-contact route except via ingest or 90's add_contact.
- Landing picker should skip answer_key.json / _README.md (unassigned; onboarding step already skips them).

## Demo checklist
Warm-up upload first (or `scripts/demo_reset.py --warm`); web on 5173/5174 (WS Origin check); VITE_DATA_MODE=local;
say "Give Miami Day donors" not "gala"; drag the 7 input files only; counts 68 / 33/20/15 after approving duplicates;
Enrich only the hand-added real org.

## Watches to re-arm after compaction
Main-merge monitor (45 s fetch, flags Christian/Faye) and Slack cron on #codex-dev-day-hackathon (C0CFX659JEQ, baseline 21:34 EST Nov 7).
Prod: https://devday-donor-desk.vercel.app. Lead deploys by hand only if 12 is down (from C:/Users/Shari/wt/main-check/web, .vercel/project.json copied from ../dd-deploy/web).

## Update ~2:30 AM
- Merged: #108 (c28e2ac), #109 (9a02c05). Main green except intermittent test_ingest_adapter e2e (fuzzy Tamarind Quay count) — 8b fixing dedupe (individual with org_name treated as org).
- #111 approved at 56dd69f but head moved to ce7ff67 (add_contact, default giver, known_name) → in-session re-review running.
- #112 approved by 90 at 815be5d (decided cards labelled); QA formal pass pending; merges after #107.
- New PRs: #114 (8b demo_reset.py; in QA). 80 tabs PR, 42 Enrich UI PR, Agent Phone dictation PR coming.
- c9 scorecard (eval/scorecard @981c4a8): 8 PASS / 3 FAIL / 3 wait-on-#107.
  FAIL campaigns (declined Oct 10 Park charge thanked) → 86; FAIL challenge-2b (tasks stale after merges) → 3a;
  FAIL after-call extra tag_interest → 86; FAIL challenge-2a (exact-match groups auto-merged without staff approval)
  → **SHARIF DECISION**: lead recommends showing exact matches as one-click high-confidence pending cards.
  Findings: Whitaker fund mis-enriched by name-only match → 42 identity rule; live transcript drops a word at
  segment boundaries → Agent Phone.
- **#107 MERGED (f84f35b)** ~2:45 AM on in-session APPROVE. #95 closed. #110/#112/#113 retargeted to main (all MERGEABLE) → QA grading (#110+#113 together). 12 walking prod; c9 grading the 3 rows that waited on #107.
- ~3:00 AM: #114 MERGED (8f6aa51, demo_reset.py: run `python scripts/demo_reset.py --warm` before rehearsals). #115 Enrich UI (a391e58, base main) → in-session reviewer running. #116 Ask dictation (a7db7de) → QA queue. Agent Phone doing composer mic on top of feat/homechat-agent-2 + graceful stop. 42 next: home layout overlap at 1440x900 ("Files & drafts" covers Find a donor) + "Enrich again" through review, then org identity rule. In-session reviews running: #111 (ce7ff67), #115.
- Still pending Sharif: exact-match duplicates (lead recommends one-click review cards), Codex wording, kindred vs Donor Desk.
