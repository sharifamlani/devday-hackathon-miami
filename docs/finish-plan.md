# Donor Desk: finish-line plan (for Sharif's approval)

> Status: **NOT APPROVED.** No build starts until Sharif approves. Detail lives in `plan.md` §19–§20.14,
> `docs/ui-integration.md` (every mockup element → endpoint → owner) and `docs/research/`.
> Freeze Sun Nov 8, 4:15 PM. Demo runs on the laptop. Example organization: The Miami Foundation.

## 1. What we ship

Christian's Donor Desk mockup (`docs/design/mockup/`), running live on the laptop, where **every record comes from
files a person drags in** and **the main-UI agent can do everything**.

### 1.1 Nothing is preloaded: the app starts empty
- The only data source is the example dataset in `data/sample_inputs/` (all fictional): an Excel export, Word docs,
  board notes, intake forms, a sign-in sheet. Staff copy those files and drag them into the upload screen.
- The app ships with **no seeded people, gifts, tasks or context**. Today it does not: `service/db.py` has
  `SEED_DONORS` and a seed step, and "Try sample data" loads a cached snapshot. Both are removed from the laptop path.
- Committed web caches (`data/research_cache.json`, `icp_cache.json`, `social_cache.json`,
  `service/context_cache.json`) are not loaded at start. They are used only as an offline fallback when a live call
  fails, and anything served from them is labeled "cached".
- The Q4 gauge reads 0.5% because the example files have $750 of Q4 gifts. Fix it **in the example files**: add a
  fictional Oct–Nov 2026 online-gifts sheet, and update `answer_key.json`, so the number still comes from an upload.
- The public Vercel URL stays a read-only snapshot, exported from the laptop database after an upload of these files.

### 1.2 First run
```
1. Drag in the example files --> ingest (Carlos) --> people + gifts (tabs: Givers / Neighbors / Community)
2. "Tell us about your organization": website (required) + X / LinkedIn / Instagram
3. Context agent runs on its own, with live progress:
      website + news + public posts --> context store (RAG, ordered by time, newest first)
      --> events + audiences --> task generator --> alerts
4. Dashboard: every panel and the agent read the people/gifts tables and the context store
   The daily refresh re-runs step 3: new items go on top, tasks re-generate
```

### 1.3 The context store: RAG ordered by time
- Every item the context agent finds is one row: `kind` (success_story · program_update · use_of_funds ·
  org_health · event · news · other), `title`, `text`, verbatim `quote`, `source_url`, `posted_at`
  (or `captured_at` when the page shows no date), and an `embedding` (OpenAI `text-embedding-3-small`, stored in SQLite).
- Retrieval: `search_context(query, kinds, k)` ranks by relevance weighted by recency (newer first; ties go to the
  newest). Without a query it returns the newest items of the asked kinds.
- Builds on the existing `org_context` table (adds kind, title, embedding); no new database.
- Every item keeps its URL. Nothing is invented; a source that can't be read is labeled, never faked.

### 1.4 Campaigns always tell the story
Every donor campaign, thank-you and outreach draft pulls from the context store before writing:
- at least one **success story** (what the organization achieved, with whom),
- one **use of funds** line (how money is being spent),
- one **organization health** line (how the organization is doing),
- newest items first, each cited with its source link on the review screen.

If the store has none of a kind, the draft says so to staff and leaves it out; it never invents one.

### 1.5 Other rules
- **Everything runs through the main-UI agent.** It updates the CRM, the calendar and tasks. Edits apply at once with
  Undo; sends, merges and deletes need an approval click; the agent calls the same service functions as the buttons
  and the panels refresh after every write; every agent write is logged.
- **Enrichment's main job is interest areas:** 17 tags (`docs/research/interest-areas.md`), each with a source;
  no source, no tag; staff edits win; Enrich proposes, **Save to profile** writes.
- **Voice on Gemini 3.5 Transcribe:** `gemini-3.5-transcribe-live` for 🎙 dictation in the chat box (stores nothing)
  and live call transcripts; `gemini-3.5-transcribe` on the recording at call end for speaker names. The key stays
  on our server. Summaries stay on the OpenAI Agents SDK.
- **Agent framework: OpenAI Agents SDK + assistant-ui** (the event requires the SDK; it already runs `/chat`).

## 2. Builds and owners

