# plan.md: donor fundraising agent (working name TBD)

**The living plan.** Decisions go here, not in chat. Status lives in `ROADMAP.md`; the click order lives in
`docs/demo-script.md`. Edit with targeted replacements and commit each change.

**Source:** team brainstorm at The LAB, Sat Nov 7 (`transcripts/brainstorm.md`), plus Sharif's additions.
**Version:** v0.1 · Sat Nov 7, 2026

---

## 1. Problem

**Challenge #2** (problem statements): nonprofits' donor lists are messy and full of duplicates. Donors
quietly stop giving and nobody notices in time. Since last year's public-funding cuts, staff are thin and
can't track or follow up with every donor.

One-line pitch: *upload a messy donor list, and an agent tells your one fundraiser who to call today and
why, in your own voice.*

## 2. What it does (consensus + Sharif's additions)

| # | Capability | Detail | Priority |
|---|---|---|---|
| 1 | **Ingest** | Upload a messy CSV/XLSX. The agent maps columns and builds clean donor profiles and a gift history | Core |
| 2 | **Dedupe** | iPhone-style: "We found this donor twice. Merge?" Answers "see each donor once" | Core |
| 3 | **Gift tracking + propensity score** (*most important*) | Every gift has a date and amount. The score combines recency, frequency, amount and **gap since last gift vs. that donor's usual cadence**. It flags "lapsing" donors and ranks who to contact first | Core |
| 4 | **Tiering** | Big vs. small donors; big-name sponsors get a ★ flag | Core |
| 5 | **Org context** | The agent reads the nonprofit's website/blog (later: Drive/Outlook photos) to know what they did lately | Core |
| 6 | **Value-based outreach** | Drafts lead with "here's what we did," never just "please give." Big donors: AI drafts, a human sends. Small/lapsed: automated email/text. Written in the org's voice | Core |
| 7 | **Enrichment research agent** | Researches existing donors from public sources (employer, giving history, board seats, foundation ties) and adds that to the profile. Big-donor briefs go to staff | Core (Sharif) |
| 8 | **ICP + new-donor finder** | From the enriched current donors, the agent builds an ideal donor profile, then researches **new** prospects who match it, with the reason for each | Stretch (after 1–7 work) |
| 9 | AI voice calls to small donors | Script + objection handling (needs Twilio) | Cut unless time |

**How the score works (decided):** Python computes the number deterministically from gift history (the
LLM never computes it). The LLM only explains it in plain words: "Gave every December for 4 years; nothing
this year; 23 days left in the year → call first."

## 3. Guardrails

- **Scope:** rows 1–7 are the demo. Row 8 only after the full core path works on production.
- **No AI-generated images or video of the nonprofit's work.** The AI only assembles real content.
- **Research only public, professional information** on donors (the standard nonprofit practice called
  prospect research). No home addresses or family details. Show the source link for every enriched fact.
- **Demo data:** fictional individual donors plus **real local businesses and foundations**, so the
  enrichment agent finds real public results on stage without profiling private people. Label the sample
  as sample data.
- **Big donors never get an automated message.** A human approves and sends.

## 4. Team and roles

| Who | Owns |
|---|---|
| Sharif | Agents, scoring logic, enrichment and outreach back end |
| (name) | UI |
| (name) | Sample data + demo script |
| (name) | Pitch + README |

Team cap was discussed as 4 or 5 (confirm at the desk). Anni may join as the fifth.

## 5. File tree (proposed: confirm stack at K5)

