# Runbook: the event-day clock

Times are relative, because every event's schedule differs:
**K** = kickoff, **T0** = building begins, **F** = code freeze (the "final push" time, or 30 min
before demos if none is given), **D** = demos.

Every step has a **gate**: a yes/no check. Don't start a step until the gate before it says yes.
Each gate is also a `ROADMAP.md` row (`templates/ROADMAP.md`); flip it with the time and commit SHA
when it passes.

---

## The night before (allowed: verification, docs, research; no application code)

| # | Step | Gate (yes/no) |
|---|---|---|
| N1 | New repo from this kit (`README.md` → "Start a new event"). `LICENSE`, ignore files, `.env.example`, `CLAUDE.md`, `ROADMAP.md`, `docs/` | First push to the remote succeeded |
| N2 | `docs/event-brief.md`: every fact from the public pages, **and the organizer's own source** (repo, Notion, Discord, rules PDF). Listings understate events | Brief committed; unknowns listed as kickoff questions |
| N3 | **Judging criteria at the top of `idea-shortlist.md`.** 3 ideas scored against them, plus a #2 fallback that reuses the same setup | Shortlist committed, one idea leading |
| N4 | Prove every key with a real call (`playbooks/gemma4-integration.md` has the Gemini/Gemma smoke) | Each key returns a real completion, not just HTTP 200 |
| N5 | Probe every API, dataset or device the top 2 ideas need (`data-prober` agent) | Real rows read back for each |
| N6 | Copy the agents into `.claude/agents/`; set `CLAUDE_CODE_SUBAGENT_MODEL=sonnet` in `.claude/settings.local.json` | `claude` lists the 5 agents |
| N7 | Machine prep (below) | Every line run |
| N8 | Pack: laptop, charger, phone hotspot (tested), HDMI + USB-C adapters, any hardware | Packed |

**Machine prep (Windows, from Converge's traps):**

```powershell
powercfg /change standby-timeout-ac 0      # no sleep while plugged in (a test run died to sleep)
powercfg /change monitor-timeout-ac 0
claude update                              # current CLI
vercel whoami; gh auth status              # deploy + git authenticated
python -m playwright install chromium      # browser for scripts/verify-e2e.py
Get-Process node -ErrorAction SilentlyContinue | Stop-Process -Force   # stray node processes broke the local build
```

Close other Claude sessions that use the Playwright MCP browser: only one session can hold its
profile at a time.

---

## Kickoff (K → T0)

| # | Step | Owner | Gate |
|---|---|---|---|
| K1 | Ask the kickoff questions; **commit the answers into `event-brief.md`** | one named person | Every question answered or marked "organizer doesn't know" |
| K2 | Team formed; roles named: **spine** (one person + main session), **presenter**, visuals, data | team | Roles written in `ROADMAP.md` §0 |
| K3 | **Lock the idea.** Any reframe is re-scored against the judges' criteria in `idea-shortlist.md` | team | One idea, named, with a score against the criteria |
| K4 | **Write `docs/demo-script.md`**: the hook, the one moment, where the AI is visible, the close | presenter + spine | Script committed; every second accounted for |
| K5 | Cut the idea to what the script needs; write the build rows into `ROADMAP.md` §4 | spine | Rows written; anything not in the script is out |

> At Converge none of K1, K4 or K5 happened, and the idea locked 1h45m late. At Hack for Humanity
> K4 happened, and we won. If kickoff runs out before K4 is done, K4 is the first thing after T0,
> before any code.

---

## Build (T0 → F)

| # | When | Step | Gate |
|---|---|---|---|
| B1 | T0 + 15 min | Scaffold (lift working code where it exists) + first commit inside the window | `pnpm build` green |
| B2 | T0 + 30 min | **Deploy the empty scaffold** to the real URL | URL loads on the presenter's laptop |
| B3 | T0 + 1h30 | **Thin slice:** real input → real processing → real output on screen | Walked once by hand on production |
| B4 | T0 + 1h30 | Dispatch `submission-scribe` (README) and `screen-builder` (the one finished surface) | Both dispatched with the 5-field template |
| B5 | every hour | **Integrate:** every branch merges to `main`; deploy; run `verify-e2e.py` (or the event's version) | Prod walk green |
| B6 | when it first works | The strange moment end to end; slow AI precomputed; **tag `v01`**; record a screen capture of it working | Tag pushed; recording on the phone |
| B7 | F − 45 min | The AI's output is **visible on screen** in the demo path | Presenter can point at it |
| B8 | F − 30 min | Every input (mic, camera, sensor) tested by a human on the venue setup | One real run each |

---

## Freeze and demo (F → D)

| # | When | Step | Gate |
|---|---|---|---|
| F1 | F | **Freeze.** Tag `demo`, push tags. **Nothing merges after this** | `git tag demo` on the deployed commit |
| F2 | F + 5 min | Rehearsal 1, timed, on the venue setup | Under the limit, no dead ends |
| F3 | F + 15 min | Fix only what rehearsal 1 broke; rehearsal 2 | Under the limit twice |
| F4 | per K1 | Submit (form / repo link / README) | Confirmation received |
| F5 | D − 5 min | Fallbacks ready: local server running, recording on the phone, hotspot on | All three checked |
| F6 | voting | **Vote honestly** for the strongest rival | — |

---

## After (same night or next day)

| # | Step | Gate |
|---|---|---|
| A1 | Ask one judge: "What made the winner stand out? What would have made ours land?" | Answers written down |
| A2 | Write `docs/lessons-from-<event>.md` from the git log and roadmap; update `hackathon-kit/lessons-learned.md` | Committed |
| A3 | `ROADMAP.md` marked closed; all commits pushed; no stray worktrees (`git worktree list`) | `git status` clean, `git cherry -v @{upstream}` empty |