| # | Build | Session | Wave |
|---|---|---|---|
| — | #73 crash fix, #69 Ask panel: QA, then merge | 98 → lead | now |
| **D1** | **Empty start:** remove the seed from the laptop path; caches as labeled offline fallback only; "Try sample data" becomes "drag in the example files" | **8b** | 1 |
| **D2** | **Example dataset:** add a fictional Oct–Nov 2026 online-gifts sheet; update `answer_key.json` and the README | **8b** | 1 |
| **C1** | **Context store (time-ordered RAG):** kind, title, embedding on `org_context`; `search_context`; context agent classifies each item; daily refresh adds new items on top | **86** | 1 |
| **C2** | **Campaigns tell the story:** campaign, thank-you and outreach agents call `search_context` (success story + use of funds + org health, newest first) and cite sources | **86** | 1 |
| **B11/B12** | Tasks (real table, CRUD, generator), calendar feed, Artifacts; step 3 ends by generating tasks | **3a** | 1 |
| **B1** | Interest tags: propose → Save to profile, staff wins | **42** | 1 |
| **B2/B13** | Money by quarter + reached today; home summary; CRM badges | **48** | 1 |
| **B3** | Voice: live relay (calls + dictation), file pass for speaker names, call notes + summary | **Agent Phone** | 1 |
| **B9** | Web hooks for every new endpoint (mocked until each lands), dictation hook, refresh-after-agent helper | **80** | 1 |
| — | Deploy monitor: **auto-deploys every main commit to Vercel (kept, Sharif)** + browser walk per merge; the lead never deploys separately | **12** | running |
| **B6** | After-call agent: proposes tasks, RSVP, pledge, context → Apply | **90 [58e3c2]** (reserve session) | 2 |
| **B10** | Agent tools: read + write CRM, calendar, tasks, call notes, context search; Undo; approval cards | **90 [113a1a]** | 2 |
| — | Close #49 / #57 | 86 + 98 | 2 |
| — | Screens from `docs/ui-integration.md` | Christian; **Sharif drives integration** when Christian's draft arrives | 1–2 |
| — | QA: one parallel subagent per PR | **98** | all |
| — | Independent evaluator: grades §6, loops until all pass | **c9** | Sun |
| **B5** | README, demo script, repo public with MIT | **37** + lead | Sun AM |
| — | Demo call script and cast | **Sharif** | — |
| — | Contract upkeep, merges pinned to approved SHAs, ROADMAP | **lead** | all |
| Stretch | Twilio phone recording; Community impact by zip; payout-change hold named as a limit | — | only if all pass |

Code to lift (`docs/research/repos-to-lift.md`): assistant-ui tool UI + approval cards, prompt-kit chips,
`assistant-stream` (Python) + a ~100-line Agents SDK event mapper, the Agents SDK human-in-the-loop examples,
Google's live-api-web-console audio capture (Apache-2.0, keep headers), shadcn calendar / command / radial chart,
a ~60-line Gemini relay of our own.

## 2.5 How we build it: the loop and each agent's build card

### The loop every agent follows (the shipping flywheel)
```
lead sends a 5-field brief (CONTEXT / OWNS / TASK / DONE WHEN / RETURN)
  --> agent: git worktree add --no-track <branch> origin/main (outside Dropbox); push -u; confirm @{upstream} != main
  --> agent: copy the listed code first, adapt minimally; write tests from the smoke list first
  --> agent: open a PR early (schema + stubs) so others can rebase; push small commits
  --> QA 98: one subagent per PR, runs the build's smokes + full pytest + contract check --> APPROVE <sha> or CHANGES
  --> lead: gh pr merge --merge --match-head-commit <sha>; flips ROADMAP; tells dependents to rebase
  --> 12: auto-deploys main to Vercel within 30 s; walks the laptop + Vercel paths; posts counts
  --> c9 (Sunday): grades the criteria; FAILs go back to the owning agent
```
Rules for every agent: never push to main; touch only the files in OWNS; add tables with `CREATE TABLE IF NOT EXISTS`
in the landing order below; new routers get one `include_router` line in `main.py`; every write the agent can make
is a service function that returns an undo token (so the chat tools in B10 can wrap it); no seeded data, ever.

### Build cards

