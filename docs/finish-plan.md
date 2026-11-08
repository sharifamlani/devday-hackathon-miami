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
