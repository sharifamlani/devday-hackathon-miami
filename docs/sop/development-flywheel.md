# SOP: the development flywheel

> Sharif, Sun Nov 8: "Build, QA → merge to main → integrate, and then LIVE TEST with an AI agent using the feature to
> ensure it works ... so that we can be 100% confident that the feature we are building actually works and does what
> it is intended to do."

Every feature, fix and UI change follows these 6 steps in order. No step is skipped, and no step is done by the
agent that did the previous one. A feature is **done** only when step 5 passes on the merged, running app.

```
0 DEFINE ──> 1 BUILD ──> 2 QA GATE ──> 3 MERGE TO MAIN ──> 4 INTEGRATE ──> 5 LIVE AI-AGENT TEST ──> DONE
   ^                         │ CHANGES                                           │ FAIL / GAP
   └─────────────────────────┴───────────── 6 LOOP (lead routes to owner) <─────┘
```

## Two modes (Sharif, after DevDay)

- **Production mode:** the wheel above, with the QA gate (step 2) before every merge.
- **Hackathon mode: no QA agent.** Builders run their own tests and open a PR; the lead merges; the Integrate lane
  puts it on LIVE only after the **User-Journey agent** (a real browser, typing like a user, screen vs API/SQL) passes.
  Pinned merges, backups before every LIVE move, and "nobody tests their own work" stay.
- Both modes: a standing User-Journey agent walks every merge on its own stack and does a read-only walk of LIVE
  after every move (user-level skill `user-journey-tester`). Test lanes never run first-run imports on LIVE.

## Step 0: Define (BEFORE any code)
The lead and builder write a **feature card**. It goes in the PR body, and the brief, before the first commit. It is
the contract that QA and the live AI tester grade against, and it can't be loosened after the fact.

```
### Feature card
User:            who uses it (e.g. "development officer at The Miami Foundation")
Goal:            what they're trying to get done, in their words
Intended behavior: what the app does, step by step, from where they start
Acceptance scenarios (each one observable in the running app):
  S1. Given <start state>, when <user action>, then <visible result + data change>
  S2. ...
  S-neg. Given <bad input / edge>, then <safe, clear behavior> (at least one)
Must NOT happen: (e.g. "nothing is sent without an approval click", "no gift is lost or double-counted")
Data check:      the API/SQL fact that proves it (e.g. GET /tasks shows done=true; totals = answer key)
Out of scope:    what this PR deliberately doesn't do
```

## Step 1: Build (builder session)
- Worktree `--no-track` off `origin/main`, outside Dropbox. `push -u`, and check that `@{upstream}` is not main.
- Small commits; open the PR early with the feature card.
- The builder runs its own tests and a local walk of every scenario before asking for review. That's self-check
  only; it never counts as the verdict.

## Step 2: QA gate (QA session, or a named overflow reviewer; never the builder)
- Grade the PR **merged with current main**: full test suite, typecheck, unit tests, plus a walk of each scenario in
  the feature card.
- Verdict: `APPROVE <full sha copied from gh>` or `CHANGES file:line, why, fix`. Re-reviews look at the diff only.
- In parallel, QA keeps an **integration tree** (main + every open PR merged together) to catch PR-vs-PR breaks.

## Step 3: Merge to main (lead only)
- `gh pr merge N --merge --match-head-commit <approved sha>` the moment the approval lands.
- If the head moved, the PR goes back to step 2 for the diff. Tell dependent PRs to rebase; close superseded ones.

## Step 4: Integrate (Integrate + Test lane)
- Within 5 minutes of the merge, the LIVE app (localhost:5173 + service :8000) runs the new `main`.
  Reinstall dependencies if the lockfile or requirements changed.
- The TEST stack (:5174 / :8101) is reset to an EMPTY database. Load the demo data the way a user would: drag in the
  8 files.
- Run the scripted Playwright regression walk of the whole demo path. It catches anything the merge broke elsewhere.

## Step 5: Live AI-agent test (Integrate + Test lane; the decisive step)
An **AI tester agent** that did not write the code gets ONLY the feature card and the URL of the running app. It
**uses the feature the way the user would**, through the real UI (Playwright MCP / a browser agent): it clicks,
types, talks to the in-app agent, uploads files, and reads what's on screen. Then it judges each scenario.

For each acceptance scenario it records:
```
| Scenario | Did (actions) | Saw on screen | Data check (API/SQL) | Console errors | Failed requests | PASS/FAIL |
```
Rules:
- Desktop (1440) and phone (390). Starts from the state the scenario names, usually an empty db plus the 8 files.
- PASS needs the screen AND the data check to agree. "Looks right" is not a result.
- Also report **GAPS**: the behavior exists in the API but the user can't reach it in the UI.
- Screenshots are saved per scenario; the paths go in the report.
- The tester never changes product code to make something pass.

Report to the lead within 10 minutes of the merge:
`IT <sha> (#PR): scenarios N/M PASS · regression K/L | FAIL S2: expected / saw / owner / repro`

## Step 6: Loop (lead)
- Every FAIL or GAP goes to the owning builder as a brief: the scenario, expected, saw, repro, screenshot. It goes
  back through steps 1 → 5.
- The feature is **DONE** only when step 5 is all PASS on main. Only then does it get its ROADMAP flip or a "done"
  claim to Sharif.
- The independent evaluator grades the plan's criteria against the same running app at milestones.

## Roles
| Role | Session | Owns |
|---|---|---|
| Lead / PM | the lead session | feature cards with builders, routing, merges, keeping the wheel turning, status to Sharif |
| Builders | one lane each | step 1 |
| QA gate | QA session + named overflow reviewers | step 2 and the integration tree |
| Integrate + Test | its own session | steps 4 and 5, the LIVE app for Sharif |
| Deploy watcher | its own session | Vercel preview deploy + prod walk per merge |
| Evaluator | its own session | plan-criteria scorecard |

## Timings
Approval → merge: minutes. Merge → step-5 report: 10 minutes or less. FAIL → owner briefed: immediately.

## Non-negotiables
- Main stays green; a red main comes before any feature.
- Teammates who merge without the gate get the same steps 4 and 5 right after, plus a QA retro check.
- Kill only your own PIDs. Unlink `node_modules` junctions with `rmdir`, never `rm -rf`. Sends stay simulated in tests.
- The human's scope calls (e.g. "givers only") go to QA and the tester, so off-scope issues don't block.