**8b: D1 empty start + D2 example dataset (wave 1)**
1. Make `reset_db()` / startup create the schema with no seed by default; keep `SEED_DONORS` only for tests (move it under `service/tests/`).
2. Remove the "Try sample data → cached snapshot" path from the laptop build; the landing points to "drag in the files from `data/sample_inputs/`".
3. Load web caches only inside the live call's `except` branch, and tag those rows `cached=1` so the UI can label them.
4. Generate a fictional `online_gifts_oct_nov_2026.xlsx` with the existing generator script; update `answer_key.json` (gifts, totals, per-quarter) and `_README.md`.
5. Tests: fresh start has 0 rows; upload of the folder matches the key. Hands off to: 48 (new totals), 12 (walk from empty).

**86: C1 context store + C2 story-first campaigns (wave 1)**
1. Add columns to `org_context`: `kind`, `title`, `embedding` (BLOB), `cached`; backfill none (empty start).
2. In `org_context.py`, the context agent classifies each found item into a kind with structured output (enum), then embeds `title + text` with `text-embedding-3-small`.
3. `search_context(query=None, kinds=None, k=8)`: cosine similarity in numpy over the rows, times a recency weight (half-life 90 days), newest first on ties; no query = newest of the asked kinds.
4. Campaign, thank-you, outreach and event-invite agents call `search_context(kinds=[success_story, use_of_funds, org_health])` before drafting; the prompt must use ≥1 of each when present and cite each by id; the draft carries `sources[]`; a post-check rejects drafts with uncited claims.
5. Tests: rows ordered newest first; 5 campaign drafts each cite all three kinds; 0 claims without a source id. Hands off to: 90 (tool `search_context`), 80 (campaign review shows sources).

**3a: B11/B12 tasks, calendar feed, artifacts (wave 1; critical path)**
1. `tasks` + `agent_actions` tables (lands first in `db.py`).
2. `/tasks` CRUD and service functions with undo tokens; `undo(token)`.
3. `POST /tasks/generate` (idempotent) from alerts, duplicates, first-time donors, events within 14 days; call it at the end of the onboarding context run and the daily refresh.
4. `/calendar` (events + dated tasks, `source` marks "added by agent"), `/artifacts` (drafts now, call notes when that table exists).
5. Tests: one call per expected alert (5), one review per duplicate group, rerun adds 0; CRUD + undo. Hands off to: 48 (tasks_today), 90 and the B6 agent (write tools), 80 (hooks).

**42: B1 interest tags (wave 1)**
1. `interest_tags` (seeded with the 17 approved tags; reference data, not donor data), `interest_subtags`, `donor_interests`.
2. Enrich agent: structured output with the 17 slugs as an enum, plus `contact{}`; identity check; empty when ambiguous.
3. `POST /enrich/{id}?dry_run=1` proposes; `/people/{id}/enrichment/accept` writes; add/remove routes; staff rows never overwritten.
4. Tests: smokes 9; 3 live runs on sample organizations. Hands off to: 90 (`add_interest`, `remove_interest`, `accept_enrichment`, `find_people(interest=)`), 80.

**48: B2/B13 money and home (wave 1)**
1. `targets.quarters()` + `/targets/quarters`; `reached_today` on `/targets`.
2. `/home/summary` (glance counts, next event, suggestion chips from today's tasks) and `/people/attention` (badges).
3. Guard missing tables (tasks, call_notes) until 3a and Agent Phone merge, then switch to real queries.
4. Tests: quarters equal the updated answer key; gifts at risk = 5. Hands off to: 80.

**Agent Phone: B3 voice (wave 1)**
1. `transcribe.py`: a ~60-line FastAPI WebSocket relay to `gemini-3.5-transcribe-live` (two asyncio loops: browser → Gemini audio, Gemini → browser interim/final). `purpose=dictation` uses SMART mode and stores nothing.
2. `POST /transcribe/file`: `gemini-3.5-transcribe` with speaker diarization on the recorded call.
3. `call_notes` table + save/list routes; summary by an OpenAI Agents SDK agent; `save_call_note` returns an undo token.
4. Smoke scripts for the key and the relay; tests for persistence. Hands off to: 80 (audio capture + hooks), B6 agent (reads notes), 90 (tool).

**80: B9 web hooks (wave 1)**
1. Types + hooks for every endpoint in `docs/ui-integration.md` §2, returning contract-shaped mocks first.
2. Lift Google's live-api-web-console audio capture (Apache-2.0, keep headers + NOTICE) into `providers/local/audio/`; build `useDictation()` and `useCallTranscript()` on it (template: assistant-ui's dictation adapter example).
3. A refetch helper the chat calls after every agent write (tasks, calendar, people, targets, summary, context).
4. Flip each hook from mock to real as its PR merges. Tests per hook; snapshot build still renders. Hands off to: Christian's screens (Sharif integrates).

