# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

**Event: DevDay Exchange Community Hackathon: Miami**

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

## Team contacts

Names, emails and the pending team email are in `TEAM_CONTACTS.md` at the repo root. It is gitignored:
never commit it, and never copy its contents into a tracked file.

## Current project state

The selected challenge is Project 2: duplicate donor records and donors who quietly stop giving.
The primary implementation is the React/Vite CRM in `web/` and the FastAPI/SQLite service in
`service/`. `stat-mcp/` is a separate FastMCP prototype with its own schema; it is not connected to
the main app. Read `README.md`, `plan.md`, and `ROADMAP.md` for the current product state, and the
`stat-mcp/` guides before working on that prototype.

| Path | Role |
|---|---|
| `docs/event-brief.md` | Source of truth for rules, schedule, judges, and the kickoff Q&A |
| `docs/idea-shortlist.md`, `docs/demo-script.md` | Idea scoring, then the demo script that is the spec |
| `ROADMAP.md` | Gate-by-gate status (N → K → B → F → A rows); flip a row in the same commit as the work |
| `research/rules_check.md` | What 9 sibling DevDay events allow (tools, prep, team size) |
| `docs/hackathon-kit/` | Lessons, runbook, playbooks and templates carried from past events. Edit `lessons-learned.md` after the event, not during |
| `service/` | Primary FastAPI/SQLite backend: donor/gift data, scoring, research, outreach, and API routes |
| `web/` | Primary React/Vite CRM and outreach inbox |
| `stat-mcp/src/stat_mcp/` | FastMCP server, ingestion, canonical schemas, deterministic donor analysis, and Agents SDK extraction/scoring |
| `stat-mcp/examples/` | Synthetic JSON/CSV/text fixtures and a JavaScript MCP client walkthrough |
| `stat-mcp/TOOLS.md`, `REQUIRED_FIELDS.md`, `AGENT_INTEGRATION.md`, `DEPENDENCIES.md` | Current tool contracts, donor schema, UI-agent integration steps, and dependency ledger |
| `scripts/` | `smoke-openai.py` (key + tiers + Agents SDK), `verify-e2e.py` + `make-voice.ps1` (Playwright prod walk, adapt `CASES`/selectors per app) |
| `.claude/agents/` | The 5 sprint subagents (gitignored; masters in `docs/hackathon-kit/agents/`) |
| `.packages/`, `transcripts/` | Unrelated personal tooling / local notes, gitignored. Not part of the entry |

## Commands

```bash
# Main service dependencies and server
python -m pip install -r service/requirements.txt
uvicorn service.main:app --host 127.0.0.1 --port 8000

# Separate MCP prototype (uv)
cd stat-mcp && uv sync
uv run python -m stat_mcp.server

# In a second terminal, from stat-mcp/, run the sample MCP client
npm install @modelcontextprotocol/sdk
STAT_MCP_URL=http://127.0.0.1:8000/mcp node examples/sample-call.mjs

# Prove key, all four model tiers, and an Agents SDK tool call + structured output (expect 7/7, exit 0)
.venv/Scripts/python.exe scripts/smoke-openai.py

# Production walk after every deploy (see tech-notes.md "Adapting verify-e2e.py")
python scripts/verify-e2e.py <voice-dir> https://<app>.vercel.app --shots <scratch>/shots

# Deploy (manual, no CI)
vercel --prod --yes
```

Never create a top-level `agents/` folder or `agents.py`: it shadows the Agents SDK import.

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
10. **Codex is not used (Sharif, Sat Nov 7).** Claude Code writes product code. The organizers' email set
    no coding-tool restriction; the Luma page still lists Codex under "Acceptance Criteria", a risk the
    team accepted. The OpenAI API and Agents SDK remain required and must be visibly used.
11. **Never push to `main` directly.** Another coder shares the repo: work on a branch, open a PR.
12. **The repo goes public with an MIT license by Sun 4:45 PM** (organizer rule). Nothing private in history.
13. **🔒 Carlos owns ingest.** Never edit `service/ingest/` or the `/ingest` route body. Build against the
    data contract in `plan.md` §13; contract changes need Carlos + Sharif.
14. **No Supabase.** Data is local SQLite (`data/donors.db`, gitignored) behind the local Python API.

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

`stat-mcp/.env` holds the server-side key and `OPENAI_MODEL` used by the extractor/scorer. The
Agents SDK package is `openai-agents` and its import is `agents`. Never expose the key to browser
code. Smoke:
`.venv/Scripts/python.exe scripts/smoke-openai.py`.

## Working agreements

- `pnpm build` (or `tsc --noEmit` if the local build is flaky) before every `vercel --prod --yes`.
- Edit docs with targeted replacements, never a full-file rewrite.
- When a claim is challenged, re-derive it; don't defend it.
