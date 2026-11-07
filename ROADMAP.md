# Donor Desk: Step-by-Step Build Plan (LIVING)

> Single source of truth for **what gets built, in what order, by whom, and where it stands.** Status flips
> one cell at a time, in the same commit as the work (or right after a PR merges).
> **This roadmap is canon.** If `plan.md`, a brief or a message disagrees, this file wins or the other doc
> gets corrected. `plan.md` holds the *why* and the specs; this file holds the *order* and the *status*.
> v0.3 · Sat Nov 7, 2026 (evening) · previous version archived at `docs/_archive/ROADMAP_v0.2_pre_build_restructure.md`

---

## §0 You are here

- **Current phase:** Phase 4 (Integrate) and Phase 5 (Front end), running in parallel
- **Current step:** 4.1, merge the reviewed PRs into `main` in dependency order (Sharif)
- **Blocking decisions (Sharif):** 5.1 which front end · 6.1 fictional donor list or not · 6.6 Amazon fact
- **In flight:** 7.2 SQLite per-request connection fix (8b) · 7.3 service-wide model timeout (90) · QA round 4 (98)
- **Next unblocked action:** merge PR #4, then #8
- **Clock:** freeze **Sun Nov 8, 4:15 PM** · team in person at The LAB **4:30 PM** · submissions close **4:45 PM ET**
- **Last update:** Sat Nov 7, 2026 · lead session ("Ideas")

## §1 The North Star

**What it is:** Donor Desk, an AI back office for a nonprofit's fundraising team. Upload a messy donor list:
it merges duplicates without losing history (staff approve each merge), ranks who to call today with a
deterministic propensity score, researches organization donors from public sources with a link on every
fact, and drafts outreach that leads with the organization's real recent work, in its own voice.
(`plan.md` §1–§2)

**Who it serves:** a small nonprofit's one-person development team. Demoed as The Miami Foundation's
philanthropy team, 11 days before Give Miami Day (Thu Nov 19; early giving Sat Nov 14). (`plan.md` §11)

**MVP done delivers:** challenge #2's minimum, visibly: staff approve duplicates before merging, no gift
history is lost, and late regular givers surface in time, plus sourced research and approvable drafts.
Live on Sharif's laptop; a cached snapshot on Vercel. (`docs/event-brief.md` Q3, `plan.md` §9)

**Judged on (five equal categories, /10 each):** problem fit · originality · use of Codex/OpenAI ·
feasibility and reasoning · presentation. (`docs/event-brief.md` Q3)

## §2 Locked decisions

| ID | Decision | Source |
|---|---|---|
| D1 | Challenge #2 (duplicate donors + donors who stop giving) | team brainstorm, `transcripts/` · `plan.md` §1 |
| D2 | UI base: marmelab/atomic-crm (MIT) fork in `web/`, **pending 5.1 re-confirmation** | `plan.md` §10, §12 |
| D3 | Data is local SQLite (`data/donors.db`), no Supabase; the demo runs on Sharif's laptop | `plan.md` §10 |
| D4 | Python service on the OpenAI Agents SDK (FastAPI, `localhost:8000`) | `plan.md` §5, §14 |
| D5 | Scoring is deterministic Python; the LLM only explains it | `plan.md` §2 |
| D6 | Research covers **organizations only**; individuals are never researched | `plan.md` §3 · QA Q1 |
| D7 | Organizations and ★/big donors: always `draft`, a human approves; never auto-sent (DB trigger) | `plan.md` §13 amendments |
| D8 | Draft statuses: `draft` · `ready` · `approved` · `sent` | `plan.md` §13 amendments |
| D9 | No invented gift figures in drafts to real organizations (`is_sample`) | `plan.md` §13 amendments |
| D10 | Demo date `SCORE_AS_OF=2026-11-08`; day counts computed, never typed | `plan.md` §13 amendments |
| D11 | Vercel shows a read-only `snapshot.json`; nothing slow runs live on stage | `plan.md` §14 |
| D12 | No robocalls or voice outreach (the Foundation states it never solicits that way) | `plan.md` §2 row 9 |
| D13 | Codex is not used; the OpenAI API + Agents SDK must be visibly used | `CLAUDE.md` rule 10 |
| D14 | Never push to `main`; branch → PR → lead review → Sharif merges | `CLAUDE.md` rule 11 |
| D15 | 🔒 Carlos owns ingest (`service/ingest/`); everyone builds against the `plan.md` §13 contract | `CLAUDE.md` rule 13 |
| D16 | Repo public with an MIT license by Sun 4:45 PM; team cap 4 | `docs/event-brief.md` Q6, Q7 |