**90 [113a1a]: B10 agent tools (wave 2)**
1. Wrap every service function above as an Agents SDK tool (reads: people, alerts, events, calendar, tasks, call notes, `search_context`; writes: CRM, interests, calendar, tasks, call notes, after-call apply).
2. Writes return undo tokens shown as Undo in the thread; sends, merges and deletes use the SDK's human-in-the-loop approval (copy `examples/agent_patterns/human_in_the_loop_server.py`).
3. Stream events to assistant-ui with `assistant-stream` plus a ~100-line event mapper; tool steps render as tool UI cards.
4. Tests: each write tool changes its row and Undo restores it. Hands off to: 12 (walk), c9 (grading).

**90 [58e3c2]: B6 after-call agent (wave 2)**
1. Agents SDK agent with `output_type` = a Pydantic list of typed actions (`create_task`, `rsvp_event`, `record_pledge`, `add_context_note`, `tag_interest`).
2. `/call-notes/{id}/actions` proposes; `/apply` calls 3a's and 42's service functions; pledges table + `event_audience.rsvp` column.
3. Tests on a recorded transcript: expected actions, nothing written before Apply. Hands off to: 90 (tool `apply_after_call_actions`).

**Christian + Sharif: screens**
Christian builds the mockup screens; when the first draft is ready he messages the team, and Sharif wires them to 80's
hooks. Each screen then goes through the same loop (PR → QA → merge → auto-deploy → walk).

**98 QA · 12 deploy monitor · c9 evaluator · 37 writer · lead**
- 98: standing pool of review subagents, one per PR, target < 30 min per review.
- 12: auto-deploy of main (kept) + laptop and Vercel walks, numbers per SHA.
- c9: grades §6 from Sunday 9 AM, loops until every criterion passes.
- 37: README (models, how to run from an empty start, limits) and the demo-script skeleton for Sharif.
- Lead: briefs, contract upkeep, merge order, ROADMAP flips, unblocking, status to Sharif.

### Hand-offs and landing order
| Order | Lands | Unblocks |
|---|---|---|
| 1 | 3a `tasks`, `agent_actions` | 48 tasks_today, B6, B10 |
| 2 | 8b empty start + new example sheet | 48 totals, 12 walk from empty |
| 3 | 42 interest tables | B6 `tag_interest`, B10 |
| 4 | Agent Phone `call_notes` | 48 reached_today, 3a artifacts, B6 |
| 5 | 86 `org_context` columns + `search_context` | C2 campaigns, B10 |
| 6 | B6 pledges + RSVP | B10 `apply_after_call_actions` |
| 7 | B10 tools | full agent-first walk, c9 grading |

80's hooks run in parallel the whole time (mock first, real on each merge).

## 3. Files touched

```
service/
├── db.py                  new tables/columns only, in order: 3a tasks → 42 interests → Agent Phone call_notes
│                          → 86 org_context columns → 90 pledges/rsvp; 8b removes the default seed call
├── org_context.py         86  classify items by kind, embed, search_context (relevance x recency)
├── campaign_agent.py, outreach_agent.py, event_outreach.py   86  pull success story / use of funds / org health
├── tasks.py, routes_tasks.py                 3a  tasks, generator, calendar feed, artifacts, undo log
├── interests.py, routes_interests.py, enrich_agent.py        42
├── targets.py, routes_targets.py, routes_home.py             48
├── transcribe.py, call_notes.py, routes_voice.py             Agent Phone
├── after_call_agent.py, routes_after_call.py                 90 [58e3c2]
├── chat_agent.py                                             90 [113a1a]
└── main.py                one include_router line per new router
data/sample_inputs/        8b  new Oct–Nov 2026 gifts sheet, answer_key.json, _README.md
web/src/components/atomic-crm/providers/local/   80  hooks, dictation, audio capture
scripts/                   smoke-gemini-live, smoke-transcribe-ws, verify-e2e cases (12)
```
`donors` and `service/ingest/` stay untouched (🔒 Carlos).

