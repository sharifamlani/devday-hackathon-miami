# Demo script: <PROJECT NAME>

**This file is the spec.** It is written right after the idea locks, **before any code**. No
sentence here, no feature. Every change to the click order updates this file in the same step.

**Demo length:** ___ s (from `event-brief.md` Q1). If unknown, plan for 60 s; extra time goes to
the moment, not to more features.

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
| | | |

**Where the AI is visible:** <the exact screen element a judge can point at>

**If asked "where's the AI?":** <one sentence>

**If asked "is that live?":** <one sentence>

**If asked "how do you know it's right?":** <one sentence>

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