## §3 The Checklist

### Phase 0 — Prep and kickoff
**Goal:** keys proven, rules known, team formed. **Entry gate:** none. **Exit gate:** challenge chosen and rules recorded. **Status:** ✅

| # | Action | Owner | Status | Date · Commit | Source |
|---|---|---|---|---|---|
| 0.1 | Repo from the hackathon kit; first push | lead | ✅ | Nov 7 · `d671182` | `docs/hackathon-kit/` |
| 0.2 | OpenAI key + 4 model tiers + Agents SDK proven (7/7) | lead | ✅ | Nov 7 · `scripts/smoke-openai.py` | `docs/hackathon-kit/playbooks/openai-integration.md` |
| 0.3 | Event brief + sibling-event rules check | lead | ✅ | Nov 7 | `docs/event-brief.md`, `research/rules_check.md` |
| 0.4 | Pre-kickoff idea shortlist (6 shapes scored) | lead | ✅ | Nov 7 · `6682108` | `docs/idea-shortlist.md` |
| 0.5 | Organizer rules recorded: submission flow, team ≤4, public MIT repo, 4:45 PM deadline | lead | ✅ | Nov 7 · `1a9516e` | `docs/event-brief.md` Q2, Q6, Q7 |
| 0.6 | Official rubric + challenge #2 minimum recorded | lead | ✅ | Nov 7 · `72c443e` | `docs/event-brief.md` Q3 |
| 0.7 | Team joined on the DeepStation platform; team created | Sharif | ⏸ | — | DeepStation email, Nov 7 |

### Phase 1 — Idea and plan lock
**Goal:** one idea, one plan, one owner per lane. **Entry gate:** Phase 0. **Exit gate:** every agent has an assignment. **Status:** ✅