```
devday_hackathon/
├── plan.md                     this file: the living plan
├── ROADMAP.md                  status rows, flipped per commit
├── docs/demo-script.md         the spec: click order, the moment, Q&A
├── data/
│   └── sample_donors.csv       messy sample: dupes, mixed date formats, real local orgs
├── service/                    Python Agents SDK back end (not "agents/": shadows the SDK import)
│   ├── main.py                 FastAPI: /ingest /donors /enrich /outreach
│   ├── ingest.py               column mapping + clean profiles (LLM-assisted)
│   ├── dedupe.py               fuzzy match → merge suggestions
│   ├── score.py                propensity score: pure Python, unit-tested
│   ├── org_context.py          reads the nonprofit's site → recent-news facts
│   ├── enrich_agent.py         Agents SDK + web search tool → sourced donor facts
│   ├── outreach_agent.py       drafts in the org's voice from org_context + profile
│   └── tests/test_score.py     score correctness on hand-built histories
└── web/                        Next.js UI on Vercel
    └── app/page.tsx            upload → donor table → donor drawer → drafts
```

## 6. Flow

```
 [Staff uploads CSV] --> +-----------+     +-----------+     +---------------+
                         | ingest.py | --> | dedupe.py | --> | merge prompt  | --> staff clicks Merge
                         +-----------+     +-----------+     +---------------+
                                                 |
                                                 v
                                          +-------------+      gift dates + amounts
                                          |  score.py   | <--- (deterministic)
                                          +-------------+
                                                 |
                       +-------------------------+--------------------------+
                       v                                                    v
              +-----------------+                                 +-------------------+
              | enrich_agent    |  web search, sourced facts      | org_context.py    |
              | (per donor)     | ------------------+             | (nonprofit site)  |
              +-----------------+                   |             +-------------------+
                       |                            v                       |
                       |                    +---------------+               |
                       +------------------> | outreach_agent| <-------------+
                                            +---------------+
                                                    |
                         +--------------------------+------------------------+
                         v                                                   v
               [Big donor: brief + draft,                       [Small/lapsed: draft queued
                human approves and sends]                         for automated send]

  Stretch: enriched donors --> ICP profile --> prospect search --> "new donors like your best ones"
```

## 7. UI wireframes

**Main screen** (new surface)

```
+--------------------------------------------------------------------------+
| [logo] Donor Desk          Sample: "Miami Paws Rescue"   [Upload list ⬆] |
+--------------------------------------------------------------------------+
| ⚠ 6 possible duplicates found                         [Review merges →] |
+--------------------------------------------------------------------------+
| Call today (ranked by propensity)                                        |
| # | Donor            | Tier | Last gift   | Usual     | Score | Why      |
| 1 | ★ Rivera Family Fdn | Big | Dec 2025 | yearly Dec | 92 | lapsing  ▶|
| 2 | Ana Torres       | Small| Mar 2026    | quarterly | 81    | overdue ▶|
| 3 | Bayside Dental   | Mid  | Oct 2026    | yearly    | 40    | on track▶|
+--------------------------------------------------------------------------+
```

**Duplicate review** (modal)

```
+------------------------------------------------+
| We found this donor twice                      |
|  Ana Torres  ana.t@mail.com   3 gifts          |
|  A. Torres   ana.t@mail.com   1 gift           |
|            [Keep separate]   [Merge ✓]         |
+------------------------------------------------+
```

**Donor drawer** (opens from ▶): the AI's work is visible here

```
+----------------------------------------------+
| ★ Rivera Family Foundation         Score 92  |
| WHY: gave every Dec 2021–2025 ($5k avg);     |
|      nothing yet in 2026; 54 days left       |
|----------------------------------------------|
| RESEARCH (enrich agent)                      |
| • Funds animal welfare in Miami-Dade [src]   |
| • Board: ... [src]                           |
|----------------------------------------------|
| DRAFT (your voice)        [Edit] [Approve ✉] |
| "This year we rescued 212 dogs, including..."|
|  ↳ facts used: blog post Oct 12 [src]        |
+----------------------------------------------+
```

| UI piece | BEFORE | AFTER |
|---|---|---|
| Upload | none | header button, CSV/XLSX |
| Duplicate banner + modal | none | count + merge/keep |
| Ranked table | none | score, tier, ★, "why" |
| Donor drawer | none | why · sourced research · draft + approve |

