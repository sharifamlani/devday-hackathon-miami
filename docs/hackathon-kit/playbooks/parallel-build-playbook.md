# Parallel build playbook — one builder, 4h45m

Researched 2026-10-10 against the official Claude Code docs on agents and parallel work, and
verified against the actually-installed CLI. Tooling lives in `.claude/` (gitignored, so it is
local tooling and not a "project material").

---

## Toolchain: UPDATED and verified — 2.1.123 → 2.1.296

**Resolved 2026-10-10.** The CLI was 173 versions behind and most of the parallelism surface was
simply not installed. `claude update` fixed it; every capability below was re-probed afterwards,
not assumed.

| Capability | Before (2.1.123) | Now (2.1.296) |
|---|---|---|
| `--worktree`, `--agents`, `--effort`, `--agent`, `--name`, `--resume`, `--fork-session` | ✅ | ✅ |
| **`--bg`** (dispatch a background session) | ❌ missing | ✅ **live** |
| **`claude agents`** (agent view) | ⚠️ stub — only `--setting-sources` | ✅ **full** — `--cwd`, `--model`, `--json`, `--agent`, `--add-dir`, `--permission-mode` |
| **`claude attach` / `logs` / `stop` / `respawn` / `rm` / `daemon`** | ❌ missing | ✅ **all present** |
| **Cross-session messaging** (gate 2.1.234 on native Windows) | ❌ | ✅ cleared |
| **`/subtask`** (fork subagent; gate 2.1.212) | ❌ (`/fork` only) | ✅ cleared |
| **Dynamic workflows / `ultracode`** (gate 2.1.203) | ❌ | ✅ cleared |
| `workflowSizeGuideline` (2.1.219) · `CLAUDE_CODE_WORKFLOW_MAX_CONCURRENT_AGENTS` (2.1.269) | ❌ | ✅ cleared |
| Worktree transcript follows session (2.1.198) · approval shared to main checkout (2.1.211) · project skills read through to worktrees (2.1.277) | ❌ | ✅ cleared |
| Agent-team mailbox malformed-entry fix (2.1.207) | ❌ | ✅ cleared |
| `claude attach` by partial name (2.1.290) | ❌ | ✅ cleared |

### Two lessons worth keeping

**The update has to hit the right install.** Updating the VS Code extension does **not** update
the CLI. There is one CLI install — the npm global at
`AppData/Roaming/npm/node_modules/@anthropic-ai/claude-code` — and `claude --version` reports
*that* one. The extension bundles its own newer build, which is why `Workflow`, `ListAgents`,
`SendMessage` and `Monitor` worked in an extension session while the CLI on PATH lacked their
flags. **Extra terminal sessions on build day run the CLI, so the CLI version is what governs
them.** Confirm with `claude --version` after any update, not by assuming.

**`--teammate-mode` is absent from `claude --help` by design** — the docs state it is
experimental and intentionally undocumented. So `--help` grepping cannot tell "missing" from
"hidden" for that one flag. It was listed as missing at 2.1.123 on that basis; treat it as
present-but-hidden now, and if it matters, test it rather than grep for it.

