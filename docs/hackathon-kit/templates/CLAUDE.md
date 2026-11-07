# CLAUDE.md: <EVENT NAME>

## What this repo is

Our entry for **<EVENT NAME>** (<date>, <venue>). The mandate, in the organizers' words:
"<quote what they say they want>".

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
| **K / T0 / F / D** | |
| **Demo** | length, live or recorded |
| **Judging** | criteria, weights, peer vote? |
| **Prizes** | which stack; sponsor tech that counts |

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

`.env` holds the keys. Name the model inside the product in the README. If a prize needs an
open-weight model, the judged path reads only that model's variable
(`docs/hackathon-kit/playbooks/gemma4-integration.md`).

## Working agreements

- `pnpm build` (or `tsc --noEmit` if the local build is flaky) before every `vercel --prod --yes`.
- Edit docs with targeted replacements, never a full-file rewrite.
- When a claim is challenged, re-derive it; don't defend it.
