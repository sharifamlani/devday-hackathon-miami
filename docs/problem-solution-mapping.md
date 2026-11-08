# Problem → solution mapping

> Sources: our Sat Nov 7 evening conversation with Erica (The Miami Foundation) at The LAB, and the team
> wireframe session that followed. Both are paraphrased here; raw transcripts stay in the gitignored
> `transcripts/` folder. Challenge #2 requirements come from `docs/event-brief.md`.
> Status is as of `main` @ `6a18d17` (Sat Nov 7, after #58, #67 and #74 merged).

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
| P1 | **Voice-first capture:** a mic button beside the chat opens a live transcript panel (Wispr Flow style). At the end, staff attach the note to a person's profile in one click. | home chat bar → transcript panel → person timeline | ⏸ new. Live in-app calls are post-demo; the demo transcribes a call on speakerphone |
| P1 | **One shared record:** every upload, note, gift and draft lands on the person, so nothing lives in someone's head or inbox. | Givers / Neighbors / Community tabs | ✅ #60 three-tab data layer |
| P1 | **Chat agent with visible tool steps** answers "what do we know about X?" from the record. | right sidebar, every screen | ✅ #58 |
| P2 | **Enrichment agent:** an **Enrich** button on a profile (or ask the agent) searches the web and adds sourced facts. | Givers profile | ✅ organizations (individuals parked for human review) |
| P2 | **Gift alerts + "call today":** late and failed regular gifts surface before the donor lapses. | home "Today at a glance", Givers | ⏳ #48 |
| P2 | **Calendar the agent can edit:** events from the Foundation's site with invites pre-drafted per audience. The agent adds and changes items. | Calendar | ✅ #67. Outlook/Gmail sync is out of scope |
| P3 | **Community tab:** the people the nonprofit serves, analyzed only from what they self-reported; outreach about programs, never a donation ask. | Community tab | ✅ data layer (#60); analysis view ⏸ |
| P3 | **Neighbors tab:** people met but not yet donors or clients, with follow-ups drafted from current context. | Neighbors tab | ✅ #60 |
| P4 | **Context agent:** reads the website and news on onboarding and every day, so outreach carries real success stories instead of generic asks. | onboarding step 2 + daily refresh | ✅ website + news (socials saved, not fetched) |
| P4 | **Value-first outreach:** donor emails and texts lead with an impact update, then the ask. Nothing sends without approval. | chat agent + approval card | ✅ #58 (dry run by default; live only to allowlisted numbers) |
| P5 | **Impact snapshot:** counts by zip code and program from Community records, ready to paste into a grant report. | Community tab → "Impact" panel | ⏸ stretch |
| P6 | **Upload any messy file, pick a tab or let the agent sort.** No setup per organization type; the context agent learns the mission from the website. | landing upload | ✅ ingest adapter on main, mounted via #58 |
| P7 | **Flag payout-detail changes:** when a record's bank or payment details change, the change is held for a second staff approval. | dedupe / merge review | ⏸ named as a future limit, not built |
| C2 | **Duplicate review:** 6/6 sample duplicate groups found; staff approve each merge; gift history is kept on the survivor. | Givers → Review duplicates | ✅ #65 |
| C2 | **Late gifts found in time:** Park and Quintero failed, Salinas/Brandt/Veloria late, all flagged on the sample data. | gift alerts | ⏳ #48 |

**Transcription model:** the wireframe session mentioned Gemini. We should use OpenAI transcription instead
(`gpt-4o-transcribe` or the Realtime API), because the rubric scores OpenAI use and Gemini adds a second key.

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

### 3.2 Home: after

```
+--+------------------------------------------------------------------+---------+
|  |  The Miami Foundation                                            | CRM  >  |
|R |  +----------------------------+  +-----------------------------+ |---------|
|a |  | TODAY AT A GLANCE          |  | WHERE YOU STAND (quarter)   | | Tasks   |
|i |  | 3 meetings · 4 follow-ups  |  | $ raised vs goal  ▓▓▓▓░░ 62%| | [ ] Park|
|l |  | ⚠ 2 failed gifts           |  | Give Miami Day in 12 days   | | [ ] Sali|
|  |  | 41 invite drafts → review  |  |                             | | [ ] ... |
|  |  +----------------------------+  +-----------------------------+ |---------|
|  |  +--------------------------------------------------------------+ | Calendar|
|  |  |  [🤖] agent chat (center, scrollable)                        | | Nov     |
|  |  |  ✓ find_people(segment=lapsing)  ✓ draft_email(x4)          | | 14 15 19|
|  |  |  "4 drafts ready. Approve?"   [Review] [Approve all]         | | (small) |
|  |  +--------------------------------------------------------------+ |         |
|  |  | [+] [🎙]  Ask anything: "who should I call today?"     [▶]   | |         |
|  |  +--------------------------------------------------------------+ |         |
+--+------------------------------------------------------------------+---------+
     ↑ [+] = attach files / events      ↑ [🎙] = voice-first panel (3.3)
       Projects sidebar collapsed; padding cut; chat moves to the center
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
| Coral Gables Rotary Club            Givers · ★ · score 82   |
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
| Search bar | in the Projects sidebar | removed; ask the agent |
| Projects sidebar | left, collapsible | collapsed by default |
| Chat | Ask sidebar only | center of home, scrollable; Ask sidebar stays on other screens, collapsible to icons |
| Glance | full-width card | "Today at a glance" card beside "Where you stand" |
| Goal / campaign cards | row under the calendar | merged into "Where you stand" |
| Calendar | large month grid | small month strip in the right column |
| Tasks | from Recommended card | right column list |
| CRM | rail item | right-column link into the three tabs |
| Voice | none | 🎙 beside the chat input → transcript panel → save to profile |
| Attachments | landing page only | [+] in the chat input (files, events) |
| Enrich | ask the agent | also a button on each profile |

## 4. Build order for what is still open

1. Home layout (3.2): Christian owns the UI, so this goes to him as a request, not a branch of ours.
2. Voice-first panel (3.3), with OpenAI transcription and save-to-profile.
3. Enrich button on the profile (3.4), wired to the existing enrichment agent.
4. Merge #48 (gift alerts) so "Today at a glance" has real alerts.
5. Stretch: Community impact snapshot (P5); payout-change hold (P7) stays a named limit.

## 5. Evaluation criteria

| Criterion | Threshold | How measured |
|---|---|---|
| Every Erica problem has a solution row and status | 8/8 (P1–P7 plus C2) | this file |
| A call note reaches the right profile | saved note visible on the chosen person after reload | Playwright on the demo laptop |
| Home shows the after-layout | chat input centered on home; 0 console errors | Playwright DOM check |
| Enrich adds only sourced facts | 100% of new facts have a source URL | API check on 3 organizations |
| Late and failed gifts on home | 5/5 expected alerts on sample data | API check vs `answer_key.json` |
