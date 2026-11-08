# RESUME HERE: paused Sun Nov 8, ~12:30 AM ET

Paused by Sharif (going home). Nothing merges while paused. Freeze: **Sun Nov 8, 4:15 PM ET**; repo public with MIT by 3:30 PM.
Plan of record: `plan.md` §21 (approved). Element→endpoint map: `docs/ui-integration.md`.

## How to resume (lead session)
1. Re-arm the watches: main-merge monitor (45 s fetch, flags Christian/Faye merges) and the Slack check of
   #codex-dev-day-hackathon (C0CFX659JEQ) every 10 min.
2. Ask session 12 to restart the Vercel auto-deploy watcher (stopped for the pause; prod = b3510bf). Its restart command (run in background):
   `bash "C:/Users/Shari/AppData/Local/Temp/claude/c--Users-Shari-Dropbox--Personal--GenAI-Company-Projects-devday-hackathon/162c5294-4385-421c-b6f5-ba90db1418e8/scratchpad/watch-deploy.sh" "C:/Users/Shari/Dropbox (Personal)/GenAI Company/Projects/devday_hackathon" "C:/Users/Shari/Dropbox (Personal)/GenAI Company/Projects/dd-deploy" "C:/Users/Shari/AppData/Local/Temp/claude/c--Users-Shari-Dropbox--Personal--GenAI-Company-Projects-devday-hackathon/162c5294-4385-421c-b6f5-ba90db1418e8/scratchpad/deploy-watch.log" 30`
3. Send each session "resume" plus its line below. Merge only on a QA APPROVE pinned to the exact SHA
   (`gh pr merge N --merge --match-head-commit <sha>`).

## Main
Main is at **b3510bf** (Faye's #105 "Apply the approved Donor Desk dashboard design", merged during the pause
call). Main has **1 failing test**: `test_crm::test_snapshot_never_exports_crm_records`, a privacy leak where
#100 moved Donors-tab tasks into `tasks` and #98's export ships `tasks` to the Vercel snapshot. 3a owns the fix.

Merged tonight (18 + Christian's + Faye's): #73 #77 #80 #57 #68 #81 #82 #79 #83 #89 #87 #91 #99 #94 #97 #96 #98
#100; Christian #78 #84 #85 #86 #93 #92; Faye #105.

## Open work, in priority order
| # | What | Owner | State at pause | Next step |
|---|---|---|---|---|
| leak | Exclude Donors-tab (crm) tasks from every snapshot export | 3a | **PR #106 done, head c78df8a** (424 passed; leak test green) | review (c9) → merge FIRST (main is red) |
| #95 | Real data on the home (tasks, glance, CRM, gauge, calendar, artifacts), Projects removed, overflow, phone header | integration agent (in-lead subagent) | head e93e231; QA 98 PARKED mid first-run walk (no verdict) | **Faye's #105 rewrote HomePage/HomeCards/HomeChat/Header/MobileLayout**: merge main into #95 keeping #105's design and #95's data wiring, re-walk, then QA |
| #88 | Interest tags (+ tag_slugs) | 42 | **QA APPROVED 5f444aaa7a83700414888493069853f8c6309f58** | merge on resume (pinned; check it still merges with b3510bf) |
| #90 | After-call agent | 86 | **QA APPROVED 009e6701093ca36842dc9629e4e5f529d3b8c963** | merge on resume (pinned) |
| #102 | Schema-migration race | in-lead builder | c9: fix passes, CHANGES = main.py conflict with #100's startup hook | rebase: migrate_schema first, then migrate_crm_tasks; c9 re-check |
| #103 | Voice: pause-then-summarize relabels every stretch | Agent Phone | **c9 APPROVED 6e91849ab7e098f2ee6f5805ca331f80e1a44439** | merge first thing on resume (pinned) |
| #101 | Center chat → agent (step cards, Undo, approval cards) | 90 | based on #95 | retarget to main after #95; also must merge with #105's HomeChat changes; QA 98 |
| #104 | Calendar page shows tasks; outreach plan = real tasks | integration agent | based on #95 | retarget after #95; QA |
| — | Mobile "Sample data" badge | 80 | **likely already done by Faye's #105** (12: badge shows on phone, +80px overflow gone) | verify after #95 merges; skip if still present |
| — | Agent tools live: interests, RSVP, after-call | 90 | branch feat/agent-tools-live 97de253 | open PR after #88 + #90 merge |
| — | Calendar route on phone ("Not Found" at 390) | unassigned | — | assign after #95 |

## Sunday morning (after the above)
1. c9 grades every §21.10 criterion and loops until all PASS.
2. README + demo script (session 37 or a writer agent), including the demo checklist below.
3. Three rehearsals from an empty DB, after one warm-up upload.
4. History check (TEAM_CONTACTS.md, docs/judges.md, transcripts/ never committed) → repo public + MIT → tag `demo`.

## Demo checklist (goes into README / demo script)
- Do one warm-up upload of the same files first, so the duplicate-card count is fixed (9 or 10 cold).
- The web app must run on port 5173 or 5174 (the WS relay checks Origin against CORS_ORIGINS).
- Say "Give Miami Day donors", not "gala donors" (the example data has no gala).
- Until #103 merges: click Generate summary without pausing first.
- Laptop live mode: VITE_DATA_MODE=local, VITE_API_URL=http://127.0.0.1:<port>.

## Decisions still open for Sharif
1. Enrich individuals on the web, or organizations only (lead recommends organizations only)?
2. Demo script wording "Give Miami Day donors" vs adding a gala to the example files?

## Sessions (Cursor tabs are titled by first prompt, not by session name)
3a tasks · 42 interests · 86 context/after-call · 90 [113a1a] agent tools/chat · 80 web hooks · Agent Phone voice ·
98 QA · c9 second reviewer/evaluator · 12 deploy watcher + walks · 37 writer (unbriefed) · 90 [58e3c2] reserve.
Sessions 8b and 48 hold messages for approval; their work moved into lead-session builders.

Prod check at pause (12): /snapshot.json is clean of Donors-tab text ("crm" 0, "Private" 0, all task sources = generator). #105 walk PASS desktop + phone, 0 console errors.
