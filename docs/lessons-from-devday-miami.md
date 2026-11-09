# Lessons from DevDay Exchange Miami (Nov 7–8, 2026)

**Result: did not place.** We built the strongest product we have shipped at a hackathon: Gatherly, a donor CRM
for The Miami Foundation built from 8 messy files, with an agent that fixes duplicates, writes sourced donor
summaries, drafts emails, researches organizations and places real recorded calls. About 1,340 commits and 300+
merged PRs in 28 hours, with 10–17 Claude Code sessions working as one fleet.

**What killed us was the video.** The submission's demo video was a teaser, not a walk through the product. Judges
who only saw the video never saw the duplicates being fixed, the call transcript, the sourced enrichment or the
email draft. The product won the work; the video lost the judging.

---

## What we did right (keep doing it)

| # | What | Why it worked |
|---|---|---|
| R1 | **The development flywheel**: a lead session briefs builders → QA gate graded merged with current main → merge pinned to the approved SHA → an Integrate + Test lane walks the running app → findings loop back | It caught real bugs before the stage that tests alone missed: stale sample files behind "Try sample data" (78/10 instead of 77/9), overlapping calendar events spread across the week, a send card with no subject or body, a background job wiping "cached" labels, a regression in a teammate's direct push |
| R2 | **A standing User Journey agent** that types into the real app in a real browser (Playwright / Claude in Chrome), like a user, after every merge and every LIVE move | It is the only check that answers "does it work for a person?" It proved the Rockefeller, Gates and Priya flows end to end with DB checks and screenshots |
| R3 | **A LIVE stack gated behind QA, a TEST stack for walks, and a backup before every LIVE move** | Every bad state (three doubled imports, a wiped db, a 4× append) was restored in about a minute with nothing real lost |
| R4 | **One deployer, promoted only after QA** (the public site pinned to LIVE's tested sha, auto-alias off) | Ungated teammate pushes built but never went live by accident after the fix |
| R5 | **Lead keeps its context small**: briefs with 5 fields, reviews and walks delegated, short status tables to the human | The lead ran the fleet for 28 hours without losing the thread |
| R6 | **Evidence over claims**: numbers on screen vs the API vs SQL, 0 console errors, desktop and 390 px | Every "it works" came with a count, a screenshot, or a log line |
| R7 | **Fictional demo data, real public organizations for research** (Knight, Gates, Rockefeller) | Enrichment could be shown honestly without inventing facts about real people |

## What we did wrong (stop doing it)

| # | What happened | Cost | Rule |
|---|---|---|---|
| W1 | **The submission video was a teaser** | The judges never saw the product work. This is why we lost | **The video is the full demo**, start to finish, every moment in the script, recorded from the real app (see rule 13) |
| W2 | **The demo flow kept changing in the last 3 hours**: onboarding redesigned 3 times, chips removed and restored 4 times, the opening switched from onboarding to a loaded dashboard 30 min before demos | Dozens of script rewrites, re-tests and LIVE moves; no calm rehearsal | Freeze the demo flow at F. After it, only fixes to the frozen flow |
| W3 | **Teammates merged straight to main after the freeze** (10+ ungated merges, one 40-file direct push) | Every one needed a retro QA, a LIVE re-test, and sometimes a fix (#311, #312, #302) | Turn on branch protection at kickoff, not at the end |
| W4 | **The public site wrote into LIVE's database**, and a fresh browser landed on "Try sample data" | LIVE doubled 3 times from visitors and teammates on the venue Wi-Fi, then 4× from the stage laptop | A public demo URL is read-only or points at its own database. Importing into loaded data must be guarded (dedupe or refuse) |
| W5 | **The lead wiped LIVE for an "empty start" reset without asking** | The human found an empty app minutes before demos and had to ask for a restore | Never clear the human's data without an explicit yes, even on a schedule you agreed earlier |
| W6 | **A restart cut a live request** (the public backend restarted while an enrich ran) | The user saw a red "no result" and no reply, and the lead first blamed the agent's logic | Don't restart services while the human is using the app; diagnose from logs before explaining |
| W7 | **The lead stated causes before checking** ("it's this laptop", "the agent refused on purpose") | Two wrong explanations to the human, corrected minutes later | Read the code and the logs first; say "checking" rather than guessing |
| W8 | **The QA gate added a round trip to every change** at the end | Small docs and one-line fixes waited 10–20 min each | In hackathons, drop the separate QA agent (rule 15) |
| W9 | **The repo went public at 4:00 PM**, after a "no" at 2 PM | A last-minute flip and a rule-12 risk | Decide visibility at kickoff; keep history clean from the first commit |
| W11 | **We built a local backend (FastAPI + SQLite on the laptop)** | The real app only ran at localhost; the public URL needed a cloudflared tunnel to the laptop, the database lived on one machine, every deploy meant restarting local services, and the shared local db is what got doubled four times. Judges saw "localhost" | **No backend API in a hackathon.** Build frontend-first and serverless (browser storage / static data / serverless functions / a hosted DB), so every commit ships to a Vercel URL that IS the product |
| W10 | **Real phone calls depended on a Twilio trial** ("press any key", ~$1 balance) | Empty transcripts when nobody spoke or pressed a key | Upgrade paid services the night before; rehearse the call with the real people |

## Timeline highlights

- **Sat 12 PM** kickoff → idea (Project 2: duplicate donors + lapsed giving) → the empty app deployed early.
- **Sat night** the fleet built the CRM, ingest, dedupe, alerts, chat agent, calendar, calls; paused overnight with a resume note.
- **Sun 2:34 PM** code freeze; full test sequence: T1 demo path 15/15, public site 6/6, the human's 3 questions 3/3.
- **Sun 2:40–4:30 PM** teammates merged a rebrand, a new landing, a new shell and a new calendar after the freeze; each was QA'd after the fact and moved to LIVE only after a pass.
- **Sun 2:28 / 3:35 / 3:57 PM** the writable public site doubled LIVE three times; restored each time.
- **Sun 4:25 PM** the empty-start reset; reverted at 4:32 to loaded data.
- **Sun 6:19–6:29 PM** four imports from the stage laptop appended; made unique again at 7:02 by deleting only the appended rows.

## The one thing to do differently

Record a **full product walkthrough video** (3–5 min) from the real app the moment the demo flow freezes, and
submit that. Then rehearse the live demo. Everything else on this page is second.
