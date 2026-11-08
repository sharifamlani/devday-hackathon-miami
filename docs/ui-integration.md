# UI integration: the mockup → data → owners

The target is the Donor Desk mockup in `docs/design/mockup/` (9 screens: home, Projects open, Ask sidebar, Ask
expanded, meeting-notes overlay, voice, find-a-donor + Enrich, dark mode, phone). This file maps every element
on those screens to the hook and endpoint that feed it, says whether that exists on `main` today, and names
who builds the gap. Christian builds the screens; the service and hooks are ours. Names in the mockup (Denise,
Rosa Delgado, Grace Lin …) are placeholders: the live screens show whatever the uploaded files contain.

Status key: ✅ on main · ~ partly · ⏸ new.

## 1. Element map

### Frame (all screens)
| # | Element | Data | Status | Build |
|---|---|---|---|---|
| 1 | Icon rail: home, calls, people, Ask, campaigns, calendar | routes only | ✅ #74 | Christian |
| 2 | Projects sidebar: Campaigns, Saved Ask questions, Donor lists with counts | `useCampaigns`, `useGroups`, saved questions | ✅ #74 (counts from live data) | Christian |
| 3 | Sidebar toggle | UI state | ✅ | — |
| 4 | Light / dark toggle (screen 8) | theme | ✅ | Christian |
| 5 | Ask button → Ask sidebar (screen 3), expand to full page (screen 4) | `useAsk` → `routes_ask` (read-only: the model sees the question, never donor records) | ✅ | — |
| — | "Good evening, <name>" | staff first name from `org_profile.staff_name` | ⏸ | 8b adds the field (B7) |
| — | Removed from the header: sample badges, search bar, refresh, avatar | — | — | Christian |
| — | "Show meeting notes" overlay (screen 5 annotations) | static | design aid | **remove before judging** (or keep behind a dev flag) |

### Left column
| # | Element | Data | Status | Build |
|---|---|---|---|---|
| 6 | **Q4 outreach** gauge: % of goal, raised, goal, "reached today N donors" | `useTargets("quarter")` → `/targets` (raised, goal, percent); reached today = distinct people contacted today (outbox + call_notes) | ~ raised/goal ✅; reached today ⏸ | 48 (B2 adds `reached_today` + `/targets/quarters`) |
| 7 | **Today at a glance**: gifts at risk · possible duplicates · tasks today · days to the next big event | one call: `GET /home/summary` → `{gifts_at_risk, duplicates, tasks_today, next_event: {title, date, days}}` from `/alerts`, `/duplicates`, `tasks`, `events` | ⏸ (parts exist separately) | 48 (B13) |
| 8 | **CRM** list: initials, name, one-line context, status badge (Card failed / Late / New / Thanked / Not yet) | `GET /people/attention?limit=6` → `[{id, name, line, badge}]`; badge from alerts (failed, late), first gift < 30 days (new), thank-you sent this quarter (thanked), past donor with no gift this year (not yet) | ⏸ | 48 (B13) |
| 8 | "Find a donor" → pop-up (screen 7): lifetime, gifts, masked email, source | `useDonors` / `useDonor` | ✅ | Christian (pop-up) |
| 8 | Pop-up **Enrich** box: "found on the public web, review before saving" + interest areas → **Save to profile** | `POST /enrich/{id}?dry_run=1` returns proposals (facts + interest tags + contact) without writing; **Save to profile** → `POST /people/{id}/enrichment/accept {fact_ids, tags}` | ~ enrich writes directly today | **42 (B1: propose → accept)** |
| 8 | "Open database →" | full CRM tabs (Givers / Neighbors / Community) | ✅ #60 | — |