**Re-verify command** (thirty seconds, prevents planning around a feature that isn't there):

```bash
claude --version
claude --help | grep -- --bg
```

---

## The doctrine: parallelize the periphery, serialize the spine

The **spine** is the chain where each step needs the previous one to exist: input → data call →
model → output on screen. Agents added here wait on each other. You pay coordination cost for
zero concurrency.

The **periphery** only needs the spine's *interface*: research, verification, docs, seed data,
deploy config, styling, a second opinion on a bug. That work is genuinely concurrent.

Under deadline pressure the instinct is to parallelize the part that feels slowest — the core
build. That is precisely the wrong half.

### The real constraint is attention, not tokens

With one builder you can read one transcript, make one decision, and approve one permission
prompt at a time. So the purpose of dispatching agents is **not** more code per minute — it is
keeping your attention on the spine while the periphery gets done anyway.

**If it will need steering, you do it. If it returns a deliverable, an agent does it.**

### Three tracks, disjoint files

| Track | Owns | Who |
|---|---|---|
| **Spine** | the end-to-end path | **You + the main session, serially** |
| **Periphery** | the one screen that must look finished, styling, fixtures, deploy | Subagent |
| **Record** | README, data citations, model disclosure, demo script | Subagent |

The Record track is the one that gets skipped and then scrambled in the last fifteen minutes
while the demo goes unrehearsed. Dispatch it at hour three and it is simply done. Here it is also
graded: the README has five required sections.

### Cap: three concurrent agents

Not a cost rule — an attention rule. The docs are blunt: *"Three focused teammates often
outperform five scattered ones."*

---

## Why NOT agent teams on build day

Agent teams sound like the answer for a solo builder. The docs argue against it for this exact
shape of work, and so does the platform:

1. **The official guidance excludes our case.** Teams are for *"research and review,"* *"new
   modules,"* *"competing hypotheses."* Explicitly: *"For sequential tasks, same-file edits, or
   work with many dependencies, a single session or subagents are more effective."* A demo MVP is
   maximally dependency-coupled.
2. **Experimental, off by default**, with named limitations: task status can lag and block
   dependents, shutdown is slow, in-process teammates don't survive `/resume`, no nested teams.
   Debugging a flaky coordination layer at 1 PM is a losing trade.
3. **Split panes don't work here.** Not supported in **VS Code's integrated terminal or Windows
   Terminal** — both in use. That leaves in-process mode: every teammate inside one terminal,
   navigated by arrow keys.
4. **Teams don't isolate teammates in worktrees.** File partitioning is entirely manual.
5. **Enabling it changes ordinary delegation** — a named subagent silently becomes a teammate, so
   teams form when you didn't ask.

**Left disabled deliberately.** To opt in later:
`"env": { "CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS": "1" }`.

**Also not using `ultracode` on build day** (even once updated): it turns every substantive
request into a multi-agent run. Excellent for a Tuesday audit, ruinous with one shot and four
hours of quota.

---

## The quota guardrail

Running out of model quota at hour three with the demo unbuilt is the worst available outcome,
and parallelism is what causes it. *"Running several sessions or subagents at once multiplies
token usage."*

Configured in `.claude/settings.local.json`:

- **`CLAUDE_CODE_SUBAGENT_MODEL: sonnet`** — subagents on the cheaper model; the strong model
  stays on the spine and the judgment calls.
- Pre-approved permissions (below), so agents don't queue at the keyboard.
- `CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS` is available if a hard cap is ever wanted (default 20,
  far more than useful here).

**If a limit is hit: stop dispatching entirely and finish the spine by hand.** The spine is what
gets scored.

---

## What was configured

### `.claude/settings.local.json`

| Setting | Value | Why |
|---|---|---|
| `env.CLAUDE_CODE_SUBAGENT_MODEL` | `sonnet` | Quota protection; strong model reserved for the spine |
| `worktree.baseRef` | `head` | **Critical.** Default `fresh` branches from the repo's *default branch*, so a worktree agent would not see work just committed to the working branch |
| `permissions.allow` | pnpm / npm / npx / node / python / `curl -s` / git read+add+commit+push / vercel / gh read / playwright / the verified data-source domains | Agent permission prompts surface in the **lead** session. Unapproved commands turn parallel agents into a queue at the keyboard |

### `.worktreeinclude`

```
.env
.env.local
```

A worktree is a fresh checkout, so gitignored files are absent — without this, every worktree
agent fails on a missing API key. This file is **not** gitignored (it must travel with the repo).

### Skills — `.claude/skills/`

| Skill | Purpose |
|---|---|
| `parallel-agent-orchestration` | The decision layer: which primitive for which job, the three pre-dispatch checks, worktree gotchas, platform constraints, red flags |
| `solo-sprint-dispatch` | The concrete playbook: three-track partition, hour-by-hour pattern, pre-flight list, quota guardrail, dispatch prompt template |

### Subagents — `.claude/agents/`

| Agent | Role | Tools |
|---|---|---|
| `data-prober` | Proves a source returns usable data; documents real shape; flags staleness, silent 200-with-HTML errors, CORS, privacy hazards | read + net + write findings |
| `screen-builder` | Builds **one** screen to projector quality; absolute file ownership | read/write/edit |
| `submission-scribe` | Writes the judge-facing record **from the actual code**; never invents a feature | docs only |
| `demo-verifier` | Walks the demo path and reports evidence on a 7-rung ladder; reports, never fixes | read + net |
| `bug-hypothesis` | Investigates one theory and tries to **disprove** it; spawn several in parallel | read-only |

Each encodes the lessons already learned here: verify against primary data not labels, HTTP 200
is not success, evidence or it didn't happen, flag personal data.

---

## The dispatch template

A dispatched subagent inherits **no conversation history** — it loads CLAUDE.md and project
context, but nothing just discussed. Every dispatch needs all five fields:

```
CONTEXT:   <the 3 facts the agent cannot discover on its own>
OWNS:      <exact file paths. "Do not modify anything else.">
TASK:      <the deliverable, as a noun>
DONE WHEN: <a condition the agent can check itself>
RETURN:    <the exact shape you want back>
```

Missing `OWNS` causes overwrites. Missing `DONE WHEN` causes an agent that never stops.

**Send independent dispatches in one message** — multiple `Agent` calls in a single response run
concurrently; separate messages run serially.

---

## Never dispatched

- **The idea decision.** An agent will justify any option handed to it.
- **The demo narration.** It has to be believed by the person saying it.
- **The last integration step.** When two pieces must meet, one mind holds both sides.
- **Anything not yet verified once by hand.** Delegating an unverified assumption parallelizes
  the error.

---

## Monitoring — all available at 2.1.296

| What | How |
|---|---|
| Background subagents in this session | `/tasks` |
| Sessions Claude can reach (and message) | `/list-agents`, alias `/peers` |
| Background sessions | `claude agents` — `Enter` attach, `Space` peek, `Ctrl+X` stop, `Ctrl+T` pin |
| Dispatch a background session | `claude --bg "<task>"`, or `/bg <task>` from inside a session |
| One background session's output | `claude logs <id\|name>` · attach with `claude attach <id\|name>` |
| Workflow runs | `/workflows` — `p` pause/resume, `x` stop, `s` save as a command |
| Worktrees | `git worktree list` |

**Now genuinely available that wasn't before:** `claude --bg` for hand-off tasks that each get
their own worktree automatically, and cross-session messaging so separate terminal sessions can
pass findings without copy-paste. Both are useful on build day; neither changes the doctrine —
the spine still stays serial.

## Cleanup after the sprint

```bash
git worktree list
git worktree remove --force <each agent worktree>
git cherry -v @{upstream}   # must be empty
```
