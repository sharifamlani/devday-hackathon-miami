# Problem → solution mapping

> Sources: our Sat Nov 7 evening conversation with Erica (The Miami Foundation) at The LAB, and the team
> wireframe session that followed. Both are paraphrased here; raw transcripts stay in the gitignored
> `transcripts/` folder. Challenge #2 requirements come from `docs/event-brief.md`.
> Status is as of `main` @ `8ee6258` (Sun Nov 8, re-derived from the code): #48, #58, #60, #65, #67, #78, #90, #107, #111, #112, #116, #124, #132 and
> Christian's `WorkspaceSidebar` (`4241176`) are merged. Open: #126 (tabs), #134, #135, #123.

## 1. The problems, in Erica's terms

| # | Problem | What she said, paraphrased |
|---|---|---|
| P1 | **Loss of context** | What staff know about a donor slips between people and systems. Calls and meetings never make it into the record. |
| P2 | **Staying on top of donors** | Consistent outreach and relationships need each donor's interests known. |
| P3 | **The people served, not just donors** | Donor relationships are internal. Also ask who the organization serves and what those people need. |
| P4 | **Demonstrating impact** | Grantors don't give you money when you report back, but they want to know how far their money went. Impact has to be shown before anyone will fund it. |
| P5 | **Capturing impact data at the source** | Collect information from the people served when they register (e.g. zip code), so impact rolls up into a dashboard instead of a hand-tallied sheet. |
| P6 | **Every nonprofit is different** | Impact tools vary by organization type and purpose. The Foundation serves everyone, so demo one organization as one user of a platform many can use. |
| P7 | **Payment fraud** | Someone impersonates a donor or grantee and supplies a bank account that isn't theirs. Money goes to the wrong person. |
| C2 | **Challenge #2 minimum** (event brief) | Staff approve duplicates before merge; no giving history lost; late regular gifts found in time. |

## 2. The mapping

