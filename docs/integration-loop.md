# Integration loop: integrate + live test (flywheel step 4–5)

Every PR that QA approves is merged to `main` by the lead. This loop starts at that merge: the change goes into a
running app, and gets walked like a user before anyone calls it done (`docs/sop/development-flywheel.md`).

## Two stacks

| Stack | For | Service | Web | Code and data |
|---|---|---|---|---|
| LIVE | Sharif clicks through it; the demo laptop app | :8001 | :5173 | worktree `C:\Users\Shari\dd-live-main` (detached at `origin/main`), its own `data/` |
| TEST | the scripted walk, from empty, after every merge | :8101 | :5174 | service from worktree `C:\Users\Shari\dd-live-test`, its own `data/`; web from LIVE's `web/` |

Each service reads `REPO_ROOT/data` of its own worktree (`DONORS_DB` is set too), so the two never share a db or a
cache file. Several caches under `data/` have no env override, which is why TEST runs from its own worktree. The
Dropbox repo's `data/donors.db` is never touched. The service's CORS and the dictation WebSocket allow only 5173 and
5174.

```
scripts/live_stack.ps1 start  -Stack all            # both stacks
scripts/live_stack.ps1 status                       # OK/DOWN per part, our PID, the port's listener
scripts/live_stack.ps1 restart -Stack all -Only service   # after a merge that touches service/
scripts/live_stack.ps1 reset  -Stack test           # stop TEST service, delete its runtime data, start it empty

# A QA copy on spare ports, with its own worktree and state dir. A web port other than 5173/5174 is passed to the
# service as CORS_ORIGINS (service/config.py), so the walk's requests and the dictation WebSocket are allowed.
scripts/live_stack.ps1 start -Stack test -TestServicePort 8199 -TestWebPort 5199 -TestRoot C:\path\to\worktree -StateDir C:\path\to\state
python scripts/e2e_demo_path.py --reset --web http://localhost:5199 --api http://127.0.0.1:8199 --db C:\path\to\worktree\data\donors.db
#   --reset uses a per-run state dir (<shots>\stack-state) off the reserved ports, and refuses the shared
#   C:\Users\Shari\dd-live-state there, so a reviewer's reset can never stop the IT lane's stacks (--state-dir overrides)
python scripts/e2e_demo_path.py --only 1,2 --web http://localhost:5173 --api http://127.0.0.1:8001 --db C:\Users\Shari\dd-live-main\data\donors.db   # reload LIVE after a reset
```

Defaults: `-LiveServicePort 8001 -LiveWebPort 5173 -TestServicePort 8101 -TestWebPort 5174`. LIVE moved off :8000
because an orphaned process from another session holds it. `reset` keeps `data/ingest_cache/` warm (as on stage) and
restores tracked caches from git. LIVE is reset only with `-Stack live`, on Sharif's or the lead's ask; after a LIVE
reset, reload the 8 sample files through the app (`--only 1,2` above). The script kills only PIDs it recorded in
`C:\Users\Shari\dd-live-state\pids.json` (with their child trees), and only while the process name and start time still
match what it recorded, so a reused PID is reported, never killed. Writes to `pids.json` hold `pids.lock` and land
through a temp file + rename. A reserved port held by another process is reported, never killed. Logs: `C:\Users\Shari\dd-live-state\logs\`.

## The loop

```
poll origin/main
  └─ new merge? ──yes──> git checkout --detach origin/main   in dd-live-main and dd-live-test
                         ├─ requirements.txt / package.json / package-lock.json changed? -> reinstall
                         ├─ service/ changed? -> live_stack.ps1 restart -Stack all -Only service (vite hot-reloads web)
                         ├─ step 5a: live AI-agent test of the merged PR's feature card on LIVE (acted out in the UI)
                         ├─ step 5b: python scripts/e2e_demo_path.py --reset   (TEST, from empty)
                         └─ report to the lead:
                              IT <sha> (#PR): scenarios N/M PASS · regression K/L | FAIL S2: expected / saw / owner / repro
```

Timing: a report within 10 minutes of a merge. The walk takes about 8 minutes (upload ~75 s, five agent calls).

## The regression walk (`scripts/e2e_demo_path.py`)

From an empty TEST db, at 1440×900, then 390×844 for step 11:

| # | Step | PASS when |
|---|---|---|
| 1 | upload the 8 files in `data/sample_inputs/` (not `answer_key.json` / `_README.md`) | Givers count on screen = `GET /people` |
| 2 | website step, `miamifoundation.org` → dashboard | dialog closes, open tasks ≥ 1; events ≥ 4 (INFO until e6's events PR) |
| 3 | Donors list and tabs | "N donors" and the Givers tab = `GET /people` giver; Neighbors/Community INFO |
| 4 | "Review merges →" → "Merge ✓" on every pair | 33 givers; 131 gifts = $1,367,535 in the db (`answer_key.json`). Row 4b (68 people: neighbor 20 / community 15) is INFO under the Givers-first scope |
| 5 | home | "N gifts at risk" = `/home/summary` = 5; duplicates = summary; task rows present |
| 6 | chat | a question → step cards naming real donors; "add a task" → +1, Undo → back; an email → approval card → "Approved … (dry run)", 0 sent |
| 7 | click a task | "Work on this task: …" → Get task, Get person → "Mark done?" |
| 8 | Find a donor → Knight Foundation → Enrich profile → keep one → Save to profile | suggestions with source links; exactly one tag saved |
| 9 | calendar | Give Miami Day 2026-11-19, Early Giving 2026-11-14 (INFO while `/events` is empty) |
| 10 | dictation | mic button present; without a mic a visible error line |
| 11 | phone width | no horizontal overflow at 390 on home, donors, inbox |

Every step also fails on a console error or an HTTP ≥ 400 response.

**Data leaves the laptop:** the walk uploads the fictional sample files and asks the live agent questions, so sample
data goes to the OpenAI API (ingest, context, chat, Enrich), and Enrich searches the public web for the real Knight
Foundation. No real donor data is used.

Verdicts:

- **PASS / FAIL**: the product did or didn't do it. Givers flows decide the run (Sharif's scope call, Nov 8).
- **INFO**: reported, never fails the run (Neighbors/Community, known gaps the lead accepted).
- **SELECTOR**: the walk couldn't find a control (usually a layout change). Fix the walk; it is not a product FAIL.

Output: a markdown table, `RESULT n/m PASS …`, screenshots and `problems.log` (full console/network errors) in
`--shots`. Exit 1 on any FAIL or SELECTOR. Selectors use roles and visible text, not layout, so the Home redesign
mostly doesn't break them.

## Live AI-agent test (step 5a)

For each merged PR, read its feature card (the acceptance scenarios in the PR body), then act each scenario out on
LIVE as the user would: click, type to the agent, upload. Record per scenario: did / saw on screen / data check (API or
SQL) / console errors / failed requests / PASS-FAIL, with a screenshot. PASS needs the screen and the data to agree.
Every FAIL names an owner guess and a repro command.

## Rules

- Never push to `main`; never edit product code to make a test pass: report it, and the lead routes the fix.
- Sends stay simulated; never send real email or SMS. Fictional data stays fictional.
- Never edit `service/ingest/`. No Supabase.
- A `node_modules` junction is unlinked with `(Get-Item <path>).Delete()`, never `rm -rf`.
