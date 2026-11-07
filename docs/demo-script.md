# Demo script: Kindred outreach inbox

**This file is the spec.** It is written right after the idea locks, **before any code**. No
sentence here, no feature. Every change to the click order updates this file in the same step.

**Demo length:** ___ s (from `event-brief.md` Q1). If unknown, plan for 60 s; extra time goes to
the moment, not to more features.

## Landing entry in the React app

Open the bare app URL to show “Less time on tasks. More time for people.” with “Your mission deserves more of your time.” underneath. “Try sample data” opens the existing donor workspace at `#/`. Existing workspace deep links continue to open directly.

“Upload donor data” opens a dialog. In the hosted snapshot build it explains that uploads need the local donor service and offers the sample workspace. With `VITE_DATA_MODE=local`, the CSV form uses the existing `uploadFiles` client and offers the workspace after a successful import. Live ingest remains dependent on the team's ingest service; this design change adds no backend ingestion behavior.

## Budget (60 s version)

| Seconds | Beat | What is said | What is on screen |
|---|---|---|---|
| 0:00–0:10 | **Hook** | One sentence that makes the room want to see it | The thing, already running |
| 0:10–0:40 | **The moment** | Little. Let it play. Narrate only what they can't see | The one live interaction, end to end |
| 0:40–0:52 | **The AI, visible** | What the model did that couldn't be faked | **Its output, on screen**: what it heard, saw, quoted or decided |
| 0:52–1:00 | **Close** | The name, and the line people repeat afterwards | Final frame |

## The script

| Seconds | Say | Do (click / speak / show) |
|---|---|---|
| 0:00–0:10 | “A missed gift should start a thoughtful conversation.” | Show Outreach inbox, with Rosa’s overdue gift and Elena’s simulated active call. |
| 0:10–0:25 | “First, one trustworthy donor history.” | Import the fictional CSV, preview mapped columns, review Rosa’s duplicate, approve merge, inspect preserved gift sources. |
| 0:25–0:40 | “Here is who needs attention, and why.” | Open Rosa: compare last three monthly gifts with the next expected date, seven-day grace window, and unknown payment status; edit and approve the example follow-up draft. |
| 0:40–0:52 | “A staff member can pick up with context.” | Open Elena’s flagged call, read the reason and fixture transcript; join simulation, mute, leave, then record an outcome. |
| 0:52–1:00 | “Less reconciliation. More time for people.” | Show completed follow-up and retained gift timeline. |

**Where the AI is visible:** The donor briefing and editable outreach draft. In this frontend slice both are explicitly labeled sample text; no model has been called. Sharif owns the live Agents SDK backend integration.

**If asked "where's the AI?":** This branch implements and verifies the UI flow and deterministic cadence; live model generation is a separate backend integration and is not claimed here.

**If asked "is that live?":** CSV parsing, merge review, history, cadence calculations and UI state are real local operations; voice, transcripts and drafts are labeled simulations or examples; no messages or calls leave the browser.

**If asked "how do you know it's right?":** Local tests cover quoted CSV, rejected imports, repeated transaction IDs, human-approved merges and cadence boundaries; the UI exposes the underlying source rows.

## Rules

- Demo the real thing, live, from the `demo` tag. Nothing merges after freeze.
- Every input (mic, camera, sensor) tested by a human on the venue setup.
- Nothing over about 3 s happens live; precompute or mask it.
- No logins, no empty states, no "loading…" in front of the judges.
- One path only.
- Rehearse twice, timed, at freeze + 5 and freeze + 15.

## Fallbacks

| If this breaks | Do this |
|---|---|
| Venue Wi-Fi | Phone hotspot → local server → screen recording |
| Deployed URL | Local server, kept running |
| AI API errors or rate limits | Precomputed output, labelled as cached |
| Mic / camera / hardware | The recording captured when it first worked |
| Laptop | Charger; recording on the phone |