| # | Action | Owner | Status | Date · Commit | Source |
|---|---|---|---|---|---|
| 1.1 | Idea locked: donor fundraising agent (challenge #2) | team | ✅ | Nov 7 · `c073609` | `plan.md` §1–§2 |
| 1.2 | Miami Foundation demo persona researched | lead | ✅ | Nov 7 · `7c3e2a4` | `plan.md` §11 |
| 1.3 | atomic-crm chosen + codebase audit | lead | ✅ | Nov 7 · `0ac584d` | `plan.md` §12 |
| 1.4 | Local SQLite decision + 🔒 Carlos's ingest boundary + data contract | lead | ✅ | Nov 7 · PR #3 `7ba085e` | `plan.md` §13 |
| 1.5 | Agent roster, lanes, file ownership | lead | ✅ | Nov 7 · PR #4 (open) | `plan.md` §14 |
| 1.6 | Carlos confirms the §13 donors/gifts field list | Carlos | ⏸ | — | `plan.md` §13 |

### Phase 2 — Shell and hosting
**Goal:** an app on a real URL before features. **Entry gate:** 1.3. **Exit gate:** Vercel serves the shell. **Status:** ✅

| # | Action | Owner | Status | Date · Commit | Source |
|---|---|---|---|---|---|
| 2.1 | Copy atomic-crm @98bb47a into `web/` (MIT notice kept) | subagent | ✅ | Nov 7 · `fa32e73` | `plan.md` §12 |
| 2.2 | Root MIT `LICENSE` | subagent | ✅ | Nov 7 · `1caffff` | D16 |
| 2.3 | Vercel project `devday-donor-desk` live (demo mode) | subagent | ✅ | Nov 7 · `5a60642` · PR #2 `72705f6` | https://devday-donor-desk.vercel.app |

### Phase 3 — Back-end lanes (on branches)
**Goal:** every service piece built, tested and QA'd. **Entry gate:** Phase 1. **Exit gate:** all lanes report done + QA pass. **Status:** ✅ (on branches; not yet on `main`)

| # | Action | Owner | Status | Date · Commit | Source |
|---|---|---|---|---|---|
| 3.1 | DB schema + seed (12 donors incl. 4 real orgs, sample-labeled) | 8b | ✅ | Nov 7 · `222dbfa` (PR #8) | `plan.md` §13 |
| 3.2 | Propensity score + tiers + ★ (deterministic) | 8b | ✅ | Nov 7 · `51984d8` (PR #8) | `plan.md` §2 row 3 |
| 3.3 | Duplicate suggestions + merge/dismiss routes | 8b | ✅ | Nov 7 · `0ad31ee` (PR #8) | `plan.md` §2 row 2 |
| 3.4 | Data routes (`/donors`, `/duplicates`, `/score/run`) | 8b | ✅ | Nov 7 · `cb0ffc5` (PR #8) | `plan.md` §14 |
| 3.5 | Draft statuses + `subject`/`call_script`/`facts_used` + ★ triggers | 8b | ✅ | Nov 7 · `8c3bce3`, `af541bc` (PR #8) | D7, D8 |
| 3.6 | Enrichment agent, orgs only, every URL loads, cached for 4 orgs | 42 | ✅ | Nov 7 · `c2f62a9` (PR #5) | D6 |
| 3.7 | Org context from miamifoundation.org (10 dated facts, cached) | 86 | ✅ | Nov 7 · `ff3c84b` (PR #7) | `plan.md` §11 |
| 3.8 | Outreach agent: matched facts, no invented figures, orgs → draft, 90 s timeout | 86 | ✅ | Nov 7 · `5b5c658` (PR #7) | D7, D9 |
| 3.9 | Approve route `POST /drafts/{id}/approve` + `is_sample` | 8b | ✅ | Nov 7 · `4ba36b9`, `c156ab0` (PR #10) | D7, D9 |
| 3.10 | One-command pre-run pipeline + snapshot export (90 s timeout) | 8b | ✅ | Nov 7 · `f41ffce` (PR #10) | D11 |
| 3.11 | Service frame on :8000 mounting every lane | 90 | ✅ | Nov 7 · `bad1884` (PR #12) | `plan.md` §14 |
| 3.12 | Integration QA rounds 1–3 (24/24 live HTTP checks; 4 of 7 §9 criteria PASS) | 98 | ✅ | Nov 7 · `qa/checks` `70e8fb2` | `plan.md` §9 |

### Phase 4 — Integrate to `main`
**Goal:** one runnable `main`. **Entry gate:** Phase 3. **Exit gate:** `main` runs the service + tests green. **Status:** ⏸

| # | Action | Owner | Status | Date · Commit | Source |
|---|---|---|---|---|---|
| 4.1 | Merge PR #4 (plan, team, briefs) | Sharif | ⏸ | — | D14 |
| 4.2 | Merge PR #8 (data + scoring) | Sharif | ⏸ | — | 3.1–3.5 |
| 4.3 | Retarget PR #10 to `main`, then merge (pipeline, approve, snapshot) | Sharif | ⏸ | — | 3.9–3.10 |
| 4.4 | Merge PR #5 (enrich) and PR #7 (outreach) | Sharif | ⏸ | — | 3.6–3.8 |
| 4.5 | Merge PR #12 (service frame); it imports the above, so merge it last | Sharif | ⏸ | — | 3.11 |
| 4.6 | Post-merge check on `main`: `pytest service/tests` green, `python -m service.pipeline` runs | 98 | ⏸ | — | `plan.md` §8 |

### Phase 5 — Front end
**Goal:** one demo screen wired to the shared service. **Entry gate:** 5.1 decided. **Exit gate:** the demo path works live with 0 console errors. **Status:** ⏳

| # | Action | Owner | Status | Date · Commit | Source |
|---|---|---|---|---|---|
| 5.1 | **Decide the front end:** atomic-crm (PR #11) · Christian's inbox (PR #6) · Kindred site (PR #9) | Sharif + Christian | ⏸ | — | lead recommendation: atomic-crm |
| 5.2 | Call-today list, donor drawer (why/research/draft), duplicate banner + merge | 80 | ✅ | Nov 7 · `3359b1c` (PR #11) | `plan.md` §7 |
| 5.3 | Local API + snapshot data layer, approve flow, Sample-history badge | 80 | ✅ | Nov 7 · `36c77b1` (PR #11) | D9, D11 |
| 5.4 | Christian's inbox: CSV mapping, reversible merge, cadence explanation, drafts (labeled examples) | Christian | ✅ | Nov 7 · PR #6 `eefe303` | `docs/outreach-inbox-integration.md` |
| 5.5 | Show "no giving history lost" on merge ("2 records → 1, all N gifts kept") | 80 | ⏸ | — | challenge #2 minimum |
| 5.6 | Hide the atomic-crm Donors tab and other unused screens (if 5.1 = atomic-crm) | 80 | ⏸ | — | `plan.md` §12 |
| 5.7 | Make the AI visible: label where the Agents SDK ran (research, draft) | 80 | ⏸ | — | rubric: use of OpenAI |
| 5.8 | Merge PR #11 (or the chosen UI's PR) | Sharif | ⏸ | — | D14 |

### Phase 6 — Data and ingest
**Goal:** the demo's donor data matches the challenge, and upload works. **Entry gate:** 1.6. **Exit gate:** upload → ranked list, 6/6 duplicates. **Status:** ⏸

| # | Action | Owner | Status | Date · Commit | Source |
|---|---|---|---|---|---|
| 6.1 | **Decide:** switch the donor list to fully fictional (challenge requires synthetic details) | Sharif | ⏸ | — | `docs/event-brief.md` Q3 |
| 6.2 | Align the schema/seed/score inputs to Carlos's confirmed fields | 8b | ⏸ | — | 1.6 |
| 6.3 | Messy sample CSV (dupes, mixed dates) + `data/answer_key.json` (6 planted dupes, expected #1) | Carlos | ⏸ | — | `plan.md` §9 |
| 6.4 | Ingest: unstructured → §13 fields → `donors.db`; `service/ingest/router.py` auto-mounts | Carlos | ⏸ | — | D15 |
| 6.5 | Re-run the pipeline on the final data; regenerate the snapshot | 8b | ⏸ | — | D11 |
| 6.6 | Amazon research: curated Foundation page, or accept 1 fact | Sharif → 42 | ⏸ | — | lead recommendation: curated |

### Phase 7 — End-to-end verification
**Goal:** every `plan.md` §9 criterion PASS, graded by QA. **Entry gate:** Phases 4–6. **Exit gate:** a QA scorecard with 7/7 PASS. **Status:** ⏳

| # | Action | Owner | Status | Date · Commit | Source |
|---|---|---|---|---|---|
| 7.1 | First live UI ↔ service test (list < 2 s, drawer, ~11 s draft, approve saved) | 80 | ✅ | Nov 7 · screenshots ui-05..07 | `plan.md` §9 |
| 7.2 | Fix the SQLite cross-thread 500s (a connection per request + concurrency test) | 8b | ⏳ | — | 7.1 finding |
| 7.3 | Service-wide OpenAI client timeout (90 s, 2 retries, 504 → cached draft) | 90 | ✅ | Nov 7 · `13874e8` (PR #12) | 8b stall finding |
| 7.4 | QA round 4 on the regenerated snapshot | 98 | ⏳ | — | `qa/REPORT.md` |
| 7.5 | Real-browser walk on localhost: 0 console errors, 0 4xx/5xx, merge + dismiss on a db copy | 98 | ⏸ | — | `plan.md` §9 |
| 7.6 | Final §9 scorecard: 7/7 PASS (any FAIL keeps the work open) | 98 | ⏸ | — | global rule: independent grading |

### Phase 8 — Demo and submission assets
**Goal:** everything the judges and the form need. **Entry gate:** 5.1. **Exit gate:** a submission-ready repo + script. **Status:** ⏸

| # | Action | Owner | Status | Date · Commit | Source |
|---|---|---|---|---|---|
| 8.1 | Rewrite `docs/demo-script.md` for the chosen UI (hook, the moment, where the AI is visible, Q&A) | lead | ⏸ | — | `CLAUDE.md` rule 2 |
| 8.2 | Pre-generate drafts for every on-stage donor (no 11 s waits live) | 8b | ⏸ | — | QA Q10 |
| 8.3 | Vercel redeploy with the snapshot build (`VITE_DATA_MODE=snapshot`); walk the prod URL | lead + 80 | ⏸ | — | D11 |
| 8.4 | README: what it does, how to run, models named, data sources, limits (`submission-scribe`) | lead | ⏸ | — | `CLAUDE.md` "clean record" |
| 8.5 | Decide on the judge-research commit in git history before going public | Sharif | ⏸ | — | D16 |
| 8.6 | Make the repo public; confirm MIT `LICENSE` at the root | Sharif | ⏸ | — | D16 |
| 8.7 | Screen recording of the working demo (fallback) | team | ⏸ | — | `docs/demo-script.md` fallbacks |

### Phase 9 — Freeze and submit (Sun Nov 8)
**Goal:** submitted on time, rehearsed. **Entry gate:** Phase 7 exit. **Exit gate:** the DeepStation submission is accepted. **Status:** ⏸

| # | Action | Owner | Status | Date · Commit | Source |
|---|---|---|---|---|---|
| 9.1 | Freeze: tag `demo` on `main` at 4:15 PM; nothing merges after | lead | ⏸ | — | `CLAUDE.md` rule 4 |
| 9.2 | Rehearsal 1, timed, on the demo laptop | team | ⏸ | — | lessons-learned rule 10 |
| 9.3 | Rehearsal 2, timed | team | ⏸ | — | lessons-learned rule 10 |
| 9.4 | Team in person at The LAB by 4:30 PM | team | ⏸ | — | DeepStation email |
| 9.5 | Submit on DeepStation: name, description, public GitHub link (+ optional video) by 4:45 PM | Sharif | ⏸ | — | `docs/event-brief.md` Q2 |
| 9.6 | Fallbacks ready: local server, Vercel snapshot, recording, hotspot | team | ⏸ | — | `docs/demo-script.md` |

### Phase 10 — After
**Goal:** learn and close cleanly. **Entry gate:** demos done. **Exit gate:** lessons written, repo clean. **Status:** ⏸

| # | Action | Owner | Status | Date · Commit | Source |
|---|---|---|---|---|---|
| 10.1 | Ask a judge what made the winner stand out | team | ⏸ | — | lessons-learned "ask a judge" |
| 10.2 | `docs/lessons-from-devday-miami.md`; update the kit's `lessons-learned.md` | lead | ⏸ | — | lessons-learned |
| 10.3 | Close: all pushed, worktrees removed, `git status` clean | lead | ⏸ | — | global cleanup rule |

## §4 Open decisions

| # | Decision | Deadline / trigger | Phase impact |
|---|---|---|---|
| 1 | Which front end (5.1) | now: everything on screen depends on it | 5, 7, 8 |
| 2 | Fictional donor list (6.1) | before 6.5 | 6, 7 |
| 3 | Carlos's field list (1.6) | before 6.2 | 6 |
| 4 | Amazon research (6.6) | before 6.5 | 6 |
| 5 | Judge research in git history (8.5) | before 8.6 | 8 |

## §5 Reference index

- `plan.md`: the spec (features, guardrails, wireframes, smokes, criteria, contract, team)
- `docs/event-brief.md`: rules, schedule, rubric, kickoff answers
- `docs/demo-script.md`: the click order (to be rewritten at 8.1)
- `docs/briefs/`: file-based agent briefs
- `qa/REPORT.md` (branch `qa/checks`): QA scorecard
- `docs/outreach-inbox-integration.md`, `docs/outreach-inbox-verification.md`: Christian's inbox notes
- `docs/hackathon-kit/lessons-learned.md`: 12 rules from past events

## §6 Changelog

- **v0.3 · Sat Nov 7, 2026 (evening):** restructured into the living build plan (Phases 0–10, an owner per
  row). Records everything shipped on branches today (data, scoring, dedupe, enrich, outreach, pipeline,
  snapshot, service, UI) with SHAs, Christian's inbox (PR #6, his UI1–UI3 rows now 5.4) and Kindred site
  (PR #9). Unblocked: merges (Phase 4). Blocked: the front-end choice (5.1), fictional data (6.1), Carlos's
  fields (1.6). Previous version archived.
- **v0.2 · Sat Nov 7, 2026 (morning):** idea shortlist filled from the Nov 6 brainstorm + Miami Foundation
  research (Give Miami Day = Thu Nov 19); top shapes A Campaign Kit, B Grant Report Autopilot.
- **v0.1 · Fri Nov 6, 2026:** kit copied; event brief + rules check written; OpenAI key + 4 tiers + Agents
  SDK proven (7/7).