## 4. How it runs
```
[drag example files] --> ingest --> people + gifts --> quarters / summary / attention --> left column
[org website + socials] --> context agent --> context store (RAG, newest first) --> events --> task generator
tasks --> task card · task list · calendar feed
[Create campaign] --> campaign agent --> search_context(success_story, use_of_funds, org_health)
                  --> drafts citing sources --> approval card --> send
[Enrich] --> proposals --> [Save to profile] --> interests + facts
[🎙 in chat] --> live transcribe --> words in the input box (nothing stored)
[Call and transcribe] --> live transcript --> speaker names at call end --> [Save note]
      --> call_notes --> after-call agent --> [Apply] --> tasks · RSVP · pledge · context
agent chat --> tools --> same service functions --> panels refresh
```

## 5. Smoke tests (dependency order; each passes before the next step)

| # | Proves | Expected |
|---|---|---|
| 1 | Empty start | fresh database after start: 0 people, 0 gifts, 0 tasks, 0 context rows |
| 2 | Upload is the only source | drag `data/sample_inputs/*`: counts match `answer_key.json` (people per tab, gifts, total) |
| 3 | Gemini key reaches the live model | final text contains the scripted words |
| 4 | New tables create; `donors` unchanged | pytest schema checks pass |
| 5 | Context store fills and orders by time | after step 2 of onboarding: every row has kind + source_url; newest-first query returns descending dates |
| 6 | Campaign drafts tell the story | 5 drafts: each cites ≥1 success_story, 1 use_of_funds, 1 org_health item from the store; 0 uncited claims |
| 7 | Task generator | one call per expected gift alert (5) + one review per open duplicate group; rerun adds 0 |
| 8 | Money is exact | quarters equal the updated answer key; Q4 gauge reflects the new Oct–Nov sheet |
| 9 | Enrich | only the 17 tags, each sourced; nothing written until Save; 0 tags for a made-up person |
| 10 | Voice | interim + final through our server; file pass returns speaker labels; note survives restart; dictation stores nothing |
| 11 | After-call | expected actions proposed; Apply writes them |
| 12 | Agent does everything | each write tool changes its row, the panel updates without reload, Undo restores |
| 13 | End to end on the laptop | empty start → drag files → org website → dashboard → chat → campaign → Enrich → call → Apply; 0 console errors |

## 6. Definition of done (graded by c9, not the builders)

| Criterion | Threshold | How measured |
|---|---|---|
| Nothing preloaded | 0 rows of people, gifts, tasks, context before the first upload | SQL on a fresh start |
| Everything traces to the example files | 100% of people and gifts map to a file row in `answer_key.json` | QA script |
| Context store is sourced and recent-first | 100% rows with source_url; newest-first order holds | SQL |
| Campaigns tell the story | 100% of drafts cite ≥1 success story, 1 use of funds, 1 org health item; 0 invented facts | review of 5 drafts + citation check |
| Money is exact | matches the answer key; pledges never count | pytest |
| Enrich tags | ≥2 of 3 sample orgs get a sourced tag; 0 outside the 17; 0 for a made-up person | API runs |
| Transcription | first words < 2 s; ≥90% word match on a scripted read | smoke + WER |
| Agent does everything | every write tool works from chat; panel updates; Undo works; 0 sends/merges/deletes without a click | Playwright + SQL |
| Key stays server-side | 0 Gemini key in the bundle or network | grep + network log |
| Demo path clean | 0 console errors, 0 failed requests on the laptop and the Vercel snapshot | Playwright |

## 7. Timeline (freeze Sun 4:15 PM)

| When | What |
|---|---|
| On approval | Wave 1: 8b (D1, D2), 86 (C1, C2), 3a, 42, 48, Agent Phone, 80, 12; QA clears #73 and #69 |
| As wave 1 tables land | Wave 2: 90 [58e3c2] (B6), 90 [113a1a] (B10) |
| Christian's draft arrives | Sharif integrates; build → integrate → test on one loop |
| Sun 9 AM | merges, walks, evaluator round 1 |
| Sun 11 AM | rehearsals from an empty start; README + demo script |
| Sun 1 PM | final scorecard; stretch only if everything passes |
| Sun 3:30 PM | tag `demo`, repo public with MIT; freeze 4:15 |

Cut order if the clock wins: Twilio → Artifacts → CRM badges. Never cut: empty start, context store + campaigns,
tasks, voice, after-call, agent write tools.

## 8. Decisions needed
1. **Approve this plan.**
2. **Q4 fix in the example files** (fictional Oct–Nov 2026 gifts sheet): yes / no.

Decided: Vercel auto-deploy of main stays on (session 12). Agent Phone never received the recalled wave-1 brief (it
expired undelivered), so nothing is pending there; its brief goes out fresh on approval.