| # | Solution | Where it lives | Status |
|---|---|---|---|
| P1 | **Voice-first capture:** a mic button beside the chat opens a live transcript panel (Wispr Flow style). At the end, staff attach the note to a person's profile in one click. | home chat bar → transcript panel → person timeline | ✅ #78 "Call and transcribe" (`home/HomeChat.tsx`) + live transcript pane + call-notes API; #91/#94 Gemini live relay and speaker labels; #90 + #111 after-call agent (proposes actions, Apply writes them). Live in-app phone calls stay post-demo; the demo transcribes a call on speakerphone |
| P1 | **One shared record:** every upload, note, gift and draft lands on the person, so nothing lives in someone's head or inbox. | Givers / Neighbors / Community tabs | ✅ #60 three-tab data layer |
| P1 | **Chat agent with visible tool steps** answers "what do we know about X?" from the record. | right sidebar, every screen | ✅ #58 |
| P2 | **Enrichment agent:** an **Enrich** button on a profile (or ask the agent) searches the web, **tags the donor's interest areas** (arts, health, youth…) from a fixed list with a source per tag, and adds other public contact details. | Givers profile | ✅ `POST /enrich/{id}` + ResearchPanel (organizations only); #88/#115 interest-tag taxonomy and propose → Save to profile; #124 profile Enrich goes through review |
| P2 | **Gift alerts + "call today":** late and failed regular gifts surface before the donor lapses. | home money-raised card + to-do list, Givers | ✅ #48 `GET /alerts` feeds the task generator (`service/tasks.py`: failed/late gift → "Call …" task); Home tasks (#100, #112) and the CRM attention list (`GET /people/attention`, #83) show them; #120 retires stale alert calls |
| P2 | **Calendar the agent can edit:** events from the Foundation's site with invites pre-drafted per audience. The agent adds and changes items. | Calendar | ✅ #67; #113 Calendar reads tasks; #130 date fixes. Outlook/Gmail sync is out of scope |
| P3 | **Community tab:** the people the nonprofit serves, analyzed only from what they self-reported; outreach about programs, never a donation ask. | Community tab | ✅ data layer (#60) and `GET /community/stats`; tabs in the UI are open PR #126 (Givers · Neighbors · Community). **Scope (Sharif): Givers only get new investment**; Neighbors/Community get none |
| P3 | **Neighbors tab:** people met but not yet donors or clients, with follow-ups drafted from current context. | Neighbors tab | ✅ data layer (#60); UI tab in open PR #126; no new investment |
| P4 | **Context agent:** reads the website and news on onboarding and every day, so outreach carries real success stories instead of generic asks. | onboarding step 2 + daily refresh | ✅ backend (`/context/run`, `/context/refresh`, `GET /context`, `GET /context/status`); onboarding screens merged (#93, #132) |
| P4 | **Value-first outreach:** donor emails and texts lead with an impact update, then the ask. Nothing sends without approval. | chat agent + approval card | ✅ #58 (dry run by default; live only to allowlisted numbers) |
| P5 | **Impact snapshot:** counts by zip code and program from Community records, ready to paste into a grant report. | Home → "Impact & story" panel (see next row) | ⏸ planned PR3c (`GET /community/stats` is on main; no screen reads it) |
| P4+P5 | **Impact & story panel (Q4 tile, Ctrl+I):** org context facts with their sources (`GET /context`) and a "last refreshed" line (`GET /context/status`), plus Community self-reported counts by zip and program (`GET /community/stats`). Zooms open in the Home panel (§3.6). | Home Q4 tile → `?workspace=impact` | ⏸ planned PR3c (feat/impact-panel). Endpoints exist on main; the web client already has `getContext`/`community`/`context status` calls in `providers/local` |
| P6 | **Upload any messy file, pick a tab or let the agent sort.** No setup per organization type; the context agent learns the mission from the website. | landing upload | ✅ ingest adapter on main, mounted via #58 |
| P7 | **Flag payout-detail changes:** when a record's bank or payment details change, the change is held for a second staff approval. | dedupe / merge review | ⏸ named limit (Sharif D9), not built |
| C2 | **Duplicate review:** 6/6 sample duplicate groups found; staff approve each merge; gift history is kept on the survivor. | Givers → Review duplicates | ✅ #65 |
| C2 | **Late gifts found in time:** Park and Quintero failed, Salinas/Brandt/Veloria late, all flagged on the sample data. | gift alerts | ✅ #48 alerts → Home tasks + CRM attention list (see P2 row) |

**Transcription model: Google Gemini 3.5 Transcribe (Sharif, Sat Nov 7 night).** Checked against Google's docs:

| | Live (during the call) | Recorded (after the call, phone stretch) |
|---|---|---|
| Model ID | `gemini-3.5-transcribe-live` | `gemini-3.5-transcribe` |
| Call | Live API WebSocket, `client.aio.live.connect(...)` with `input_audio_transcription` | `client.interactions.create(...)` (not `generate_content`) |
| Audio | raw 16-bit PCM, 16 kHz mono, ~100 ms chunks | webm, opus, mp3, wav, m4a and more; up to 1 h |
| Output | interim text while speaking, final text at each pause | full text; speaker labels (up to 8, verbatim mode) |
| Limits | 10-minute session; no speaker labels | 30 min with speaker labels |
| Price | free tier; paid ~$0.009/min | free tier; paid ~$0.005/min |

Both work with the `GEMINI_API_KEY` already in `.env` (no Google Cloud project). The browser never sees the
key: the service mints a short-lived token (`client.auth_tokens.create`) or relays the audio itself.
`mode="SMART"` drops filler words for the saved note; a custom vocabulary of donor and program names helps
accuracy. The call summary and save-to-profile step stay on the OpenAI Agents SDK, so the OpenAI work stays
visible to judges. Free-tier audio may be used by Google to improve its products, so real donor calls need
the paid tier.

## 3. UI wireframes

Decisions from the wireframe session: one screen for everything; at most two tabs; less padding; the
search bar goes (you ask the agent instead); the agent sidebar collapses to icons.

### 3.1 Home: before (main @ 6a18d17, #74)

```
+--+------------+---------------------------------------------------+------------+
|R | Projects   |  Good evening                                     | Ask   [<<] |
|a | [search..] |  +---------------------------------------------+  |            |
|i | • Give Mia |  | GLANCE                                      |  | chat       |
|l | • Year-end |  +---------------------------------------------+  | thread     |
|  | [<<]       |  +---------------------------------------------+  |            |
|  |            |  | Your outreach days (month grid, large)      |  |            |
|  |            |  +---------------------------------------------+  |            |
|  |            |  [Goal gauge] [Campaign progress] [Recommended]   | [type...]  |
+--+------------+---------------------------------------------------+------------+
```

### 3.2 Home: after (Sharif's hand sketch, Sat Nov 7 night) — superseded by §3.6

Three columns, one screen. Left: money raised on top, CRM below. Middle: the agent (interactions
above, text box below). Right: calendar on top, to-do list below.

```
+--+----------------+------------------------------------------+----------------+
|  | MONEY RAISED   |  AGENT                                   | CALENDAR       |
|R |  90% of goal   |  [🤖] "Good evening. 2 gifts failed      |  Nov 2026      |
|a |  ▓▓▓▓▓▓▓▓▓░    |   overnight; 41 invite drafts are ready  |  S M T W T F S |
|i |  $ (sample)    |   for Give Miami Day."                   |   ... 14 15 .. |
|l |  at a glance:  |                                          |   .. 19 ...    |
|  |  ⚠ 2 failed    |  ✓ find_people(segment=lapsing)          |  (small month) |
|  |  ⏱ 3 late      |  ✓ draft_email(x4)                       +----------------+
|  +----------------+  "4 drafts ready. Approve?"              | TO DO          |
|  | CRM            |   [Review] [Approve all]                 | [ ] Call Park  |
|  | [Givers 33   ] |                                          |     (failed)   |
|  | [Neighbors 20] |  (scrolls; room for long threads)        | [ ] Text       |
|  | [Community 15] |                                          |     Salinas    |
|  |                |  +------------------------------------+  | [ ] Approve 41 |
|  | Maria Delgado  |  | [+] [🎙] Ask the agent...      [▶] |  |     invites    |
|  | Bayfront Arts  |  +------------------------------------+  | [ ] ...        |
+--+----------------+------------------------------------------+----------------+
   ↑ money raised:       ↑ [+] = attach files / events            ↑ calendar and
     upper left            [🎙] = voice-first panel (3.3)            to-do: right
   ↑ CRM: left, tall     ↑ agent text box + interactions: middle
```

- **Money raised** (upper left) is the at-a-glance card: % of goal, total, and alert counts.
- **CRM** (left, tall) holds the three tab counts and a recent-people list; a click opens the full tab.
- **Agent** (middle, the widest column) replaces the Ask sidebar on home. Tool steps and approval cards
  show in the thread.
- **Calendar** (upper right) is a small month view; a click on a day opens the full calendar.
- **To do** (right, tall) comes from gift alerts, follow-ups and drafts waiting for approval.
- The Projects sidebar and its search box are gone from home; the Ask sidebar stays on other screens.
```

### 3.3 Voice-first panel (opened by 🎙)

```
+-------------------------------------------------------------+
| ● Recording 03:12                              [■ Stop]     |
|-------------------------------------------------------------|
| Live transcript                                             |
| "...she said the scholarship fund is where she wants the    |
|  next gift to go, and she prefers texts to email..."        |
|-------------------------------------------------------------|
| Title: [Call with Maria Delgado.........]                   |
| Attach to: [Maria Delgado (Givers) v]  [Save to profile]    |
+-------------------------------------------------------------+
```

After **Save to profile**, the person's timeline gains "Call note · Nov 8" with the transcript and the
agent's 3-line summary (interests, next step).

### 3.4 Profile: Enrich button

```
+-------------------------------------------------------------+
| Bayfront Arts Collective (sample)  Givers · ★ · score 82   |
| [Enrich]  [Draft outreach]  [Add note]                      |
|-------------------------------------------------------------|
| RESEARCH (sourced)                                          |
| • Funds youth literacy grants each spring   [source ↗]      |
| • New president as of Jul 2026               [source ↗]     |
| TIMELINE                                                    |
| • Call note · Nov 8 (voice)                                 |
| • Gift $5,000 · Apr 2026                                    |
+-------------------------------------------------------------+
```

### 3.5 State summary

| UI piece | Before | After |
|---|---|---|
| Layout | Projects sidebar + center cards + Ask sidebar | three columns: money raised + CRM · agent · calendar + to-do |
| Money raised | goal gauge card, lower row | upper-left card: % of goal, total, alert counts (the at-a-glance) |
| Glance card | full-width, top center | folded into the money-raised card |
| CRM | rail item only | left column, tall: tab counts + recent people, click into a tab |
| Agent chat | Ask sidebar only | middle column on home, widest, scrollable; text box at the bottom |
| Ask sidebar | every screen | every screen except home (home has the agent in the middle) |
| Calendar | large month grid, center | small month view, upper right |
| To-do | Recommended card | right column, tall: alerts, follow-ups, drafts to approve |
| Projects sidebar + search | left, collapsible | removed from home; ask the agent |
| Campaign progress card | lower row | removed from home (ask the agent) |
| Voice | none | 🎙 in the agent text box → transcript panel → save to profile |
| Attachments | landing page only | [+] in the agent text box (files, events) |
| Enrich | ask the agent | also a button on each profile |

### 3.6 Home v3: zoom panels (Sun Nov 8)

Approved by Sharif Sun Nov 8. Decisions: Tasks, Calendar, CRM and a new "Impact & story" view each open
via `?workspace=` into a panel of about 2/3 width inside Home, with the agent chat still visible at about
1/3 (chat at least 380 px; below about 1200 px the panel goes full width). The calendar is a day-grouped
list through time on Home (no week grid; the `/calendar` page keeps its grid). The Projects section is
removed; CRM stays, and its scope is Givers only. Close with the X, Esc, the same hotkey, or Back (no
double-click). Hotkeys use physical key codes: Alt+C calendar, Alt+T tasks, Alt+M CRM, Ctrl+I impact,
Alt+V dictation, Esc closes. On main today a panel hides the chat (`hidden={!!panel}` in `HomePage.tsx`).

```
+--+-----------+----------------------------------+---------------+
|R | AGENDA    |  PANEL (~2/3)  ?workspace=crm    | AGENT (~1/3)  |
|a |  Today    |  [X]  CRM: Givers (primary)      |  chat thread  |
|i |  . Call   |  ------------------------------  |  tool steps   |
|l |   Park    |  Maria Delgado   $5,000  late    |  approvals    |
|  |  Mon 9    |  Bayfront Arts   ★ score 82      |               |
|  |  . Event  |  ...                             |  (>= 380 px)  |
|  | [CRM]     |                                  | [+][mic] ...  |
|  | [Impact]  |                                  |               |
+--+-----------+----------------------------------+---------------+
  list calendar,   panel width / (panel + chat) = 0.63 to 0.70
  no week grid     below ~1200 px: panel full width
```

| UI piece | Before (main @ 8ee6258) | After (Home v3) |
|---|---|---|
| Calendar on Home | week grid tile (`WeekCalendarTile`) | day-grouped list through time |
| Projects section | `ProjectsTile` in the sidebar | removed |
| Panel open | replaces the chat (chat hidden) | ~2/3 panel + chat ~1/3 |
| Panel views | calendar, donors, organizations | tasks, calendar, CRM (Givers), impact & story |
| Q4 / Overview tile | gauge | opens Impact & story |
| After agent writes | refetch by scope (#112) | changed rows also flash |
| Send labels | hardcoded "(simulated)" | "Sent via Gmail" / "Sent via Twilio" / "Dry run" from `simulated` and outbox `provider` |

Planned PRs: PR2 feat/agenda-sidebar, PR3 feat/zoom-panels (View Transitions zoom, `scripts/verify_home_zoom.py`),
PR3b feat/tasks-panel, PR3c feat/impact-panel, PR4 feat/workspace-hotkeys, PR5 feat/row-flash, PR6 fix/send-labels.

## 4. Build order for what is still open

1. Home v3 (3.6): PR2 agenda sidebar, PR3 zoom panels, PR3b tasks panel, PR3c impact panel, PR4 hotkeys, PR5 row flash, PR6 send labels.
2. Merge the open UI PRs: #126 tabs, #134, #135, #123.
3. Done on main since the first draft: voice capture (#78, #91, #94, #90, #111), Enrich with interest tags (#88, #115, #124), alerts as tasks (#100, #112).
4. P7 payout-change hold stays a named limit.

## 5. Evaluation criteria

| Criterion | Threshold | How measured |
|---|---|---|
| Every Erica problem has a solution row and status | 8/8 (P1–P7 plus C2) | this file |
| A call note reaches the right profile | saved note visible on the chosen person after reload | Playwright on the demo laptop |
| Home zoom panel keeps the chat | Panel ~2/3 (ratio 0.63–0.70), chat ≥380px, 0 console errors | `scripts/verify_home_zoom.py` (planned in PR3; not yet on main) |
| Enrich adds only sourced facts | 100% of new facts have a source URL | API check on 3 organizations |
| Late and failed gifts on home | 5/5 expected alerts on sample data | API check vs `answer_key.json` |

## 6. Audit: built vs missing (refreshed Sun Nov 8, main @ 8ee6258)

| Area | On main | Missing for the demo | Owner |
|---|---|---|---|
| Upload → three tabs | ingest adapter, `contact_type`, tabs (#60) | — | done |
| Duplicates (C2) | 6/6 groups, approve/dismiss routes, merge keeps gifts (#65) | — | done |
| Gift alerts (C2, P2) | `GET /alerts` (#48) → task generator → Home tasks + CRM attention list (#83, #100, #112, #120); answer key expects 5 on sample data, not re-checked on main | re-check the 5 alerts on the live sample | QA |
| Chat agent (P1) | `/chat`, tool steps, approval-gated `/send`, allowlist (#58); main-UI agent tools + undo (#97); Home chat on the agent with live refetch (#112) | #135 task→agent open; #69 assistant-ui panel still open (preview) | QA |
| Enrichment (P2) | `/enrich/{id}`, ResearchPanel (sourced facts) | **interest-area tags**: fixed tag list, `donor_interests` table, agent fills it, chips on the profile and as a filter | us (backend) + Christian (chips) |
| ICP + prospects | `/icp/run`, `/prospects` (#62) | visible entry point on screen | Christian |
| Calendar (P2) | calendar view (#67), `/events`, drafts routes, tasks on the calendar (#113), mobile route (#110) | list calendar on Home (PR2, Home v3) | us |
| Context agent (P4) | `/context/run`, daily `/context/refresh`, `GET /context`, `GET /context/status`; onboarding v3 (#93, #132) | **Impact & story panel** shows facts + sources + last refreshed (PR3c); set `REFRESH_DAILY_AT` on the demo laptop | us |
| Value-first outreach (P4) | outreach + campaign agents, dry-run sends | — | done |
| Community tab (P3, P5) | demographic fields in `db.py` and ingest; `GET /community/stats` | tabs UI is open #126 (Givers primary; Neighbors/Community no new work); counts by zip/program shown in Impact & story (PR3c) | us |
| **Voice-first (P1)** | "Call and transcribe" + live transcript pane (#78), Gemini relay + speaker labels (#91, #94), after-call agent (#90, #111), Ask dictation (#116) | composer dictation #123 open; Alt+V hotkey (PR4) | us |
| Payout-change hold (P7) | nothing | name it as a limit in the README | docs |
| Home layout | three-column home (#78), dashboard design (#105, #107), `WorkspaceSidebar` with `?workspace=` panels (`4241176`) | Home v3 (§3.6): chat stays beside the panel, list calendar, no Projects, Impact & story | us (PR2–PR6) |
| Reliability | #73 event-loop fix merged | — | done |
| Persona | — | #76 decide: demo as fictional Tidepath, or keep The Miami Foundation | Sharif |

### Voice-first: laptop now, phone as a stretch

| Option | How it works | Effort | Demo risk |
|---|---|---|---|
| **A. Laptop mic (build this)** | 🎙 opens the panel; the browser records; audio streams to `gemini-3.5-transcribe-live`, so words appear as staff speak. Save writes an atomic-crm **note** on the chosen person (notes with attachments already exist), plus a 3-line agent summary. A phone call on speaker next to the laptop works the same way. | ~2 h | low: no telephony, works offline from webhooks |
| **B. Real phone call (stretch)** | Staff dial our Twilio number from their phone (or click "Call" and Twilio rings their phone first), then Twilio bridges to the donor with recording on. When the call ends, Twilio's recording webhook hands the recording to `gemini-3.5-transcribe` (with speaker labels), then the same save step. | ~3 h on top of A | medium: needs a public URL for Twilio's webhook (a tunnel to the laptop), a voice-capable number, and a trial account only reaches verified numbers |

Guardrails for B: **Florida requires every party's consent to record a call**, so the call opens with a spoken
"this call is recorded" notice before bridging. A person makes the call; no AI voice speaks (the
no-AI-calls rule stands). A live transcript during a phone call (Twilio media streams → `gemini-3.5-transcribe-live`)
is post-demo.

## 7. Context database (onboarding → agents → continuous refresh)

Onboarding captures the organization's context into the local SQLite database; every agent reads from it;
a refresh job keeps it current. Most of this is on main already.

```
[Onboarding step 2: website (required) + X / LinkedIn / Instagram links]
        |
        v
  org_profile (name, website, social links)
        |
  context agent: website + news (live hosted search), socials (public posts via search;
        |        official APIs once tokens exist), each fact with its source URL
        v
  org_context (facts) ---> events ---> event_audience ---> event_drafts
        |                                                        ^
        +--> chat agent tools: get_context, get_events, get_alerts
        +--> outreach + campaign agents (success stories in every draft)
        |
  daily refresh (REFRESH_DAILY_AT) re-reads every source, adds new facts and events,
  re-drafts invites; each run logged in context_refresh_log
```

| Piece | On main | Missing |
|---|---|---|
| Tables: `org_profile`, `org_context`, `events`, `event_audience`, `event_drafts`, `context_refresh_log` | ✅ `service/db.py` | — |
| Context agent: website + news, sourced facts | ✅ `/context/run`, `org_context.py` | — |
| Social links saved with the profile | ✅ `x_url`, `linkedin_url`, `instagram_url` | — |
| Social posts read | ~ `social_context.py`: public posts via search; official APIs only once tokens exist | X / Meta / LinkedIn tokens (post-demo); never faked, an unread source is labeled |
| Agents read the database | ✅ chat tools `get_context`, `get_events`, `get_alerts` | — |
| Continuous refresh | ✅ `/context/refresh` + in-process daily loop | **set `REFRESH_DAILY_AT` on the demo laptop**; show "last refreshed" on screen |
| Onboarding screen that writes it | ~ draft #70 only | **Christian adopts #70** (step 1 upload, step 2 website + socials, live context progress) |
| Call notes feed context | — | stretch: a saved voice note about the organization adds a fact to `org_context` |
