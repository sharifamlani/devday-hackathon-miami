# ROADMAP: DevDay Exchange Community Hackathon: Miami

**Version:** v0.2
**The shared "where are we?"** Flip each status cell in the same step as the work, with the time and
commit SHA (`✅ 6:40 PM · abc1234`). Edit with targeted replacements, never a full-file rewrite.

---

## §0: You are here

**Phase:** build · **K** = Sat 12:00 PM · **T0** = ~12:30 PM · **F** = Sun 3:30 PM · **Submit** = Sun 4:00 PM · **D** = Sun 5–8 PM

- **Roles:** spine = __ · presenter = __ · visuals = __ · data = __
- **In flight:** Project 2 donor-analysis MCP scaffold and synthetic multi-format example
- **Next unblocked:** launch `stat-mcp`, walk one synthetic import through normalized output and one donor score; add UI integration after the service path is clear

---

## §1: Night before (verification, docs and research only)

| # | Row | Status |
|---|---|---|
| N1 | Repo from the kit; first push | ✅ Nov 7 · d671182 · pushed to github.com/sharifamlani/devday-hackathon-miami (private) |
| N2 | `docs/event-brief.md` from the listing **and the organizer's own source** | ✅ Nov 7 · no organizer source exists; 9 sibling pages in `research/rules_check.md` |
| N3 | `docs/idea-shortlist.md`: criteria at the top, 3 ideas scored, a fallback | ✅ Nov 7 · 6 shapes scored (A 38, B 37), A↔B fallback |
| N4 | Every key proven with a real call | ✅ Nov 7 · `scripts/smoke-openai.py` 7/7 |
| N5 | Every API / dataset / device for the top 2 ideas probed (`data-prober`) | ⏸ |
| N6 | Agents in `.claude/agents/`; subagents on sonnet | ✅ agents present (identical to kit) |
| N7 | Machine prep (`runbook.md`): no sleep, CLI current, auth, Playwright, stray node killed | ⏳ Codex CLI + Agents SDK installed; **`codex login` pending (human)** |
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
| B1 | Scaffold (lifted where possible) + first commit | T0 + 15 m | ⏳ source and `uv.lock` present locally; scaffold not committed or server-walked |
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

- **Nov 7, 2026 (morning)**: idea shortlist filled from Nov 6 brainstorm + Miami Foundation research (Give Miami Day = Thu Nov 19); top shapes A Campaign Kit, B Grant Report Autopilot · unblocked: K3 mapping at kickoff · blocked: D needs a data-prober run on 990 grant data
- **Nov 7, 2026 (pre-event)**: kit copied from creative-tech-buildathon; event brief + rules check written; OpenAI key + 4 tiers + Agents SDK proven (7/7); Codex CLI installed · unblocked: kickoff · blocked: `codex login`, problem statements (revealed at K)
- **Nov 7, 2026 (build, local update)**: Project 2 selected as the requirements source; `stat-mcp` FastMCP/Pydantic/pandas skeleton and per-donor Agents SDK criteria evaluator added; no packages installed, app run, or commit made yet · unblocked: dependency setup and first synthetic end-to-end walk
- **Nov 7, 2026 (integration/docs update)**: `uv sync` recorded in `stat-mcp/DEPENDENCIES.md`; canonical required fields, `/tools` catalog route, extraction/scoring flow, JavaScript MCP example, and agent integration guide documented · server/client walk and commit remain pending
