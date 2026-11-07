# ROADMAP: <EVENT NAME>

**Version:** v0.1
**The shared "where are we?"** Flip each status cell in the same step as the work, with the time and
commit SHA (`✅ 6:40 PM · abc1234`). Edit with targeted replacements, never a full-file rewrite.

---

## §0: You are here

**Phase:** night before · **K** = __ · **T0** = __ · **F** = __ · **D** = __

- **Roles:** spine = __ · presenter = __ · visuals = __ · data = __
- **In flight:**
- **Next unblocked:**

---

## §1: Night before (verification, docs and research only)

| # | Row | Status |
|---|---|---|
| N1 | Repo from the kit; first push | ⏸ |
| N2 | `docs/event-brief.md` from the listing **and the organizer's own source** | ⏸ |
| N3 | `docs/idea-shortlist.md`: criteria at the top, 3 ideas scored, a fallback | ⏸ |
| N4 | Every key proven with a real call | ⏸ |
| N5 | Every API / dataset / device for the top 2 ideas probed (`data-prober`) | ⏸ |
| N6 | Agents in `.claude/agents/`; subagents on sonnet | ⏸ |
| N7 | Machine prep (`runbook.md`): no sleep, CLI current, auth, Playwright, stray node killed | ⏸ |
| N8 | Packed: charger, hotspot tested, adapters, hardware | ⏸ |

## §2: Kickoff (K → T0)

| # | Row | Gate | Status |
|---|---|---|---|
| K1 | Kickoff questions answered and committed to `event-brief.md` (incl. **voting**) | All 8 answered | ⏸ |
| K2 | Team formed; roles in §0 | Names written | ⏸ |
| K3 | **Idea locked and named**; any reframe re-scored against the criteria | Before T0 | ⏸ |
| K4 | **`docs/demo-script.md` written**: hook, moment, where the AI is visible | Before any code | ⏸ |
| K5 | Build rows below written; anything not in the script is cut | Rows exist | ⏸ |

## §3: Build (T0 → F)

| # | Row | Target | Status |
|---|---|---|---|
| B1 | Scaffold (lifted where possible) + first commit | T0 + 15 m | ⏸ |
| B2 | Empty scaffold deployed to the real URL | T0 + 30 m | ⏸ |
| B3 | Thin slice: real input → processing → output, on production | T0 + 1 h 30 | ⏸ |
| B4 | `submission-scribe` (README) + `screen-builder` dispatched | T0 + 1 h 30 | ⏸ |
| B5 | Hourly integration: all branches → `main` → deploy → prod walk | every hour | ⏸ |
| B6 | The moment end to end; slow AI precomputed; tag `v01`; recording captured | | ⏸ |
| B7 | The AI's output visible on screen in the demo path | F − 45 m | ⏸ |
| B8 | Every input tested by a human on the venue setup | F − 30 m | ⏸ |
| _(event-specific rows go here at K5)_ | | | |

## §4: Freeze and demo

| # | Row | Target | Status |
|---|---|---|---|
| F1 | **Freeze: tag `demo`; nothing merges after** | F | ⏸ |
| F2 | Rehearsal 1, timed, venue setup | F + 5 m | ⏸ |
| F3 | Rehearsal 2, timed | F + 15 m | ⏸ |
| F4 | Submitted | per Q2 | ⏸ |
| F5 | Fallbacks ready: local server, recording, hotspot | D − 5 m | ⏸ |

## §5: After

| # | Row | Status |
|---|---|---|
| A1 | Asked a judge what made the winner stand out | ⏸ |
| A2 | `docs/lessons-from-<event>.md` written; kit `lessons-learned.md` updated | ⏸ |
| A3 | Closed: all pushed, no stray worktrees, `git status` clean | ⏸ |

---

## §6: Changelog

- **<date time>**: <what shipped · what's now unblocked · what's now blocked>