### Center column
| # | Element | Data | Status | Build |
|---|---|---|---|---|
| 9 | **Task card** "TASK 1 OF 5 · CALL": title, why, chips (lifetime, last gift, prefers phone), buttons **Call and transcribe**, **Draft email**, **Mark done**; clicking a task on the right opens it here | `GET /tasks?due=today` (ordered) → `{id, kind: call\|email\|review\|prep, title, why, person_id, chips[], due}`; Draft email → `useDraftOutreach`; Mark done → `PATCH /tasks/{id}` | ⏸ tasks are FakeRest today | **86 (B6 tasks table) + B11 task generator** |
| 9 | **Task generator**: builds today's tasks from data | failed/late gift alert → call; duplicate group → review; first gift < 30 days → welcome; event within 14 days → prep list; agent- and call-created tasks | ⏸ | **86 (B11)** |
| 10 | **Agent chat** in the center: answers ("3 donors from the gala…"), edits the in-app calendar ("Done. I added 3 calls to Tue Nov 10, 10:00–11:00") | `useChat` → `/chat` (Agents SDK, tool steps); new tools `create_task(person_ids, due, time)`, `add_calendar_item`, `find_people(interest=)`, `get_call_notes`, `get_tasks` | ~ /chat ✅; calendar/task tools ⏸ | **90 (B10)** |
| 11 | Chat box: **+** attachments/events, **🎙 dictation** (speak the question; words fill the box live, then send), ➜ send; suggestion chips (Enrich X, Who's late on a usual gift?, Plan next week). Same mic in the Ask sidebar | upload → `useUploadFiles`; dictation → `useDictation()` → `WS /transcribe/live?purpose=dictation` (`gemini-3.5-transcribe-live`, SMART mode, nothing stored); chips from `/home/summary.suggestions` | ⏸ dictation; ~ rest | Christian (button), 80 (hook), Agent Phone (relay), 48 (chips) |
| — | **Voice modal** (screen 6): "Call ended · where should this go?", transcript with speaker names (You / Rosa), Note title, Folder, Attach to (person), **Save note** | live text: `WS /transcribe/live` (`gemini-3.5-transcribe-live`, no speaker labels); at call end the recorded audio goes to `POST /transcribe/file` (`gemini-3.5-transcribe`, speaker labels) so the modal shows You / Rosa; Save → `POST /people/{id}/call-notes {title, folder, transcript, staff_name, contact_name}` | ⏸ | **Agent Phone (B3, + diarized end-of-call pass)** |
| — | **After-call updates** (not drawn in the mockup; added to match the demo): agent message under the saved note listing proposed tasks / RSVP / pledge / context with **Apply** | `POST /call-notes/{id}/actions` → `/apply` | ⏸ | **86 (B6)**; Christian renders it as an agent message |

### Right column
| # | Element | Data | Status | Build |
|---|---|---|---|---|
| 12 | **Calendar** (small month, dots on days with items; list of upcoming: "3 thank-you calls (added by agent)", "Board coffee", "Give Miami Day"), **+** | `GET /calendar?from&to` → events (`/events`) merged with dated tasks; `source: agent\|staff\|context` so "added by agent" shows | ~ events ✅; merge with tasks ⏸ | 86 (B6 adds `/calendar`) |
| 13 | **Tasks to do today** list with checkboxes and one-line reason, **+** | `GET /tasks?due=today`, `PATCH`, `POST /tasks` | ⏸ | 86 (B6) |
| 14 | **Artifacts**: saved call notes, drafts, reports | `GET /artifacts` → `[{kind: call_note\|draft\|report, title, date, ref}]` from `call_notes`, `outreach_drafts`/campaigns, reports | ⏸ | 86 (B12) |
| 15 | Ask sidebar expand / close | UI | ✅ | — |

### Phone (screen 9)
The center column only, a bottom tab bar replacing the rail. Same hooks. Christian.

## 2. New or changed endpoints (adds to plan §20.2)

| Endpoint | Response | Owner |
|---|---|---|
| `GET /home/summary` | `{gifts_at_risk, duplicates, tasks_today, next_event{title,date,days}, reached_today, suggestions[]}` | 48 |
| `GET /people/attention?limit=` | `[{id, name, initials, line, badge}]` | 48 |
| `GET /targets` (existing) | + `reached_today` | 48 |
| `POST /enrich/{id}?dry_run=1` | `{facts[], interests[], contact{}}` (nothing written) | 42 |
| `POST /people/{id}/enrichment/accept` | `{saved: {facts, interests, contact}}` | 42 |
| `GET /tasks?due=today` · `POST /tasks` · `PATCH /tasks/{id}` | `[{id, kind, title, why, person_id, chips[], due, time, done, source}]` | 86 |
| `POST /tasks/generate` (also runs after upload and daily refresh) | `{created: n}` | 86 |
| `GET /calendar?from&to` | `[{date, time, title, kind: event\|task, source}]` | 86 |
| `GET /artifacts` | `[{kind, title, date, ref}]` | 86 |
| `POST /transcribe/file` | `{segments: [{speaker, text, start, end}]}` (speaker labels) | Agent Phone |
| `POST /people/{id}/call-notes` (changed) | + `title`, `folder` | Agent Phone |

## 3. Gaps the mockup exposes

1. **Tasks are the backbone** (task card, task list, calendar, "tasks today", agent "added 3 calls"), and today
   they live in browser fake data. B6's `tasks` table plus a generator (B11) come first in wave 2.
2. **Speaker names in the transcript** need the recorded-file model; the live model has no speaker labels. B3
   records the audio during the call and runs `gemini-3.5-transcribe` when the call ends.
3. **Enrich is review-then-save** in the mockup. B1 changes from "write immediately" to propose → accept, which
   also fits the staff-wins rule for interest tags.
4. **Q4 gauge on the sample data:** Q4 2026 has $750 of gifts, so the gauge reads 0.5% of a $150k sample goal. The
   mockup's 70% needs either Q4 demo gifts in the demo seed (B7, fictional, labeled sample) or a smaller sample goal.
   Sharif decides.
5. **"Thanked" badge** needs a record of thank-yous sent: an outbox row with `purpose = thank_you`, or a call note
   in the "Thank-you" folder.
6. **Greeting name** needs `staff_name` on the org profile (set in onboarding).
7. **Meeting-notes overlay** is a design aid; hide it for the judges.

## 4. Order (fits plan §20.4)

Wave 1: 48 (B2 + B13 summary/attention), 42 (B1 propose → accept), Agent Phone (B3 + file transcribe),
80 (hooks for every endpoint above, mocked), Christian (frame + left column on existing hooks).
Wave 2: 86 (B6 tasks/calendar/artifacts + B11 generator + after-call), 90 (B10 tools), 8b (B7 seed),
Christian (task card, voice modal, enrich pop-up, right column).
