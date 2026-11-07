# CLAUDE.md: DevDay Exchange Community Hackathon: Miami

## What this repo is

Our entry for **DevDay Exchange Community Hackathon: Miami** (Sat–Sun Nov 7–8, 2026, The LAB Miami).
The mandate, in the organizers' words: "teams take real problems from South Florida non-profits and
turn them into working AI agents and tools those organizations can actually use on Monday. Not slide
decks. Shipped software." Acceptance criteria: **Codex · OpenAI API · OpenAI Agents SDK**.

The repo serves three things, in this order:

1. **The one moment** that runs live on stage.
2. **The judges' criteria**, met visibly: `docs/event-brief.md` has them word for word.
3. **A clean record**: timestamped commits inside the build window, models named, a README that
   matches the code.

Anything that serves none of the three is out of scope.

**Read first:** `docs/hackathon-kit/lessons-learned.md` (12 rules from one win and one loss) and
`docs/hackathon-kit/runbook.md` (the clock).

## Event facts: `docs/event-brief.md` is the source of truth

| | |
|---|---|
| **K / T0 / F / D** | Sat 12 PM / ~12:30 PM (confirm) / Sun 3:30 PM / Sun 5–8 PM. Submissions Sun 4 PM |
| **Demo** | length unknown (Q1) |
| **Judging** | not published (Q3/Q4). 9 judges, 2 from The Miami Foundation's data + grants side |
| **Prizes** | $1,000 / $500 / $250 API credits + 3 mo ChatGPT Pro; more TBA |

## Hard rules

1. **No application code before T0** unless the organizers say otherwise. Allowed before: this file,
   `ROADMAP.md`, `LICENSE`, ignore files, `.env.example`, `docs/`, research, probing APIs.
2. **The demo script is the spec.** `docs/demo-script.md` is written before any code. No sentence,
   no feature.
3. **The AI's work is visible on screen.** If a judge can't see what the model did, it doesn't count.
4. **Integrate every hour; freeze is real.** Tag `demo` at F; nothing merges after it.
5. **Secrets never get committed.** `.env` is gitignored; `.env.example` is the template.
6. **Commit every unit of work**, pushed immediately, and flip `ROADMAP.md` in the same step.
7. **Lift working code, don't rewrite it** (`docs/hackathon-kit/tech-notes.md`).
8. **Verify against the real system.** HTTP 200 isn't success. Walk production after every deploy.
9. **Name the limits.** Never present a mock as live.
10. **Product code is written in Codex** until a host answers `event-brief.md` Q9. Sibling DevDay
    events banned Claude Code by name. Claude Code does research, docs, planning and verification.
    Keep the Codex session(s) where the core was built.

## How we work fast

**Parallelize the periphery, serialize the spine** (`docs/hackathon-kit/playbooks/parallel-build-playbook.md`).
The spine (input → processing → model → output) is one person plus the main session. Agents take
deliverables: `data-prober` before building on any source, `screen-builder` for the one finished
surface, `submission-scribe` for the README, `demo-verifier` before claiming anything works,
parallel `bug-hypothesis` agents when a root cause is unclear. Cap: three concurrent agents.

Every dispatch has five fields:

```
CONTEXT:   <the 3 facts the agent cannot discover on its own>
OWNS:      <exact file paths. "Do not modify anything else.">
TASK:      <the deliverable, as a noun>
DONE WHEN: <a condition the agent can check itself>
RETURN:    <the exact shape you want back>
```

## Models and keys

`.env` holds the key and the four role-named tiers (`OPENAI_MODEL_DEFAULT` = gpt-6.1-sol, etc.).
Name the model inside the product in the README. Traps (no `temperature`, reasoning is a setting,
`agents` import name): `docs/hackathon-kit/playbooks/openai-integration.md`. Smoke:
`.venv/Scripts/python.exe scripts/smoke-openai.py`.

## Working agreements

- `pnpm build` (or `tsc --noEmit` if the local build is flaky) before every `vercel --prod --yes`.
- Edit docs with targeted replacements, never a full-file rewrite.
- When a claim is challenged, re-derive it; don't defend it.