## 8. Derisking (in dependency order: don't start N+1 until N passes)

| # | What it proves | Command | Expected | If it fails → |
|---|---|---|---|---|
| 1 | Key + Agents SDK work at the venue | `.venv/Scripts/python.exe scripts/smoke-openai.py` | `7/7` | check `.env` key and redeemed credits |
| 2 | Scoring is correct on known histories | `pytest service/tests/test_score.py` | all pass; the "Dec giver, no 2026 gift" case ranks first | fix `score.py` before any UI |
| 3 | Ingest + dedupe on the messy sample | `python -m service.ingest data/sample_donors.csv` | N clean donors, 6 merge suggestions | adjust column mapping prompt |
| 4 | Enrichment returns sourced facts for a real local org | `python -m service.enrich_agent "<real Miami org>"` | ≥2 facts, each with a URL | narrow the search prompt; fall back to cached results labelled as cached |
| 5 | Outreach draft uses real org news | `python -m service.outreach_agent <donor_id>` | draft cites ≥1 fact from the org site | check `org_context` output first |
| 6 | **End to end on production** | upload sample on the Vercel URL → open #1 → Approve | ranked table, drawer with research + draft, 0 console errors | walk each stage back to the failing smoke |

## 9. Evaluation criteria (definition of done; graded by a separate evaluator agent)

| Criterion | Metric + threshold | How measured | Evidence |
|---|---|---|---|
| A staffer uploads the messy sample and sees a ranked "call today" list | list renders, ≤ 10 s, on production | Playwright on the prod URL | screenshot + timing log |
| Duplicates are caught | 6/6 planted duplicates suggested, 0 false merges | compare against the answer key in `data/` | test output |
| Propensity ranking is right | the planted "lapsing December giver" ranks #1; all score tests pass | `pytest service/tests/test_score.py` | pytest pass line |
| Enrichment is sourced | 100% of displayed research facts carry a working link | evaluator clicks every `[src]` on 3 donors | link-check log |
| Drafts use real org news | ≥ 3/3 drafts cite a fact found on the org site | evaluator compares draft against `org_context` output | 3 rows in report |
| Big donors are never auto-sent | 0 automated sends to ★ donors | inspect the send queue after a full run | queue dump |
| Live demo has no errors | 0 console errors, 0 network 4xx/5xx on the demo path | Playwright console + network | log file |

## 10. Open decisions

- [ ] Product name
- [ ] Stack confirm at K5: Python back end + Next.js (the plan above) vs. all-TypeScript (`@openai/agents`) for one deploy
- [ ] **CRM base: recommend [marmelab/atomic-crm](https://github.com/marmelab/atomic-crm)** (MIT, verified
      from GitHub metadata; 1.4k stars; pushed Nov 7, 2026). React + Vite + shadcn, on **Supabase**, which we
      already have. Supabase's auto-generated REST API lets the agent service read and write with no extra
      back-end code. It already has contacts, companies, notes, tags, tasks and CSV import. **Gaps to add:**
      a `gifts` table (contact_id, amount, gift_date) for scoring, a tier tag, and a table for research
      facts and outreach drafts. Its contact-merge SQL function was added and then dropped in Dec 2025, so
      plan on our own `dedupe.py`. Estimate ~45 min to a hosted Supabase + Vercel deploy. Fallback:
      krayin/laravel-crm (MIT, 24k stars) but PHP and not Vercel-hostable. **No MIT/Apache nonprofit-specific
      CRM exists:** CiviCRM, Twenty, EspoCRM, SuiteCRM and Frappe CRM are all AGPL or mixed, so excluded.
      If adopted, `web/` in §5 becomes the atomic-crm fork and the stack question below is settled.
- [ ] Which real local businesses/foundations go in the sample list
- [ ] Team size (4 or 5) and who owns UI, data and pitch
