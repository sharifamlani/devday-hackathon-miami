# Hackathon kit

Everything we learned from two Miami hackathons in October 2026, one Grand Champion
(Hack for Humanity) and one loss (Converge), packaged for the next event.

**Who it's for:** whoever runs our next build day (teammates and the Claude Code session at the
event). Read this page, then `lessons-learned.md`, then follow `runbook.md`.

---

## If you read nothing else

1. **Lock the idea before the build clock starts.** Both times we lost the first 1h20m–1h45m deciding.
2. **Score every idea, and every reframe, against the judges' own words.** We won when we built to
   the rubric; we lost when a strange idea became a sensible one.
3. **Write the kickoff answers down**: demo length, criteria, submission, **how voting works**.
4. **The demo script comes first.** No sentence in it, no feature.
5. **Put the AI's work on screen.** What the judges can't see didn't happen.
6. **Integrate every hour; freeze for real.** Tag `demo`; nothing merges after it.
7. **Rehearse twice, timed, on the venue setup.** We skipped it both times.
8. **Vote honestly.**

The rest (prep the night before, deploy at hour one, thin slice first, lift working code, commit
every unit, verify against the real system) we did both times, and it worked both times.

---

## What's in the kit

| File | What it is | Use it when |
|---|---|---|
| `lessons-learned.md` | The 12 rules, each with the evidence from the win and the loss | Before planning anything |
| `runbook.md` | The event-day clock: night before → kickoff → build → freeze → after, each step with a yes/no gate. Includes machine prep | Throughout the event |
| `tech-notes.md` | Proven parts to lift (voice interviewer, AI matching, music previews, 3D rooms, voice e2e test) with file paths, plus every technical trap we hit | When choosing the stack and building |
| `templates/` | Blank `event-brief.md`, `idea-shortlist.md`, `demo-script.md`, `ROADMAP.md`, `CLAUDE.md`, judge-facing `README.md`, `env.example` | Starting the new repo |
| `agents/` | The 5 Claude Code subagents: `data-prober`, `screen-builder`, `submission-scribe`, `demo-verifier`, `bug-hypothesis` | Copy into the new repo's `.claude/agents/` |
| `playbooks/` | `parallel-build-playbook.md` (how one builder runs agents), `gemma4-integration.md` (open-weight model traps) and `openai-integration.md` (GPT-6.x tiers, Agents SDK, Codex-only rule) | Before dispatching agents; before any Gemma or OpenAI call |
| `scripts/` | `verify-e2e.py` (Playwright on production, with a recorded voice fed into the mic) and `make-voice.ps1` (makes those voices). The repo root's `scripts/smoke-openai.py` proves the OpenAI key, tiers and Agents SDK | After every deploy; night before (N4) |

The full post-mortems behind the rules: `../lessons-from-hack-for-humanity.md` and
`../lessons-from-converge.md`.

---

## Start a new event

From the new repo's root (Git Bash), with `KIT` pointing at this folder:

```bash
KIT="/c/Users/Shari/Dropbox (Personal)/GenAI Company/Projects/creative-tech-buildathon/docs/hackathon-kit"
mkdir -p docs .claude/agents scripts
cp "$KIT"/templates/{CLAUDE.md,ROADMAP.md} .
cp "$KIT"/templates/env.example .env.example
cp "$KIT"/templates/{event-brief.md,idea-shortlist.md,demo-script.md} docs/
cp "$KIT"/agents/*.md .claude/agents/
cp -r "$KIT" docs/hackathon-kit          # the rules and playbooks travel with the repo
printf '.env\n.env.*\n!.env.example\nnode_modules/\n.next/\n.claude/\n.playwright-mcp/\n' > .gitignore
printf '.env\n' > .worktreeinclude
```

Then follow `runbook.md` from N1. The judge-facing `templates/README.md` is filled in at build
step B4 by the `submission-scribe` agent.

---

## Keep it current

After every event: write `docs/lessons-from-<event>.md` from the git log and roadmap, then update
`lessons-learned.md` here: add a column to the evidence, and change a rule if the event proved it
wrong.
