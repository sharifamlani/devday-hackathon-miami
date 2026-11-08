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
| 1 | **Ingest** (🔒 **Carlos**) | Upload messy, unstructured donor data. The agent maps it into the predefined fields (§13) that populate the database | Core |
| 2 | **Dedupe** | iPhone-style: "We found this donor twice. Merge?" Answers "see each donor once" | Core |
| 3 | **Gift tracking + propensity score** (*most important*) | Every gift has a date and amount. The score combines recency, frequency, amount and **gap since last gift vs. that donor's usual cadence**. It flags "lapsing" donors and ranks who to contact first | Core |
| 4 | **Tiering** | Big vs. small donors; big-name sponsors get a ★ flag | Core |
| 5 | **Org context** | **Decided (Sat): the Foundation's website is the only source for the demo** (miamifoundation.org news, newsletter, priorities pages; §11). Gmail integration (pulling stewardship history from the inbox) is the intended next source but is **not in demo scope** | Core |
| 6 | **Value-based outreach** | Drafts lead with "here's what we did," never just "please give." Big donors: AI drafts, a human sends. Small/lapsed: automated email/text. Written in the org's voice | Core |
| 7 | **Enrichment research agent** | Researches existing donors from public sources (employer, giving history, board seats, foundation ties) and adds that to the profile. Big-donor briefs go to staff | Core (Sharif) |
| 8 | **ICP + new-donor finder** | From the enriched current donors, the agent builds an ideal donor profile, then researches **new** prospects who match it, with the reason for each | Stretch (after 1–7 work) |
| 9 | AI voice calls to small donors | Script + objection handling (needs Twilio) | **Cut**: the Miami Foundation states it never solicits by robocall (§11) |

**How the score works (decided):** Python computes the number deterministically from gift history (the
LLM never computes it). The LLM only explains it in plain words: "Gave every December for 4 years; nothing
this year; 23 days left in the year → call first."

## 3. Guardrails

- **Scope:** rows 1–7 are the demo. Row 8 only after the full core path works on production.
- **No AI-generated images or video of the nonprofit's work.** The AI only assembles real content.
- **Research only public, professional information** on donors (the standard nonprofit practice called
  prospect research). No home addresses or family details. Show the source link for every enriched fact.
- **Demo data:** the demo runs as **The Miami Foundation** (see §11). Individual donors are fictional. Org
  donors are real, **publicly reported** Miami Foundation supporters (§11), so the enrichment agent finds
  real results on stage, but their gift amounts and dates are invented. The upload and the UI say
  "Sample data" on screen. Never present invented gifts as the Foundation's real records.
- **Big donors never get an automated message.** A human approves and sends.

## 4. Team and roles

| Who | Owns |
|---|---|
| Sharif | Agents, scoring logic, enrichment and outreach back end |
| **Carlos** | 🔒 **Ingest**: unstructured data → predefined fields → database (§13). Nobody else edits his paths |
| (name) | UI |
| (name) | Sample data + demo script |
| (name) | Pitch + README |

**Team cap is 4** (DeepStation email). Anni can advise but can't be on the submitted team.

## 5. File tree (locked: atomic-crm fork + Python service)

`CC` = `web/src/components/atomic-crm` (atomic-crm's own layout). Only paths we touch are shown.

```
devday_hackathon/
├── plan.md                         this file: the living plan
├── ROADMAP.md                      status rows, flipped per commit
├── docs/demo-script.md             the spec: click order, the moment, Q&A
├── data/
│   ├── sample_donors.csv           messy Miami Foundation sample (§11): dupes, mixed dates, labelled SAMPLE
│   └── answer_key.json             planted duplicates + expected #1 donor, for the evaluator
├── web/                            atomic-crm fork (MIT notice kept in LICENSE.md); Vite SPA, run locally for the demo
│   ├── CC/providers/local/         NEW: data provider that talks to the local Python API (replaces Supabase)
│   ├── CC/root/CRM.tsx             hide deals/companies/tasks/sales; dashboard={CallToday}; disableTelemetry
│   ├── CC/root/defaultConfiguration.ts   title + logo → Miami Foundation demo branding
│   ├── CC/providers/commons/englishCrmMessages.ts   relabel Contacts → Donors, Companies → Organizations
│   ├── CC/dashboard/CallToday.tsx  NEW: ranked "Call today" list (the home screen)
│   ├── CC/contacts/DonorDrawer.tsx NEW: drawer with ScoreWhyPanel, ResearchPanel, OutreachPanel
│   ├── CC/contacts/ContactList.tsx add tier, ★ and score columns
│   └── CC/contacts/ContactMergeButton.tsx   reuse the dialog, fed by duplicate_suggestions
└── service/                        Python, OpenAI Agents SDK (not "agents/": shadows the SDK import)
    ├── main.py                     FastAPI on localhost: /donors /gifts /score /enrich /outreach (+ Carlos's /ingest)
    ├── db.py                       SQLite schema = the §13 contract; creates data/donors.db
    ├── ingest/                     🔒 CARLOS ONLY: unstructured data → §13 fields → donors.db
    ├── score.py                    propensity score + tier: pure Python, writes donor_scores
    ├── org_context.py              reads miamifoundation.org news → dated facts with URLs
    ├── enrich_agent.py             web search → sourced research_facts
    ├── outreach_agent.py           drafts in the Foundation's voice → outreach_drafts
    └── tests/test_score.py         score correctness on hand-built histories
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
| [logo] Donor Desk   The Miami Foundation · SAMPLE DATA   [Upload list ⬆] |
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
- [x] **Stack: LOCKED Sat Nov 7.** atomic-crm fork (React + Vite + shadcn) for the UI; a Python service on
      the OpenAI Agents SDK for cleaning, scoring, enrichment and drafts.
- [x] **Data: LOCKED Sat Nov 7 (Sharif) → local, no Supabase.** All data lives on the demo laptop in a
      SQLite file (`data/donors.db`, gitignored; rebuilt from `data/sample_donors.csv`). The UI talks to the
      local Python API. **Consequence:** the demo runs on `localhost`; the Vercel URL stays a shell. That's
      fine for submission (it needs only the GitHub link). Fallback: a screen recording. Supabase notes in
      §12 are superseded wherever they say "migration" or "RLS": read them as SQLite tables in `db.py`.
- [x] **CRM base: LOCKED Sat Nov 7 → [marmelab/atomic-crm](https://github.com/marmelab/atomic-crm)**. Audit in §12. (MIT, verified
      from GitHub metadata; 1.4k stars; pushed Nov 7, 2026). React + Vite + shadcn, on **Supabase**, which we
      already have. Supabase's auto-generated REST API lets the agent service read and write with no extra
      back-end code. It already has contacts, companies, notes, tags, tasks and CSV import. **Gaps to add:**
      a `gifts` table (contact_id, amount, gift_date) for scoring, a tier tag, and a table for research
      facts and outreach drafts. Its contact-merge SQL function was added and then dropped in Dec 2025, so
      plan on our own `dedupe.py`. Estimate ~45 min to a hosted Supabase + Vercel deploy. Fallback:
      krayin/laravel-crm (MIT, 24k stars) but PHP and not Vercel-hostable. **No MIT/Apache nonprofit-specific
      CRM exists:** CiviCRM, Twenty, EspoCRM, SuiteCRM and Frappe CRM are all AGPL or mixed, so excluded.
      If adopted, `web/` in §5 becomes the atomic-crm fork and the stack question below is settled.
- [x] ~~Which real local orgs go in the sample list~~ → the Miami Foundation's publicly reported supporters (§11)
- [ ] Who owns UI, data and pitch (team cap is 4)
- [ ] Confirm the persona framing with the team: we **demo as** the Foundation's fundraising staff; we do not
      claim the Foundation uses the tool. Opening line idea: "Imagine you're on Mike Rogers' philanthropy
      team, 12 days before Give Miami Day."

---

## 11. Demo persona: The Miami Foundation

Researched Sat Nov 7, 2026. ✅ = page read · 🔸 = search summary, verify before saying it on stage. Two
judges work here (Data & Engagement; Grants Administration), so **every fact on screen must be exact**.

**Why this persona works:** the Foundation's president said in Oct 2025 she wants "a most generous Miami".
It has 1,000+ fundholders and 60,000+ donors, and Give Miami Day is **Thu Nov 19** (early giving opens
**Sat Nov 14**), 12 days after the hackathon. The demo story writes itself: *"Who gave on Give Miami Day
last year but hasn't yet this year? Call them before the 14th."*

### Identity ✅
- **The Miami Foundation Inc** · EIN 65-0350357 · 40 NW 3rd Street, Suite 305, Miami, FL 33128
- Founded **1967** as the Dade Foundation. Renamed Dade Community Foundation (1987), then The Miami
  Foundation (2010).
- Tagline: **"Together, we are building a Greater Miami where everyone can thrive."**
- Five priorities: Empower Youth & Families · Generate Prosperity · Inspire Civic Involvement · Build
  Climate & Disaster Resilience · Eliminate Inequities
- "Invested over $905M" since 1967. Goal: $1 billion by end of 2026.

### Leadership ✅ (team page)
Rebecca Fishman Lipsey (President & CEO) · Lindsey Linzer (Chief Impact Officer) · Sue Rosenthal (CFO) ·
Nikisha Williams (COO) · Jocelyn Noya-Quintana (CMO) · Natalia Zea (Chief Community Investment Officer) ·
Francisco Gozalo (VP Finance & Controller) · **Mike Rogers (VP of Philanthropy): the demo user's boss**

### How they raise money ✅ (for-donors page)
| Fund type | Minimum |
|---|---|
| Donor Advised · Designated · Organization Reserve | $5,000 |
| Organization Endowment · Field of Interest | $25,000 |
| Scholarships · Fiscal Sponsorship | $100,000 |
| Supporting Organization | $3,000,000 |
| Unrestricted · Estate gifts | no minimum |

Giving societies: **Legacy Society** (planned gifts) and the **Ruth and Richard Shack Society**
(fundholders who've given $1M+). That maps directly onto our tiers: Shack-level = ★.
Fundholders have a 24/7 online donor portal. The Foundation sends a monthly newsletter. It accepts gifts
only via miamifoundation.org, givemiamiday.org and FCsuite, and **never by robocall or WhatsApp**, so our
outreach drafts are email and a human call only.

### Financials ✅ (ProPublica, fiscal year ends Dec)
| FY | Total assets | Contributions | Total revenue |
|---|---|---|---|
| 2025 | $622.7M | $113.7M | $156.0M |
| 2024 | $565.2M | $101.6M | $138.6M |
| 2023 | $525.0M | $119.3M | $133.5M |

### Give Miami Day results
| Year | Raised | Nonprofits | Donors |
|---|---|---|---|
| 2023 🔸 | $34.1M | 1,000+ | 46,619 |
| 2024 🔸 | $39.5M | 1,200+ | 51,700+ |
| 2025 ✅ | ~$43.8M (record) | 1,400+ | 60,000+ |
| 2026 | Thu Nov 19 (15th edition) · early giving Nov 14–18 · Give Miami 5K Sun Nov 15, Maurice Ferré Park | | |

### Recent news the outreach agent can cite (all real, all dated)
1. ✅ **Aug 31, 2026:** first South Dade Community Needs and Nonprofit Funding Landscape study: $94M across
   1,400+ grants to 262 nonprofits; **only 4% flexible/unrestricted**. Amazon committed $1M to 13 South Dade
   nonprofits.
2. ✅ **Sep 2026:** Press Forward South Florida grants to a dozen-plus newsrooms after Miami Herald layoffs
   (Foundation $100K, Knight $50K). ⚠ Total is "nearly $1M" in the release vs. $760K in the newsletter:
   don't quote a total.
3. ✅ **Sep 2026:** SET Summits in Wynwood and Homestead drew 300+ nonprofit leaders. McDermott Will &
   Schulte gave 398 pro bono hours ($500K+) to 17 nonprofits.
4. ✅ **Nov 2025:** record Give Miami Day, ~$43.8M for 1,400+ nonprofits.
5. ✅ **2026:** Miami Fellows Class XII (Education Lab, Aug 2026).
6. 🔸 Frederick A. DeLuca Foundation: $5.6M to Arts Access Miami, expanding to Central Miami from 2026.

Programs by priority ✅: Scholarships, Arts Access, Zero Drownings Miami · Nonprofit Bridge Loan, Miami Open
for Business · Vote Miami, Press Forward South Florida, Give Miami Day, Thrive 305 · Biscayne Bay
Recovery, Disaster Resilience, Resilient 305 · Racial Equity Fund, State of Black Philanthropy, Saltwater
Fellowship, LGBTQ Equity Fund.

### Brand voice ✅ (for the outreach agent's style prompt)
Upbeat, civic, plain, proudly local. Real phrases: "eternal optimists and Miami's greatest fans" ·
"Miami, this is your celebration." · "Everyone has a role to play." · "surround-sound generosity" (CEO).

### Sample donor list (built from this; see `data/`)
- **Org donors (real, publicly reported supporters; gift histories invented and labelled sample):** Amazon,
  John S. and James L. Knight Foundation, Frederick A. DeLuca Foundation, McDermott Will & Schulte (in-kind),
  Pérez Family Foundation 🔸
- **Individuals:** fictional names only, spread across fund types and tiers, including the planted cases:
  a lapsing Give Miami Day donor (gave 2023–2025, nothing in 2026), a quarterly donor who's overdue,
  duplicates (same email with a name variant), and a Shack-level ★ fundholder.

### Not found / don't claim
Grants paid per year (2025 audit PDF is encrypted) · "Our Miami Report" · Co-Lab page (404) · Give Miami Day
fee and bonus-pool details.

**Sources:** [miamifoundation.org](https://miamifoundation.org) ·
[who we are](https://miamifoundation.org/who-we-are/) ·
[team](https://miamifoundation.org/who-we-are/our-team/) ·
[for donors](https://miamifoundation.org/for-donors/) ·
[priorities](https://miamifoundation.org/miamis-priorities/) ·
[financials](https://miamifoundation.org/who-we-are/financials/) ·
[ProPublica 990s](https://projects.propublica.org/nonprofits/organizations/650350357) ·
[Give Miami Day](https://www.givemiamiday.org/) ·
[WLRN 2025 results](https://www.wlrn.org/south-florida/2025-11-21/give-miami-day-reports-raising-record-breaking-43-million-for-more-than-1-400-non-profits) ·
[Amazon / South Dade study](https://miamifoundation.org/news/amazon-commits-1-million-to-13-south-dade-nonprofits/) ·
[Press Forward](https://miamifoundation.org/news/press-forward-south-florida-awards-funds-2026/) ·
[Sept 2026 newsletter](https://miamifoundation.org/newsletter/foundation-newsletter-september-2026/) ·
[Miami Today CEO profile](https://www.miamitodaynews.com/2025/10/22/rebecca-fishman-lipsey-miami-foundations-ceo-targets-a-most-generous-miami/)

---

## 12. atomic-crm audit: what to keep, rip out, change and add

Read from the real repo via `gh api` on Sat Nov 7 (no clone). `CC` = `src/components/atomic-crm` in the
upstream repo. **Rule: hide, don't delete.** Several views (`activity_log`, `companies_summary`) and the
merge logic reference `deals` and `companies`, so we remove their screens and keep their tables.

### Repo facts
- React 19 · Vite 8 · TypeScript 5.8 · Tailwind 4 · ra-core 5 (headless react-admin) + shadcn-admin-kit ·
  papaparse · vitest. Node 24. Back end: Supabase (Postgres, REST, Auth, Storage, Deno edge functions).
- **Production build is a static SPA** (`npm run build` → `dist/`), so it deploys to Vercel with no config.
  Upstream itself only ships a GitHub Pages script.
- Env vars: `VITE_SUPABASE_URL`, `VITE_SB_PUBLISHABLE_KEY`, `VITE_IS_DEMO`, `VITE_ATTACHMENTS_BUCKET`.
- **No-backend demo mode exists:** `npm run dev:demo` runs on FakeRest with fake data. That's our stage
  fallback if Supabase fails.
- Schema source of truth: `supabase/schemas/*.sql`; migrations are generated from it with Docker.
- License: MIT (`LICENSE.md`, © Marmelab). Keep the notice.

### Keep
| Item | Path | Why |
|---|---|---|
| Contacts list/show/edit | `CC/contacts/*` | Becomes Donors |
| Supabase data provider | `CC/providers/supabase/dataProvider.ts` | Same REST API our Python service uses |
| Auth + login page | `CC/providers/supabase/authProvider.ts`, `CC/login/` | Demo login |
| Tags, notes | `CC/tags/*`, `CC/notes/*` | Donor labels; outreach history |
| **Contact merge dialog + logic** | `CC/contacts/ContactMergeButton.tsx`, `supabase/functions/merge_contacts/`, `CC/providers/commons/mergeContacts.ts` | Base for the iPhone-style merge |
| Global search | `CC/search/*`, `supabase/schemas/08_search.sql` | Free |
| Layout + shadcn kit | `CC/layout/*`, `src/components/ui/*` | Styling |
| FakeRest demo mode | `CC/providers/fakerest/*`, `demo/*` | Offline fallback |
| RLS pattern | `supabase/schemas/05_policies.sql` | Copy for new tables |

### Rip out / hide
| Item | Path | Why | Effort |
|---|---|---|---|
| Deals Kanban + charts | `CC/deals/*`, deals `<Resource>` in `CC/root/CRM.tsx`, nav tab in `CC/layout/Header.tsx`, `CC/dashboard/DealsChart.tsx`, `DealsPipeline.tsx` | Off the demo path (**keep the table**) | M |
| Companies screens | `CC/companies/*`, its `<Resource>` + nav tab | Show only as "Organization" on a donor (**keep the table**: FK) | S |
| Dashboard + onboarding stepper | `CC/dashboard/Dashboard.tsx`, `Welcome.tsx` | Replaced by Call today | S |
| Tasks | `CC/tasks/*`, `CC/dashboard/TasksList.tsx` | The call list replaces it | S |
| Users admin, invitations | `CC/sales/*`, `supabase/functions/users` | Not needed | S |
| Postmark email capture, MCP function | `supabase/functions/postmark/`, `supabase/functions/mcp/` | Irrelevant; don't deploy | S |
| Settings, changelog, profile | `CC/settings/*`, `CC/misc/ChangelogPage.tsx` | Clutter | S |
| **Upstream's `.claude/`, `CLAUDE.md`, `AGENTS.md`** | repo root | Their hooks (e.g. a migration-write blocker) would fight our workflow; they would fight our Claude Code setup | S: delete on fork |
| Husky + lint-staged | `.husky/`, `.lintstagedrc` | Pre-commit hooks may fail on Windows | S |
| Telemetry | `CC/root/CRM.tsx` | Pass `disableTelemetry` | S |

### Change
| Item | Path | Change |
|---|---|---|
| Labels | `CC/providers/commons/englishCrmMessages.ts` | Contacts → Donors, Companies → Organizations (strings only, no code renames) |
| Branding | `CC/root/defaultConfiguration.ts`, `src/index.css` | Miami Foundation demo title, logo, colors |
| Donor form | `supabase/schemas/01_tables.sql`, `CC/contacts/ContactInputs.tsx` | Hide gender/linkedin/newsletter fields |
| Donor list | `CC/contacts/ContactList.tsx` + `contacts_summary` view (`03_views.sql`) | Add tier, ★, score columns via the view |
| CSV import | `CC/contacts/useContactImport.tsx`, `CC/dataImport/` | Upstream expects a fixed schema, with no gifts, no cleaning and no dedupe. Route uploads to our Python `/ingest` instead |
| Show page → drawer | `CC/contacts/ContactShow.tsx` | Full page → right-hand drawer |
| Merge flow | `ContactMergeButton.tsx` + `merge_contacts` | Feed it suggested pairs; also re-parent `gifts`, `research_facts`, `outreach_drafts` |
| Signup | `supabase/config.toml` | Pre-create the demo user; disable signup |

### Add
| Item | Where | Notes |
|---|---|---|
| `gifts` | migration | `contact_id, amount, gift_date, fund_type, channel ('Give Miami Day'…), source_row`; index on contact_id |
| `donor_scores` | migration; written by `service/score.py` | `contact_id, score, tier, is_star, why jsonb, computed_at`; joined into `contacts_summary` |
| `research_facts` | migration | `contact_id, fact, source_url, retrieved_at, agent_run_id` |
| `outreach_drafts` | migration | `contact_id, body, status, approved_by, approved_at`. **DB trigger blocks auto-send for ★ donors** (not just the UI) |
| `duplicate_suggestions` view | migration | Pairs by lower-cased email (unnest `email_jsonb`) or normalized name; add `pg_trgm` |
| Call today | `CC/dashboard/CallToday.tsx` | Ranked list = home screen |
| Donor drawer | `CC/contacts/DonorDrawer.tsx` + 3 panels | Why · Research · Draft + Approve |
| Python service | `service/` | Service-role key server-side only, never in the browser |
| Demo user | `supabase/seed.sql` | Pre-seeded login |

### Risks
| Risk | Mitigation |
|---|---|
| Local Supabase needs Docker and a slow first start | Use a **hosted** Supabase project from hour 1; keep `dev:demo` as the fallback |
| Merge runs as a Deno edge function (separate serve step) | Re-implement merge as a plain SQL function, or in Python |
| Declarative schema workflow needs Docker for `db diff` | Write plain migration files; update `schemas/` by hand in the same commit |
| FakeRest fallback doesn't know our new tables | Decide by hour 10: seed it, or drop the fallback and use a screen recording |
| ~15k LOC wired together | Hide, don't delete; touch only the paths in §5 |
| Windows: `makefile` uses `script`/`lsof` | Run `npm run` scripts directly |

---

## 13. Ownership and the data contract

### 🔒 Blocked out for Carlos: do not touch
Carlos owns the component that takes **unstructured donor data and maps it into the predefined fields that
populate the database**. No one else (people or Claude sessions) edits these paths without asking him:

- `service/ingest/` (all of it)
- the `/ingest` route in `service/main.py` (he owns its body; others may only register it)
- `data/sample_donors.csv` and `data/answer_key.json` when he takes them over (he says when)

Everyone else builds **against the contract below**, not against his code. If the contract has to change,
Carlos and Sharif agree first, and the change lands in this section and `service/db.py` in the same commit.

### The contract: predefined fields (proposed: Carlos to confirm)
Ingest writes rows into these SQLite tables. Scoring, enrichment, outreach and the UI only read them.

**`donors`**
| Field | Type | Notes |
|---|---|---|
| id | integer pk | |
| full_name | text | required |
| first_name, last_name | text | |
| org_name | text | set when the donor is an organization |
| donor_type | text | `individual` or `organization` |
| email | text | lower-cased; first email if several |
| emails_all | text (JSON list) | every email seen, for dedupe |
| phone | text | E.164 if possible |
| city, state | text | |
| fund_type | text | Donor Advised, Designated, Endowment, … (§11 list) or null |
| notes | text | anything unmapped, kept verbatim |
| source_row | text | original row(s) for traceability |

**`gifts`**
| Field | Type | Notes |
|---|---|---|
| id | integer pk | |
| donor_id | integer fk → donors.id | |
| amount | real | USD |
| gift_date | text | ISO `YYYY-MM-DD` (ingest normalizes every date format) |
| channel | text | `Give Miami Day`, `online`, `check`, `event`, … |
| fund_type | text | nullable |
| source_row | text | |

**Written by others, never by ingest:** `donor_scores` (score.py), `duplicate_suggestions` (dedupe),
`research_facts` (enrich_agent), `outreach_drafts` (outreach_agent). Shapes as in §12 "Add".

---

## 14. The build team: Claude Code agents + a lead

**Lead: the "Ideas" session (main).** It owns `plan.md`, `ROADMAP.md`, `docs/`, assignments, integration
order and merge readiness. It writes no feature code; it dispatches, reviews, verifies and integrates.
Builders report to the lead and never merge their own PRs.

**Locked Sat Nov 7 (Sharif).** Demo runs on **Sharif's laptop**; it is also pushed to Vercel (see "Vercel"
below). Carlos confirms the §13 fields.

| Agent (session name) | Lane | Owns (and only these paths) | Branch / worktree | First deliverable |
|---|---|---|---|---|
| **Agent Phone** | Agent service frame | `service/main.py` app shell, `service/config.py`, `service/requirements.txt`, Agents SDK wiring | `feat/service` · `../dd-service` | Service starts; `/health` OK; one SDK call returns structured output |
| **devday-hackathon-8b** | Local database **+ scoring + dedupe** | `service/db.py`, `service/routes_data.py`, `service/score.py`, `service/dedupe.py`, `service/tests/` | `feat/data` · `../dd-data` | `donors.db` from §13; data routes; score tests pass |
| **devday-hackathon-42** | Enrich agent | `service/enrich_agent.py` | `feat/enrich` · `../dd-enrich` | ≥2 sourced facts for a real Miami org |
| **devday-hackathon-86** | Outreach agent | `service/outreach_agent.py`, `service/org_context.py` | `feat/outreach` · `../dd-outreach` | Draft citing a dated miamifoundation.org fact |
| **devday-hackathon-80** | CRM UI | `web/` | `feat/ui` · `../dd-ui` | Call-today list + donor drawer |
| 🔒 **Carlos** (human) | Ingest | `service/ingest/`, `/ingest` route body | his own | Messy CSV → `donors` + `gifts` |
| **Ideas** (this session) | Lead | `plan.md`, `ROADMAP.md`, `docs/` | `docs/*` | Assignments, demo script, reviews, merge order |

**Scoring owner (decided):** the local database agent (8b). Scoring is plain logic over `gifts`, it sits
next to the schema it reads, and it needs no AI. Split it out to its own session only if 8b falls behind.

**Route split (to avoid two owners of one file):** Agent Phone owns `main.py` and mounts routers.
8b writes `routes_data.py` as a FastAPI `APIRouter`. Carlos's `/ingest` lives in `service/ingest/router.py`.
Enrich and outreach expose plain functions that Agent Phone wires to routes.

**Vercel:** data is local SQLite on Sharif's laptop, which Vercel can't reach. So the Vercel build ships a
**read-only snapshot**: the lead exports the finished database (donors, scores, research, drafts) to JSON,
and the UI loads it when `VITE_DATA_MODE=snapshot`, with a "Cached sample" label. The live demo runs
against the laptop (`VITE_DATA_MODE=local`). This also covers "precompute slow AI" for the stage.

**Working rules for every agent**
1. **One branch per agent, in its own git worktree** (`git worktree add --no-track ../dd-<lane> -b feat/<lane> origin/main`, then `git push -u origin feat/<lane>`).
   Sessions sharing one folder would switch branches under each other.
2. Touch only your paths. Anything outside them goes to the lead as a request.
3. Build against the §13 contract. Contract changes go through Carlos + Sharif via the lead.
4. Commit small, push your branch, open a PR, and tell the lead. **Never push to `main`; never merge.**
5. Each deliverable ends with its §8 smoke passing, and the output pasted to the lead.

**Integration order (dependency):** Local database (schema + routes) → Carlos's ingest fills it → scoring →
enrich + outreach (in parallel) → UI wires to all → end-to-end smoke on the demo laptop.

### Contract amendments (lead decisions during the build)
- **Sat Nov 7: `outreach_drafts.status`** = `draft` (★/big donor: needs a human) · `ready` (small donor,
  may be sent) · `approved` (a human approved it) · `sent`. A DB trigger blocks `sent` on ★ donors without
  `approved_by`. New columns: `subject`, `call_script`, `facts_used` (JSON list of `{fact, url}`). Found by
  integration QA: `ready` crashed the old CHECK, and call scripts and citations were being dropped.
- **Sat Nov 7: `why` key names** are the ones in `service/score.py`: `days_since_last_gift`,
  `usual_cadence_days`, `overdue_ratio`, `reasons[]`, `points{}`, `pattern`, `give_miami_day{date, days_away}`.
- **Sat Nov 7: demo date** `SCORE_AS_OF=2026-11-08` everywhere (scoring and outreach); day counts are
  computed, never typed in.
- **Sat Nov 7: no sample figures to real orgs.** Real organization donors carry invented (SAMPLE) gift
  histories, so drafts to them never cite gift amounts, dates or counts; they thank "your partnership" and
  lead with a real Foundation fact. Donor rows expose `is_sample`; the UI shows a "Sample history" badge.
  Fictional individuals may keep their sample figures.
- **For Carlos's ingest:** `is_sample` is true only when `source_row` is literally `SAMPLE`. If the sample
  CSV you ingest should display as sample data, write `source_row = 'SAMPLE'` (or agree another marker with
  the lead).

---

## 15. Onboarding: two screens → local context dataset (Sharif, Sat Nov 7 evening)

**What the user does on first run:**

| Screen | User action | What happens under the hood | Owner |
|---|---|---|---|
| **1. Upload your data** | Drops in messy files: the Excel export, notes (.md), Word docs | `POST /ingest` → Carlos's ingest agent extracts donors + gifts into the §13 fields → `donors.db` → scoring + duplicate suggestions run | 🔒 Carlos (agent) · Christian (screen) · 80 (data layer) |
| **2. Tell us where you are online** | Enters URLs: website, X, LinkedIn, Instagram | `POST /context/run` → the **context agent** reads the website and each social profile, extracts dated, sourced facts tagged to the org's priorities → the **local context dataset** | context agent: 86 + social helper · routes: 90 · table: 8b |

**The local context dataset** (SQLite, `data/donors.db`): `org_profile(id, name, website, x_url, linkedin_url,
instagram_url, priorities JSON, voice JSON, updated_at)` and `org_context(id, source 'website'|'x'|'linkedin'|
'instagram'|'news', url, posted_at, fact, quote, priority, captured_at)`. Routes: `POST /context/run`, `GET /context`,
`GET /org-profile`. In the snapshot under `context`.

**Who uses it:**
- **Enricher / ICP + prospect finder (42):** the org's priorities and recent focus steer *which* new organizations it
  looks for ("funds climate resilience in South Dade" → prospects that fund the same).
- **Outreach (86):** drafts lead with the newest fitting fact from *any* source (a LinkedIn post from last week
  beats a June newsletter), with the post URL and date cited.

**Rules:** public information only, with every fact quote-verified and carrying its URL + date. Social media is
read through official APIs when tokens exist (X API, Instagram Graph, LinkedIn Org API); otherwise from a cache of
public posts. Never by logging in or getting around a bot wall. A blocked platform shows as "blocked," never faked.
For the demo: the Miami Foundation's URLs, precomputed so the context step is instant on stage.

### §15 amendment: the context agent runs live in the app (Sharif, Sat Nov 7 evening)
The context agent runs **in real time during onboarding**, not as a manual step:
1. **Live web research** via the OpenAI Agents SDK hosted web search: the org's website plus its public social
   profiles and posts as indexed by search (e.g. `site:linkedin.com/company/<org>`, `site:x.com/<handle>`,
   Instagram). Every fact comes back with its source URL and date and is quote-verified. This is legitimate search:
   no logins, no bot-wall workarounds. (The direct fetch is blocked: X shows no text, LinkedIn needs a login,
   Instagram hides captions, and miamifoundation.org serves a CAPTCHA to scripts. Findings in PR #19.)
2. **"Connect your accounts" (official sign-in, OAuth):** an org can grant access to its own X / Instagram
   Business / LinkedIn page, and the agent then pulls its own posts via the official APIs. Optional; adapters in
   `service/social_context.py`.
3. **Live progress:** `POST /context/run` starts a job; `GET /context/run/{job_id}` returns per-source status
   (`searching` | `done n facts` | `blocked: reason`) for screen 2 to show live.
4. **Stage safety:** the last successful run is cached, and the UI falls back to it (labeled cached) on timeout.

**Scope cut (Sharif, Sat Nov 7 late evening): for the demo the context agent researches the WEBSITE ONLY.** Screen 2 still collects the Instagram, X and LinkedIn URLs and saves them to `org_profile`, shown as "saved, not connected". They are not fetched or integrated in the demo. Steps 1 (social search), 2 (account connection) and per-social progress above are post-demo.

---

## 16. Three classes of people, donor briefs, beneficiary demographics (Sharif, Sat Nov 7 late evening)

**Changes to scope**
- **Cut:** any AI-placed phone call. Human call scripts stay; a person makes the call.
- **Add:** every person in the CRM is tagged into one of **three classes**: `donor` (supported us),
  `beneficiary` (people we help), `contact` (met, not yet either). Tagging is a simple field, set by Carlos's
  ingest from unstructured files and changeable in one click.
- **Add:** a **donor brief**: staff pick enrichment facts and the agent packages them into a call script plus
  talking points for a human to use.
- **Add:** **beneficiary demographics**, extracted by an agent from what the nonprofit already collected.
- **Keep:** texting, now aimed at all three classes: value updates to donors, check-ins and service
  reminders to beneficiaries, a welcome note to contacts. The provider is still to be decided.

### File tree (only what changes)
```
service/
├── db.py                     8b: people.contact_type, demographics table, text_log table
├── routes_data.py            8b: GET /people?type=, PATCH /people/{id} {contact_type}
├── ingest/                   🔒 Carlos: emits contact_type + self-reported demographics per person
├── demographics_agent.py     NEW (42): extract + normalize self-reported demographics from intake text
├── brief_agent.py            NEW (86): selected facts → call script + talking points
├── outreach_agent.py         86: SMS drafts per class (no ask to beneficiaries)
├── main.py                   90: POST /people/{id}/brief, POST /people/{id}/demographics, POST /texts/send
└── tests/                    owners' tests
data/sample_inputs/           helper: + client intake forms (self-reported demographics), event sign-in sheet
web/.../providers/local/      80: hooks for the classes, brief and demographics
(Christian)                   screens: People tabs, tag chip, brief builder, demographics panel
```

### Flow
```
 [Upload messy files] --> Carlos's ingest --> people(contact_type) + gifts + intake text
                                               |
              +--------------------------------+-------------------------------+
              v                                v                               v
        donor                             beneficiary                       contact
          |                                    |                               |
   score + enrich (orgs)              demographics_agent                 one-click retag
          |                         (self-reported only)                       |
   [staff selects facts]                       |                               v
          v                                    v                     becomes donor/beneficiary
     brief_agent --> call script        funder-ready counts
          |                                    |
          +-----> outreach_agent (email/SMS per class; orgs/star need approval) ---> text_log
```

### UI wireframe (Christian designs; this sets the content)
```
+-----------------------------------------------------------------+
| People   [ Donors 33 ] [ People we help 12 ] [ Met 9 ]   [Upload] |
+-----------------------------------------------------------------+
| Name              Class v        Last touch   Next step           |
| Maria Delgado     [Donor v]      Nov 20 '25   Call (score 89)   > |
| Jean-Paul Ade     [We help v]    Oct 30       Check-in text     > |
| Ana Ruiz          [Met v]        Nov 1        Tag ->            > |
+-----------------------------------------------------------------+
 Donor drawer:   WHY | RESEARCH [x fact] [x fact] [ fact] [Build brief] -> CALL SCRIPT
 We-help drawer: DEMOGRAPHICS (self-reported; source line per field) | CHECK-IN TEXT
```

| UI piece | BEFORE | AFTER |
|---|---|---|
| People list | donors only | three tabs with counts |
| Class control | none | one-click tag chip per row |
| Donor drawer | why / research / draft | + fact checkboxes + "Build brief" -> call script |
| Beneficiary drawer | none | self-reported demographics with source lines + check-in text |

### Guardrails (lead recommendation, Sharif to confirm)
- **Demographics are never inferred or searched online.** Only what the person self-reported in the
  nonprofit's own intake records is extracted, with the source line shown for every field. A field that
  isn't stated stays "not stated". No guessing gender from a name, age from a photo, or race from anything.
  These are often vulnerable people; inference is inaccurate and biased, and funders (and the Foundation's
  equity lens) expect self-reported data.
- **Donor research stays organizations-only for the demo**, since fictional individuals have nothing public.
  Researching real individuals would need an identity match plus human review (post-demo).
- **Beneficiary texts never ask for money.**

### Derisking (in dependency order)
| # | What it proves | Command | Expected | If it fails |
|---|---|---|---|---|
| 1 | Contract agreed: contact_type + demographics fields | Carlos + Sharif sign-off in §13 | §13 updated | hold ingest changes |
| 2 | Sample files carry all 3 classes + self-reported demographics | `python scripts/make_sample_inputs.py` | answer key lists counts per class | fix the generator |
| 3 | Ingest tags classes | ingest on sample_inputs, compare with the answer key | at least 95% class match | Carlos adjusts the prompt |
| 4 | Demographics are extracted, not inferred | `pytest service/tests/test_demographics.py` | every value has a source line; 0 values absent from source | tighten the extractor |
| 5 | Brief uses only selected facts | `pytest service/tests/test_brief.py` | 100% of cited facts within the selection | fix the prompt + check |
| 6 | End to end on the demo laptop | upload, tabs, retag, brief, text draft | all steps on screen, 0 console errors | walk back to the failing step |

### Evaluation criteria
| Criterion | Metric + threshold | How measured | Evidence |
|---|---|---|---|
| Uploaded people land in the right class | at least 95% match with answer_key class counts | QA script vs answer_key.json | report row |
| Retagging works | 1 click; persists after reload | Playwright + DB row | screenshot + SQL |
| Brief cites only chosen facts | 100% of script facts within the selection | test + 3 live runs | pytest line |
| Demographics never inferred | 0 values without a source line; at least 95% match with answer key | QA script | report row |
| Beneficiary texts have no money ask | 0 asks across all beneficiary drafts | regex + review | report row |
| No AI phone calls anywhere | 0 call-placing routes or code | grep + route list | grep output |
| Demo path is clean | 0 console errors, 0 4xx/5xx | Playwright on prod snapshot | log |

---

## Appendix: separate `stat-mcp` prototype

The repository also contains `stat-mcp/`, a separate FastMCP prototype with transaction-first import readers for CSV, JSON, XLSX, DOCX, Markdown, and text. It preserves individual source gift events and derives person summaries, but its MCP datasets remain in process memory and it is not wired into the primary FastAPI/SQLite service or web UI. The primary app does not currently mount `/ingest`. When that adapter is implemented, it should call the Python reader library directly and map valid gift events to `gifts`, person projections to `donors`, and `contact_type` to the agreed person class. Do not treat its rubric score as the live app's deterministic gift-history score. See `stat-mcp/README.md`, `stat-mcp/AGENT_INTEGRATION.md`, `stat-mcp/REQUIRED_FIELDS.md`, and `stat-mcp/TOOLS.md`.

---

## 17. Three CRMs in one + chat agent + event calendar (Sharif, Sat Nov 7 night). Supersedes §16 where they differ

**What stays:** everything built so far (scoring, research, outreach, context, prospects, local SQLite,
Vercel snapshot, the chat panel). **No iPhone app.** **No AI phone calls** (call scripts only).

### The three tabs
| Tab | Who | Fed by | What the agents do |
|---|---|---|---|
| **Givers** (locked) | gave to us (people + organizations) | uploads | **enrichment agent** (sourced facts), score + "call today", **campaign builder** in chat, donor brief → call script, email/text (approval for orgs/★) |
| **Neighbors** (locked) | met, not yet either | uploads | **email + texting**: welcome / event invite / follow-up drafted from current context; next-step suggestion; move to another tab in one click |
| **Community** (locked) | the people the nonprofit helps | uploads | **slice + analyze** the data the nonprofit collected (demographic breakdowns, counts, trends); email/text about programs + help, **never a donation ask** |

**Names locked (Sharif, Sat Nov 7 night): Givers · Neighbors · Community.**

### Upload (one screen feeds all three)
Drop messy files (.xlsx, .docx, .md, .csv) → **pick the tab** (Givers / Neighbors / Community) **or "Let the agent
sort them"** (default). Sorting: a gift → Givers, an intake or service record → Community, otherwise → Neighbors;
anyone unclear or a cross-file duplicate is flagged for one-click review, never guessed. Carlos's import agent does
the reading (adapter pending his OK); the tab choice or agent sort sets `contact_type`.

### Event calendar (new)
- The context agent keeps an **events list** current: title, date/time, place, audience, source URL. Sources are the
  website + news (live via hosted search) and **social posts when reachable** (publicly indexed posts via search now,
  official X / Instagram / LinkedIn APIs once tokens exist). A source that can't be read is labeled, never faked.
- **The agent acts ahead of time:** for each upcoming event it picks the audience across the three tabs (donor event →
  Givers, lapsing/★ first; "puppy outreach" → people in any tab tagged with dogs) and **pre-drafts the invites**, so
  staff open the calendar to "41 drafts ready → review".
- Stretch: a **daily plan** ("3 meetings today; follow up with these 4; Give Miami Day in 11 days").
- Demo events are real and on the Foundation's site: early giving opens **Sat Nov 14**, Give Miami 5K **Sun Nov 15**,
  **Give Miami Day Thu Nov 19**.

### Chat agent (right side, every screen)
Knows which tab or calendar you're on; uses tools visibly (find people, segment, get context and events, draft email,
draft SMS, analyze, build brief); **asks before anything is sent**. Per tab: Givers = campaign builder;
Community = analyst + outreach; Neighbors = follow-ups; Calendar = event outreach.

### Texting
Provider under evaluation: **Linq** or **Twilio**, behind one `send_sms()` adapter so the choice can change late.
Demo texts go only to team members' phones (with consent); the fictional records have fake numbers.

### Guardrails
- Individual-giver research: **parked** (Sharif to decide on human review later). Demo research stays organizations-only.
- Community data: analysis uses only what the nonprofit recorded; nothing inferred, nothing searched online.
- No donation asks to the Community; approval required for orgs/★; every fact and event has a source.

### File tree (only what changes)
```
service/
├── db.py                  8b: contact_type, events table, text_log, interest tags
├── routes_data.py         8b: GET /people?type=, PATCH /people/{id}, GET /events
├── ingest_adapter.py      NEW (pending Carlos's OK): files → text → stat_mcp extraction → people/gifts + contact_type
├── events_agent.py        NEW (86): context → events list (dated, sourced); audience suggestion
├── outreach_agent.py      86: invites per event + per tab; SMS drafts
├── chat_agent.py          NEW (90): Agents SDK agent with the tools above, approval-gated sends
├── sms.py                 NEW (90): send_sms() adapter (Linq | Twilio)
└── main.py                90: /chat, /events/{id}/drafts, /send (approval-gated)
data/sample_inputs/        helper: + intake forms (with "has a dog"), event sign-in sheet; answer key per tab
web/.../providers/local/   80: hooks for tabs, upload target, events, chat
(Christian)                tabs, upload screen, calendar, chat panel visuals
```

### Flow
```
 [Upload + tab choice] --> ingest (Carlos) --> people(contact_type) --+--> Givers: enrich + score + campaigns
                                                                     +--> Neighbors: follow-ups
                                                                     +--> Community: analysis + outreach
 [Website + socials] --> context agent --> org_context --> events agent --> events (dated, sourced)
                                                                    |
                         audience across the 3 tabs <---------------+
                                    |
                     outreach agent pre-drafts invites --> [staff approve in calendar or chat] --> email / send_sms --> text_log
```

### Build order (cut from the bottom if the clock wins)
1. Live upload → three tabs (ingest adapter + sorting + tab choice)
2. Calendar v1: events from website/news context + audience + pre-drafted invites
3. Chat agent with tools; email sending first
4. Campaign builder (Givers) · analysis (Community) · texting provider · social events · daily plan

### Evaluation criteria
| Criterion | Threshold | How measured |
|---|---|---|
| Upload with "let the agent sort" puts people in the right tab | at least 95% vs answer key | QA script |
| Upload with a chosen tab files everyone there | 100% | QA script |
| Calendar shows the Foundation's real upcoming events with source links | Nov 14, 15, 19 present; 100% sourced | QA vs miamifoundation.org |
| Each event has an audience + drafts ready | 100% of upcoming events | API check |
| Puppy-type event targets only people tagged with dogs | 0 untagged recipients | QA script |
| Nothing sends without approval; orgs/★ need individual approval | 0 unapproved sends | text_log + email log audit |
| Community texts contain no donation ask | 0 | regex + review |
| Demo path clean | 0 console errors, 0 4xx/5xx | Playwright |


### §17 amendment: one context database + a daily refresh agent (Sharif, Sat Nov 7 night)
**Onboarding step 2 is the backbone**: it fills the calendar, the audiences and every draft. So:

**One context database** (SQLite, `data/donors.db`) holds everything the organization *is* and *is doing*, linked to
its people:
| Table | Holds |
|---|---|
| `org_profile` | name, website, X / Instagram / LinkedIn URLs, priorities, voice, `last_refreshed_at` |
| `org_context` | dated, sourced facts (website, news, social when reachable) |
| `events` (the calendar) | title, starts_at, place, audience rule, source URL, status (upcoming / changed / past) |
| `event_audience` | event ↔ people links across Givers / Neighbors / Community, with the reason |
| `event_drafts` | event ↔ outreach drafts / campaign |
| `context_refresh_log` | each run: when, sources read, facts added / removed, events added / changed / removed, errors |

**Daily refresh agent:** runs every morning (and on "Refresh now"): re-reads the website + news (social when
reachable), updates facts and the calendar, logs what changed, and when an event is **new or changed** it
re-picks the audience and re-drafts the invites (drafts only; sending still needs approval). The UI shows
"Context updated today, 7:00 AM · 2 new events". A failed run never wipes good data (same rule as /context/run).
Locally it's a scheduler inside the service plus a CLI (`python -m service.refresh --daily`) that Windows Task
Scheduler can run.

**Coming soon (not built):** posting to Instagram, LinkedIn and X from the agent. The UI shows it as a disabled
"Coming soon" action.

## 18. Voice-first capture, Google transcription, context database (Sharif, Sat Nov 7 night)

Full mapping, wireframes and audit: `docs/problem-solution-mapping.md`.

- **Home layout (Sharif's sketch):** left = money raised (% of goal, the at-a-glance) over CRM; middle = agent
  interactions with the text box below; right = calendar over to-do. Christian builds it.
- **Voice-first:** a 🎙 button in the agent text box opens a live transcript; staff save it as a note on a person.
  Transcription uses **Google Gemini 3.5 Transcribe**: `gemini-3.5-transcribe-live` (live, 16 kHz PCM over the
  Live API) and `gemini-3.5-transcribe` (recorded files, speaker labels), with the existing `GEMINI_API_KEY`.
  The summary and save step stay on the OpenAI Agents SDK.
- **Phone recording (stretch):** a Twilio call bridged and recorded, then transcribed and saved. Florida needs every
  party's consent, so the call opens with a recording notice; a person makes the call, no AI voice.
- **Context database:** onboarding writes `org_profile`; the context agent fills `org_context` and `events` with
  sourced facts from the website, news and public social posts; agents read it through tools; the daily refresh
  (`REFRESH_DAILY_AT`) keeps it current and logs each run. Missing: the onboarding screen (draft #70) and the
  refresh time set on the demo laptop.
- **Enrichment's main job is interest areas (Sharif).** Clicking **Enrich** on a donor sends the agent to the web
  to (1) tag the donor's interest areas from a fixed tag list (e.g. arts only), each tag with confidence, evidence
  and a source URL, and (2) add any other public contact or professional details. Interest tags are a first-class
  database field used to segment donors and match them to campaigns, events and programs; staff can add or remove
  tags. Today `donors.interests` is a free-form JSON list the agent never fills. Tag list and data model:
  `docs/research/interest-areas.md` (17 tags; Give Miami Day mappings marked ~ still to confirm). No tag is ever inferred from protected traits; untagged beats guessed.

## 19. Finish-line build plan (Sharif, Sat Nov 7 night). No code before Sharif approves this section

Interest tags approved (17, `docs/research/interest-areas.md`). The money card uses option (a): 2026 year to date
plus per-quarter bars, because the current quarter alone is $750 on the sample data. Christian owns every screen;
we ship the backend plus a written UI spec for him.

### Builds (ours unless marked)
| # | Build | Owner | Est. |
|---|---|---|---|
| B1 | **Interest tags:** `interest_tags` + `donor_interests` tables (donor_id INTEGER, matching `donors.id`), seed the 17 tags, the enrich agent returns tags (enum, confidence, evidence, source_url) plus public contact fields, staff add/remove routes, a `find_people(interest=...)` chat filter | builder A | 2 h |
| B2 | **Money by quarter:** `GET /targets/quarters` returns every quarter's sum plus year to date, from the gifts table only (failed charges excluded) | builder B | 45 min |
| B3 | **Voice-first backend:** `WS /transcribe/live` relays 16 kHz PCM to `gemini-3.5-transcribe-live` (the key stays server-side) and streams interim/final text back; `POST /people/{id}/call-notes` stores the transcript plus an OpenAI Agents SDK summary in a new `call_notes` table; `GET /people/{id}/call-notes` | builder C | 2.5 h |
| B4 | **UI spec for Christian:** home 3-column layout, money card + quarter bars, alerts in the to-do list, onboarding (#70), interest chips + filter, 🎙 panel | me → Christian | 30 min |
| B5 | **Ship-out:** demo script, README (models, limits), deploy + Playwright prod walk, repo public + MIT | me + submission-scribe | 2 h |
| S1 | Stretch: Twilio recorded call → `gemini-3.5-transcribe` → same call-notes save | later | 3 h |

### File tree (only what changes)
```
service/
├── db.py                 B1 interest_tags, interest_subtags, donor_interests · B3 call_notes (new tables only; donors untouched)
├── interests.py          NEW B1 seed list (17 tags + sub-tags), add/remove/list, agent-vs-staff merge rule
├── enrich_agent.py       B1 structured output: interests[] (enum) + contact{}; writes donor_interests
├── routes_data.py        B1 GET /interest-tags, GET/POST/DELETE /people/{id}/interests
├── chat_agent.py         B1 find_people(interest=) filter
├── targets.py            B2 quarters(conn, as_of) -> [{label, raised}], ytd
├── routes_targets.py     B2 GET /targets/quarters
├── transcribe.py         NEW B3 Gemini Live relay (+ recorded-file transcribe for S1)
├── call_notes.py         NEW B3 summary agent (OpenAI Agents SDK) + store/list
├── main.py               B3 mount WS /transcribe/live and /people/{id}/call-notes
├── requirements.txt      B3 + google-genai
└── tests/                test_interests.py, test_targets_quarters.py, test_call_notes.py
scripts/                  smoke-gemini-live.py, smoke-transcribe-ws.py (B3)
docs/ui-spec-finish.md    NEW B4 screens for Christian (wireframes from docs/problem-solution-mapping.md §3)
README.md, docs/demo-script.md   B5
```

### Flow
```
[Enrich click] --> enrich_agent --(web search)--> {interests[], contact{}} --> donor_interests --> chips / find_people(interest)
                                                                                  ^ staff add/remove (never overwritten)
[Upload] --> ingest --> gifts --> targets.quarters --> GET /targets/quarters --> money card (YTD + bars)

[🎙 click] --> browser PCM 16 kHz --WS--> /transcribe/live --> gemini-3.5-transcribe-live
                    ^ interim/final text <------------------------------+
          [Save to person] --> POST /call-notes --> OpenAI summary agent --> call_notes --> profile timeline
```

### UI wireframes
Screens: `docs/problem-solution-mapping.md` §3 (home 3.2, voice panel 3.3, profile 3.4). Additions:
```
Money card (home, upper left)            Profile interest chips
+------------------------------+         +------------------------------------------------+
| MONEY RAISED · 2026 YTD      |         | Interests  [Arts & Culture x] [Education x]    |
| $49,615 of sample goal       |         |            [Animals · suggested x]  [+ Add]    |
| ▁  ▁  ▆  ▁   Q1 Q2 Q3 Q4     |         | hover a chip -> "Board seat, <org> · source"   |
| ⚠ 2 failed   ⏱ 3 late        |         +------------------------------------------------+
+------------------------------+         Givers list: [Interest: Arts v] filter
```
| UI piece | Before | After |
|---|---|---|
| Money card | current quarter vs sample goal | 2026 YTD + quarter bars + alert counts |
| Interests | free-text, never filled | chips with a source tooltip; low confidence shows "suggested"; staff x / + Add |
| Givers filter | status, tier | + interest |
| Call notes | none (FakeRest notes vanish on reload) | timeline entries from `call_notes`, persisted |

### Derisking (dependency order)
| # | Proves | Command | Expected | If it fails |
|---|---|---|---|---|
| 1 | Gemini key reaches the live model | `python scripts/smoke-gemini-live.py <20s wav>` | final text contains the scripted words | check key tier and model ID in AI Studio; fall back to `gemini-3.5-transcribe` per chunk |
| 2 | New tables create on an existing DB without touching `donors` | `pytest service/tests/test_interests.py -k schema` | pass; `donors` columns unchanged | make the migration CREATE IF NOT EXISTS only |
| 3 | Quarter sums match the answer key | `pytest service/tests/test_targets_quarters.py` | 15 quarters, total 1269470, 2026 YTD 49615 | fix date parsing or failed-charge exclusion |
| 4 | Enrich returns only enum tags with sources | `pytest service/tests/test_interests.py -k enrich` (mocked model) + 3 live orgs | 100% of tags in the enum, 100% with source_url | tighten the output schema |
| 5 | Staff edits survive re-enrich | `pytest service/tests/test_interests.py -k staff_wins` | removed tag not re-added | fix the upsert rule |
| 6 | Live relay streams text | `python scripts/smoke-transcribe-ws.py <20s wav>` | at least 1 interim + 1 final event | fix PCM framing (100 ms, 16 kHz mono LE) |
| 7 | Call note persists with summary | `pytest service/tests/test_call_notes.py`, then curl POST, restart, GET | note returned after restart | fix table or route |
| 8 | End to end on the demo laptop | upload sample → Enrich an org → speak 20 s → save → reload | tags with sources, YTD $49,615, note on profile, 0 console errors | walk back to the failing smoke |

### Evaluation criteria (graded by an independent evaluator agent, not the builders)
| Criterion | Threshold | How measured |
|---|---|---|
| Enrich tags interest areas with evidence | at least 2 of 3 sample orgs get 1+ tag; 100% of tags carry source_url + evidence; 0 tags outside the 17 | API run + SQL on donor_interests |
| No guessed tags | 0 tags for a made-up person (ambiguous / not_found) | API run |
| Staff wins | a staff-removed tag is absent after re-enrich | pytest + SQL |
| Money by quarter is exact | total $1,269,470; 2026 YTD $49,615; each quarter equals the answer key | pytest vs answer_key.json |
| Live transcript | first interim text within 2 s of speech; final text at least 90% word match on a scripted 20 s read | smoke script + word-error-rate check |
| Call note persists | note + summary on the chosen person after a service restart | curl GET after restart |
| Key never in the browser | 0 occurrences of the Gemini key in built JS or network traffic | grep `web/dist` + Playwright network log |
| Demo path clean | 0 console errors, 0 4xx/5xx | Playwright on the demo laptop and the prod snapshot |

### Order
B1, B2 and B3 run in parallel on disjoint files, except `db.py`, where each adds only its own tables (B1 lands
first, B3 rebases). B4 goes to Christian right after approval. Every PR goes through QA, then a merge pinned to the
approved SHA, a deploy and a Playwright walk. B5 starts Sun 9 AM. Freeze Sun 4:15 PM.

### 19.1 The demo (Sharif, Sat Nov 7 night): a live call that updates tasks, calendar and context

Source: `transcripts/demo.md` (gitignored). Runs live on stage: a real phone call, transcribed as it happens, then
the agent routes what was said into tasks, the calendar and the context.

**Script (fictional donor; no real person's history is invented):**
1. **Before the call:** "Tell me about Bill at Veloria Bay Foundation." The agent answers from the CRM: $1.1M
   lifetime, yearly gift late since Apr 15, interests Health & Wellness / International (polio), last spoke with
   Susan on Oct 12, his wife is Melissa, and Give Miami Day is Thu Nov 19.
2. **The call:** Sharif clicks 🎙 and calls Bill (a teammate's phone, on speaker). The transcript fills in live.
   Bill agrees to renew at $1M and to attend Thursday's event. "Say hi to Melissa."
3. **After the call:** Sharif clicks Save to Bill. The after-call agent shows its tool steps and proposes updates;
   one click applies them:
   - **Tasks:** "Send $1M pledge agreement to Bill" (due Mon), "Confirm Bill's seat for Give Miami Day".
   - **Calendar:** Bill added to Give Miami Day (Thu Nov 19) as attending; the event's guest count goes up.
   - **Context:** pledge $1M recorded (not counted as raised until received); last contact = Sharif, Nov 8;
     relationship note "wife Melissa"; interest tags confirmed from the call.
4. **Proof:** the to-do list, calendar and Bill's profile all show the changes; reload keeps them.

**Fictional cast:** Veloria Bay Foundation (D27, sample data: $1.1M lifetime, yearly gift late) is the donor. "Bill"
is its board chair and "Susan" a staff member, both fictional and added by the demo seed only. The seed also adds
Susan's Oct 12 call note and staff-set interest tags (fictional orgs have nothing on the web, so tags come from the
note, not web research). Live web enrichment is shown on a real organization in its own beat, organizations only.

### 19.2 Builds this adds

| # | Build | Owner | Est. |
|---|---|---|---|
| B3+ | `call_notes` gets `staff_name` and `contact_name`, so "who talked to him last" has an answer | builder C | +15 min |
| B6 | **After-call agent** (OpenAI Agents SDK): reads a saved transcript and proposes typed actions: `create_task`, `rsvp_event`, `record_pledge`, `add_context_note`, `tag_interest`. Every action is shown as a tool step; **Apply all** (or per item) writes them. Needs a persisted `tasks` table (today's tasks are in-browser FakeRest), `event_audience.rsvp` (invited / attending / declined), a `pledges` table (not counted in raised), and `person_context` notes | builder D | 2.5 h |
| B7 | **Demo seed:** `scripts/seed_demo.py` adds Bill, Susan, the Oct 12 note and staff tags on top of the sample upload; idempotent; `--reset` restores the pre-demo state between rehearsals | builder D | 30 min |
| B8 | **Live hosting:** the live demo runs the service on the laptop. The public Vercel URL stays the read-only snapshot. If the call must run from the public URL, a tunnel (cloudflared) exposes the laptop API, behind the same send allowlist | me | 30 min (only if needed) |

Tree additions:
```
service/
├── after_call_agent.py   NEW B6 transcript -> proposed actions (typed), apply(actions)
├── db.py                 B6 tasks, pledges, person_context tables; event_audience.rsvp column (ALTER ... ADD COLUMN)
├── main.py               B6 POST /call-notes/{id}/actions (propose), POST /call-notes/{id}/apply; GET /tasks
scripts/seed_demo.py      NEW B7
docs/demo-script.md       B5 the script above, word for word, with the reset steps
```

Flow addition:
```
[Save to Bill] --> call_notes --> after_call_agent --> proposed actions (tool steps on screen)
                                        |  [Apply all]
            +---------------+-----------+-----------+-----------------+
            v               v                       v                 v
         tasks         event_audience(rsvp)      pledges        person_context + donor_interests
            |               |                       |                 |
       to-do list     calendar guest list     profile pledge     profile + chat agent's next answer
```

Wireframe: after-call review card (in the agent column):
```
+--------------------------------------------------------------+
| Call with Bill · 4:12 · saved to Veloria Bay Foundation       |
| ✓ read_transcript   ✓ find_event("Thursday") -> Give Miami Day|
| Proposed updates                                              |
| [x] Task: Send $1M pledge agreement to Bill (due Mon Nov 9)   |
| [x] Task: Confirm Bill's seat, Give Miami Day                 |
| [x] Calendar: Bill attending Give Miami Day (Thu Nov 19)      |
| [x] Pledge: $1,000,000 (not counted as raised until received) |
| [x] Context: wife Melissa; last contact Sharif, Nov 8         |
|                                   [Apply selected] [Discard]  |
+--------------------------------------------------------------+
```

Derisking additions (after smoke 7):
| # | Proves | Command | Expected | If it fails |
|---|---|---|---|---|
| 7a | The agent extracts the right actions from the demo transcript | `pytest service/tests/test_after_call.py` on a recorded demo transcript (3 live runs) | exactly: 2 tasks, 1 RSVP to Give Miami Day, 1 pledge $1,000,000, 1 context note with "Melissa" | tighten the action schema and prompt |
| 7b | Apply writes all four places and survives reload | curl apply, restart, GET /tasks, /events/{id}, /people/{id} | all four present after restart | fix the failing write |
| 7c | Reset makes rehearsals repeatable | `python scripts/seed_demo.py --reset` twice, then the walk | same counts every time | fix idempotency |

Evaluation additions:
| Criterion | Threshold | How measured |
|---|---|---|
| The call is routed correctly | 3/3 live runs on the demo transcript produce the expected 5 actions, 0 extra | pytest + live runs |
| Nothing is written without a click | 0 rows in tasks / pledges / event_audience before Apply | SQL before and after |
| Live stage run | full script (research → call → apply → proof) under 4 min, 0 console errors | timed rehearsal + Playwright log |
| Pledges don't inflate money raised | raised unchanged after the $1M pledge | GET /targets/quarters before and after |

## 20. Execution plan: audit → builds → owners → integration (Sat Nov 7 night). For Sharif's review; no code until approved

Supersedes the order in §19. §19 / §19.1 / §19.2 keep the detail (tree, smokes, criteria) per build.

### 20.1 Audit: every problem and demo beat → build → owner

| Need | Source | Build | Status today | Owner |
|---|---|---|---|---|
| Event-loop crash on every other model call | bug | #73 | PR open, waiting on QA | 98 → lead merges |
| P1 loss of context: record calls | Erica, demo beat 2 | **B3** voice backend + **B3+** who-talked-to-whom | not built | **Agent Phone** |
| P1: "who did he talk to last" | demo beat 1 | B3+ (`call_notes.staff_name`, `contact_name`) + chat tool | not built | Agent Phone + 90 |
| P2 interest areas | Sharif, demo beat 1 | **B1** interest tags + enrich output | free-text field, never filled | **42** |
| P2 / C2 late + failed gifts on screen | Erica, challenge #2 | alerts card + to-do (backend done, #48) | no screen | Christian (spec B4) |
| Money raised by quarter | Sharif | **B2** `/targets/quarters` | current quarter only | **48** |
| After the call: tasks, calendar, context | demo beat 3 | **B6** after-call agent + tasks / pledges / RSVP tables | not built | **86** |
| Rehearsable demo story | demo | **B7** seed (Bill, Susan, Oct 12 note) + `--reset` | not built | **8b** |
| Web data layer for all new endpoints | integration | **B9** hooks + types in `providers/local/` | not built | **80** |
| Chat agent knows the new data | demo beat 1, 3 | **B10** chat tools: `find_people(interest=)`, `get_call_notes`, `get_tasks`, after-call steps in the thread | not built | **90** |
| Screens: home sketch, money card, alerts, onboarding, chips, 🎙 panel, after-call card | sketch, wireframes | **B4** spec → Christian builds | spec not written | lead → Christian |
| P4 context: onboarding screen | Erica | adopt #70 | draft | Christian |
| P4 context: daily refresh on | Erica | set `REFRESH_DAILY_AT` + "last refreshed" | off | lead |
| Calendar leftovers | 5E | close #49 / #57 | drafts | 86 + 98 |
| Sidebar panel | 5D | #69 | PR open | 98 → lead merges |
| Persona | #76 | Sharif decides Tidepath vs Miami Foundation | open | Sharif |
| Ship-out | rules | **B5** demo script, README, deploy + prod walk, repo public MIT | not started | lead + submission-scribe |
| Independent grading | Sharif rule | evaluator subagent grades §19 criteria | — | new subagent (not a builder) |
| Stretch: phone call via Twilio | Sharif | S1 | — | Agent Phone, only after B3 passes |
| P5 impact by zip, P7 payout hold | Erica | stretch / named limit in README | — | B5 |

### 20.2 The integration contract (frozen before anyone codes; builders code to it, 80 and Christian mock it)

| Endpoint | Request | Response | Built by |
|---|---|---|---|
| `GET /interest-tags` | — | `[{slug, label, definition}]` (17) | 42 |
| `GET /people/{id}/interests` | — | `[{tag, sub_tag, confidence, evidence, source_url, set_by}]` | 42 |
| `POST /people/{id}/interests` | `{tag, sub_tag?}` | the row (set_by staff) | 42 |
| `DELETE /people/{id}/interests/{tag}` | — | `{removed: true}` (row kept, status removed) | 42 |
| `POST /enrich/{id}` | — | existing body + `interests[]` + `contact{}` | 42 |
| `GET /targets/quarters?as_of=` | — | `{quarters: [{label: "2026-Q3", start, end, raised}], ytd: {year: 2026, raised}}` | 48 |
| `WS /transcribe/live` | binary PCM16 LE 16 kHz mono, ~100 ms frames; text `{"type":"end"}` | `{"type":"interim"\|"final","text"}`; `{"type":"error","detail"}` | Agent Phone |
| `POST /people/{id}/call-notes` | `{transcript, staff_name, contact_name, duration_s}` | `{id, summary, created_at}` | Agent Phone |
| `GET /people/{id}/call-notes` | — | `[{id, staff_name, contact_name, summary, transcript, created_at}]` | Agent Phone |
| `POST /call-notes/{id}/actions` | — | `{steps: [...], actions: [{id, type, label, payload}]}`; types `create_task`, `rsvp_event`, `record_pledge`, `add_context_note`, `tag_interest` | 86 |
| `POST /call-notes/{id}/apply` | `{action_ids: [...]}` | `{applied: [{id, type, ref}]}` | 86 |
| `GET /tasks?person_id=` / `PATCH /tasks/{id}` | `{done}` | `[{id, person_id, title, due, done, source}]` | 86 |
| `GET /events/{id}` | — | existing + `audience[].rsvp` (invited / attending / declined) | 86 |
| `GET /people/{id}/pledges` | — | `[{amount, expected_by, status}]` (never in `raised`) | 86 |

Conflict rules:
- **New routers, not `main.py` bodies:** `routes_interests.py` (42), `routes_voice.py` (Agent Phone),
  `routes_after_call.py` (86). Each adds one `include_router` line to `main.py`.
- **`db.py`:** each builder adds only its own `CREATE TABLE IF NOT EXISTS` block (and 86 one `ADD COLUMN` guarded by a
  column check). Landing order is 42 → Agent Phone → 86; later PRs rebase.
- `donors` and `service/ingest/` are untouched (🔒 Carlos).

### 20.3 Owners and dispatch

| Session | Build | Owns (files) | Depends on |
|---|---|---|---|
| **42** | B1 interest tags | `service/interests.py`, `routes_interests.py`, `enrich_agent.py`, tests | — |
| **48** | B2 money by quarter | `service/targets.py`, `routes_targets.py`, tests | — |
| **Agent Phone** | B3 + B3+ voice backend, then S1 | `service/transcribe.py`, `call_notes.py`, `routes_voice.py`, `scripts/smoke-*.py`, `requirements.txt` (+google-genai) | Gemini key (smoke 1) |
| **86** | B6 after-call agent | `service/after_call_agent.py`, `routes_after_call.py`, tests; also closes #49/#57 | B3 table shape (contract) |
| **8b** | B7 demo seed | `scripts/seed_demo.py` | B1, B3, B6 tables |
| **80** | B9 web hooks + types (mock until each endpoint lands) | `web/.../providers/local/*` | contract only |
| **90** | B10 chat tools | `service/chat_agent.py` | B1, B3, B6 |
| **Christian** | screens from B4 spec | his UI files | B9 hooks |
| **98 (QA)** | reviews every PR against its §19 smokes; lead merges pinned to the approved SHA | — | — |
| **lead (this session)** | contract, B4 spec, B5, merges, deploys, Playwright walks, ROADMAP flips | docs, ROADMAP | — |
| **evaluator subagent** | grades §19 / §19.2 criteria after the merges; loops until all PASS | read-only | all merged |

Each dispatch uses the five fields from CLAUDE.md (CONTEXT / OWNS / TASK / DONE WHEN / RETURN), points at this
contract, and requires: a branch via `git worktree add --no-track`, a check that `@{upstream}` is not main, a PR to QA,
no direct push to main.

### 20.4 Timeline (freeze Sun 4:15 PM)

| When | What |
|---|---|
| Sat night, wave 1 (parallel) | 42 B1 · 48 B2 · Agent Phone B3 · 80 B9 (mocks) · lead B4 spec to Christian · 98 clears #73 and #69 |
| Sat late, wave 2 | 86 B6 (after B3's table lands) · 90 B10 · 8b B7 |
| Sun 9 AM | merges + deploy + prod walk; evaluator round 1; fixes |
| Sun 11 AM | demo rehearsal x3 with `seed_demo.py --reset`; B5 README + demo script |
| Sun 1 PM | evaluator final scorecard; stretch S1 only if every criterion passes |
| Sun 3:30 PM | tag `demo`; repo public with MIT; freeze 4:15 PM |

### 20.5 Decisions needed from Sharif before dispatch
1. Approve this plan (§19, §19.1, §19.2, §20).
2. Demo donor: Veloria Bay Foundation with a fictional "Bill", or another name.
3. Live demo from the laptop (recommended), or a tunnel to the public URL.
4. Money card: 2026 year to date + quarter bars (recommended), or % of a sample goal.
5. #76 persona: Tidepath or The Miami Foundation.

### 20.6 Integration target: Christian's mockup (Sat Nov 7 night)

Christian is building the screens in `docs/design/mockup/` now. Every element is mapped to its hook, endpoint and
owner in `docs/ui-integration.md`; builders code to that map plus §20.2. Builds it adds:

| # | Build | Owner | Wave |
|---|---|---|---|
| B1 (changed) | Enrich becomes propose → **Save to profile** (`?dry_run=1` + `/enrichment/accept`) | 42 | 1 |
| B2 (changed) | `/targets` adds `reached_today` | 48 | 1 |
| B3 (changed) | end-of-call pass on the recorded audio with `gemini-3.5-transcribe` for speaker names; note `title` + `folder` | Agent Phone | 1 |
| **B13** | `GET /home/summary` (glance counts, next event, suggestion chips) + `GET /people/attention` (CRM list badges) | 48 | 1 |
| **B11** | task generator: alerts → calls, duplicates → review, new donors → welcome, events → prep; runs after upload and daily refresh | 86 | 2 |
| **B12** | `GET /artifacts` (call notes, drafts, reports) + `GET /calendar` (events merged with dated tasks, "added by agent") | 86 | 2 |
| B9 (grows) | hooks for every endpoint in `docs/ui-integration.md` §2, mocked until each lands | 80 | 1 |
| B10 (grows) | chat tools `create_task`, `add_calendar_item` so "add thank-you calls Tuesday" writes the calendar | 90 | 2 |

Open decisions: Q4 gauge on sample data reads 0.5% (seed fictional Q4 demo gifts, or a smaller sample goal);
hide the "Show meeting notes" overlay for judging.

### 20.7 Who takes what: live Claude Code sessions (supersedes the owner columns in §20.3 / §20.6)

Assigned by what each session already built, so nobody starts cold. Tasks move to wave 1 because half the
mockup sits on them.

| Session | Already knows | Takes | Owns (files) | Wave | Depends on |
|---|---|---|---|---|---|
| **devday-hackathon-42** | demographics extraction agent (structured output from text) | **B1** interest tags: 17-tag seed, enrich propose (`?dry_run=1`) → `/enrichment/accept`, staff-wins rule | `service/interests.py`, `routes_interests.py`, `enrich_agent.py`, `tests/test_interests.py` | 1 | — |
| **devday-hackathon-48** | gift alerts (#48), gifts and targets | **B2** `/targets/quarters` + `reached_today` · **B13** `/home/summary`, `/people/attention` | `service/targets.py`, `routes_targets.py`, `routes_home.py` (new), tests | 1 | — |
| **devday-hackathon-3a** | data layer (#53), outbox and send path, #69 rebase | **B11** tasks table + `/tasks` + generator · **B12** `/calendar`, `/artifacts` | `service/tasks.py`, `routes_tasks.py`, `tests/test_tasks.py` | **1** | — |
| **Agent Phone** | `/enrich` and donor-route wiring in `main.py`, phone/SMS brief | **B3** voice: `WS /transcribe/live`, `/transcribe/file` (speaker labels), call notes + summary · then **S1** Twilio | `service/transcribe.py`, `call_notes.py`, `routes_voice.py`, `scripts/smoke-*.py`, `requirements.txt` | 1 | Gemini key |
| **devday-hackathon-80** | web data layer hooks (`providers/local/`) | **B9** hooks + types for every endpoint in ui-integration §2, mocked until each lands | `web/src/components/atomic-crm/providers/local/*` | 1 | contract |
| **devday-hackathon-86** | outreach, events, event audiences, context, briefs | **B6** after-call agent (`/call-notes/{id}/actions`, `/apply`), pledges, `event_audience.rsvp` · close #49/#57 | `service/after_call_agent.py`, `routes_after_call.py`, tests | 2 | B3 call_notes, B11 tasks |
| **devday-hackathon-90 [113a1a]** | chat agent (#58), `/chat`, `/send` | **B10** chat tools: `create_task`, `add_calendar_item`, `find_people(interest=)`, `get_call_notes`, `get_tasks`, after-call steps in the thread | `service/chat_agent.py` | 2 | B1, B3, B11 |
| **devday-hackathon-8b** | `db.py`, `routes_data.py`, contact_type | **B7** demo seed (Bill, Susan, Oct 12 note, `staff_name`, Q4 demo gifts if Sharif picks that) + `--reset` | `scripts/seed_demo.py`, `org_profile.staff_name` | 2 | B1, B3, B6, B11 |
| **devday-hackathon-98** | QA gate all day | reviews every PR with one parallel subagent per PR against §19 smokes, §20.2, ui-integration §2; posts APPROVE <sha> | — | all | — |
| **devday-hackathon-c9** | stat-mcp fixes, written REJECT/APPROVE reviews; built none of these builds | **independent evaluator**: grades §19 / §19.2 criteria after merges, loops until every one passes; overflow QA if 98 queues | read-only | Sun | merges |
| **devday-hackathon-12** | role to confirm on dispatch | **deploy monitor**: after each merge, Playwright walk of the demo path on the laptop and the Vercel snapshot (the "Vercel monitor agent") | `scripts/verify-e2e.py` cases | 1+ | merges |
| **devday-hackathon-37** | role to confirm on dispatch | **B5 writer**: README (models, how to run, limits), `docs/demo-script.md` draft from §19.1 | `README.md`, `docs/demo-script.md` | Sun AM | — |
| **lead (Ideas, this session)** | plan, contract, merges | contract upkeep, B4 to Christian, merges pinned to approved SHAs, deploys, ROADMAP flips, rehearsals | docs, ROADMAP | all | — |
| **Christian** (human + his agent) | the UI | screens from `docs/ui-integration.md`, on B9 hooks | his UI files | 1–2 | B9 |
| **Carlos** (human) | ingest 🔒 | no change; on call if an upload fails | `service/ingest/` | — | — |
| **devday-hackathon-90 [58e3c2]** | older session, idle 7 h | reserve; not dispatched | — | — | — |

**`db.py` landing order (new tables only):** 3a (tasks) → 42 (interest tables) → Agent Phone (call_notes) → 86
(pledges, rsvp column) → 8b (staff_name). Each rebases on the one before; each adds one `include_router` line.

**Critical path:** 3a tasks + Agent Phone call notes (wave 1) → 86 after-call (wave 2) → 8b seed → rehearsal.
If the clock wins, cut in this order: S1 phone, B12 artifacts, B13 badges; never cut B3, B6, B11.

**Dispatch:** one message per session, sent together, each with the five CLAUDE.md fields (CONTEXT / OWNS / TASK /
DONE WHEN / RETURN), a pointer to §20.2 + ui-integration §2, and the git rules: `git worktree add --no-track`,
check that `@{upstream}` is not main, PR to QA, never push to main.

### 20.8 Voice-first chat input: dictate the question (Sharif, Sat Nov 7 night)

The 🎙 in the agent chat box (mockup item 11, and the mic in the Ask sidebar) is **dictation**: press, speak, the words
fill the text box live through `gemini-3.5-transcribe-live`, release (or press again) to stop; staff edit or send.
It is separate from **Call and transcribe** on the task card, which records a whole call and saves a note.

| Piece | Build | Owner | Wave |
|---|---|---|---|
| Backend | reuses B3's `WS /transcribe/live`, with `mode=SMART` (drops filler words) and a `purpose=dictation` flag so nothing is stored | Agent Phone (B3) | 1 |
| Hook | `useDictation()` → `{start, stop, interim, final, error}`; shared by the center chat and the Ask sidebar | 80 (B9) | 1 |
| Button | mic in the chat box: idle / listening (pulsing, interim text greyed) / error; Esc cancels | Christian | 1 |

```
Chat box, listening
+------------------------------------------------------------------+
| [+]  Who gave this quarter and hasn't been tha|   [● 🎙]  [➜]    |
|      ^ live words appear as Denise speaks       ^ press to stop  |
+------------------------------------------------------------------+
```
Criterion: first words in the box within 2 s of speech; at least 90% word match on a scripted question; nothing written
to the database. Smoke: the B3 relay smoke with `purpose=dictation` returns final text and 0 new rows.

### 20.9 The in-app agent: one agent, every database (Sharif, Sat Nov 7 night)

The agent in the UI (center chat and Ask sidebar) reads and writes the CRM, calendar, tasks and call notes through
tools; writes that change records go through an approval card. Tools (B10, 90): `find_people`, `get_person`,
`get_alerts`, `get_events`, `get_calendar`, `add_calendar_item`, `get_tasks`, `create_task`, `complete_task`,
`get_call_notes`, `get_context`, `draft_email`, `draft_sms`, `enrich` (propose only).

**Framework decision (open):** Sharif is considering LangChain. Lead recommendation: keep the OpenAI Agents SDK for
the agent, because (1) the event's acceptance criteria name the OpenAI Agents SDK and judges score its visible use,
(2) `/chat` with tool steps and approval-gated sends already runs on it (#58), and (3) a framework switch at T-18 h
re-opens working code. LangChain/LangGraph is used only if the chat-UI research (`docs/research/repos-to-lift.md`)
shows a decisively faster path. The chat UI package is chosen from that research the same way.

### 20.10 Everything runs through the agent in the main UI (Sharif, Sat Nov 7 night). Non-negotiable

The center agent is the primary way to change data: anything a staff member can do on a screen, they can ask the
agent to do, and the screen updates live. Write tools (B10, 90), on top of §20.9's reads:

| Area | Write tools |
|---|---|
| CRM | `update_person` (contact fields, tab Givers/Neighbors/Community, notes), `add_interest` / `remove_interest`, `accept_enrichment`, `log_gift` (manual), `merge_duplicate` / `dismiss_duplicate` |
| Calendar | `add_calendar_item`, `move_calendar_item`, `delete_calendar_item`, `rsvp_event` |
| Tasks | `create_task`, `update_task` (title, due, time, person), `complete_task`, `delete_task` |
| Calls | `save_call_note`, `apply_after_call_actions` |
| Outreach | `draft_email`, `draft_sms`, `send` (approval card, as today) |

Rules:
- Edits apply at once and show as tool steps with **Undo** (each write returns an undo token; `undo(token)` reverts it).
- Sends, merges and deletes show an **approval card** first; nothing leaves the building without a click.
- Every write goes through the same service functions the screens use, so the agent and the buttons can never
  disagree; after a write the UI refetches (task list, calendar, CRM list, gauge) so the change is visible.
- Every agent write is logged (`agent_actions`: tool, args, result, undo token, time).

Criterion: for each write tool, one chat request changes the row (SQL check) and the matching panel shows it
without a reload (Playwright); Undo restores the row; 0 sends, merges or deletes without an approval click.

### 20.11 Code to lift (from `docs/research/repos-to-lift.md`; copy first, adapt minimally)

| Need | Lift | License | Goes to |
|---|---|---|---|
| Chat UI, tool steps, approval cards | assistant-ui (already in #69): `makeAssistantToolUI` + `addResult`; prompt-kit for suggestion chips | MIT | Christian + 80 |
| Agent ↔ UI stream | `assistant-stream` (Python) emitting assistant-ui's data-stream from FastAPI; ~100-line Agents SDK event mapper + approve/discard resume route | MIT | 90 |
| Approval before writes | `openai-agents-python/examples/agent_patterns/human_in_the_loop_server.py`, `human_in_the_loop_stream.py`; after-call extraction with `output_type=<Pydantic model>` | MIT | 90, 86 |
| Mic capture (dictation + call) | `google-gemini/live-api-web-console`: `src/lib/audio-recorder.ts`, `src/lib/worklets/audio-processing.ts`, `src/lib/audioworklet-registry.ts`, wrapped as an assistant-ui `DictationAdapter` (template: assistant-ui `examples/with-elevenlabs-scribe`) | Apache-2.0 (keep headers + NOTICE) | 80 |
| FastAPI relay to Gemini Live | ~60 lines written by us (two asyncio loops around `client.aio.live.connect`) | — | Agent Phone |
| Mini calendar, tasks | shadcn `calendar` (react-day-picker) with an event-dot day button; originui snippets | MIT | Christian |
| Find-a-donor pop-up, goal gauge | shadcn `command` (cmdk); shadcn radial `chart` (Recharts) | MIT | Christian |
| Twilio stretch | `twilio-python`, `record=True` + `recording_status_callback` (~40 lines) | MIT | Agent Phone |

Framework: **OpenAI Agents SDK + assistant-ui** (no LangGraph server, no rewrite). LangGraph's UI paths need a
LangGraph Platform-style server or Next.js; CopilotKit does not list the Agents SDK as a backend. Do not use:
agent-chat-ui, vercel/ai-elements (deprecated end of Nov 2026), the ChatKit widget, `gemilive` as a dependency,
browser-direct Gemini with a long-lived key.

### 20.12 Decisions (Sharif, Sat Nov 7 night) and dispatch
- **Plan NOT yet approved.** Wave 1 briefs went out by mistake and were recalled with a HOLD; no build starts until Sharif approves.
- **Demo call:** Sharif owns the call script and cast. B7 (demo seed) is on hold until he hands it over; B6 (after-call
  agent) is still built.
- **Demo runs on the laptop** (local service). The public Vercel URL stays the read-only snapshot; no tunnel.
- **Example organization: The Miami Foundation.** #76 (Tidepath persona switch) is not merged. Data stays fictional
  and is labeled sample wherever figures appear.
- **Integration with Christian's UI:** Sharif drives it. Christian messages the team when the first UI draft is
  ready; then build → integrate → test runs on one loop (shipping flywheel). The lead does not send Christian docs.
- Still open: Q4 gauge on sample data (0.5% of goal).

### 20.13 First-run flow: upload → org context → agent builds the context dataset → dashboard (Sharif)

```
[1. Upload files] --> ingest (Carlos) --> people + gifts in SQLite
        |
[2. Tell us about your organization: website (required) + X / LinkedIn / Instagram links]
        |
[3. Context agent runs automatically] website + news + public social posts --> org_profile, org_context
        |      (sourced facts), events, event_audience, then task generator (B11) and alerts
        v
[4. Dashboard] gauge, today at a glance, CRM list, task card, calendar, artifacts, agent chat:
   every panel reads the context dataset + people/gifts; the agent answers from the same tables
```
- Step 3 shows live progress (sources being read, facts found), then lands on the dashboard; no button press needed.
- The daily refresh re-runs step 3 and re-generates tasks.
- Build mapping: step 1 exists (ingest adapter); step 2 screen is Christian's (from draft #70); step 3 backend exists
  (`/context/run`, `/context/refresh`, events) and gains a final call to `/tasks/generate` (3a, B11); step 4 is the
  mockup wired per `docs/ui-integration.md`.

### 20.14 Consolidated finish plan

The reviewable, consolidated plan is `docs/finish-plan.md` (empty start from example files, time-ordered context RAG,
campaigns that always cite success stories / use of funds / org health, owners, smokes, criteria). It supersedes the
owner columns above where they differ.

---

## 21. Finish-line plan (APPROVED by Sharif, Sat Nov 7 night). Supersedes §18–§20.14 where they differ


> One plan that merges everything decided on Sat Nov 7: the Erica call, the wireframe session, Sharif's sketch,
> Christian's mockup, the demo, interest tags, voice, the context store, story-first campaigns, the empty start,
> agent-first UI, code to lift, owners and the build loop. On approval it is copied into `plan.md` as §21 (replacing
> the scattered §18–§20.14 owner columns) and `docs/finish-plan.md` points to it. Supporting docs stay as references:
> `docs/problem-solution-mapping.md`, `docs/ui-integration.md`, `docs/research/interest-areas.md`,
> `docs/research/repos-to-lift.md`, `docs/design/mockup/` (all on PR #77, branch `docs/problem-solution-mapping`).

---

### 21.0. Context

**Why this plan exists.** Our entry is a nonprofit CRM, demoed as The Miami Foundation. The backend (FastAPI + SQLite
+ OpenAI Agents SDK) already does most of the work: three tabs (Givers / Neighbors / Community), ingest of messy files,
dedupe 6/6, gift alerts, enrichment of organizations, ICP + prospects, a context agent with a daily refresh, an event
calendar, a chat agent with tool steps and approval-gated sends. What judges would see is behind: the screens don't
match Christian's mockup, tasks live in browser fake data, nothing records calls, interests are never tagged, campaigns
don't reliably use the organization's stories, and the app preloads seeded data. This plan closes those gaps in ~18
hours with the Claude Code sessions already running.

**Intended outcome.** On the laptop, starting from an empty app: drag in the example files, give the organization's
website, watch the context agent build the context store, land on Christian's dashboard, and do everything (CRM,
calendar, tasks, campaigns, calls) through the agent in the main UI.

**Decisions already made (Sharif, Sat Nov 7):**
| Decision | Value |
|---|---|
| Tab names | Givers · Neighbors · Community (locked) |
| Example organization | The Miami Foundation (#76 Tidepath persona not merged) |
| Data | App starts empty; every record comes from dragging in `data/sample_inputs/` (fictional) |
| Where the demo runs | The laptop (local service). Vercel is the read-only snapshot |
| Vercel | Session 12's watcher auto-deploys every commit to `main`; keep it; the lead never deploys separately |
| Demo call script and cast | Sharif owns it (the after-call agent is still built) |
| Integration with Christian's UI | Sharif drives it; Christian messages when the first UI draft is ready |
| Agent framework | OpenAI Agents SDK (event acceptance criteria) + assistant-ui for the chat UI; no LangChain |
| Transcription | Google Gemini 3.5 Transcribe (live + recorded); summaries on the OpenAI Agents SDK |
| Interest tags | The 17 tags in `docs/research/interest-areas.md` (approved) |
| Agent-first | Everything (CRM, calendar, tasks) can be done through the agent in the main UI |
| Out of scope | No iPhone app; no AI voice calls; social posting is "Coming soon" |

---

### 21.1. Problems → solutions (from the Erica call, the wireframe session, challenge #2)

| # | Problem | Solution in this plan | Build |
|---|---|---|---|
| P1 | Loss of context: calls and meetings never reach the record | Voice-first: "Call and transcribe" records a call live, names speakers at the end, saves a note to the person; 🎙 dictation in the chat; one shared record; the agent recalls "who talked to them last" | B3, B6, B10 |
| P2 | Staying on top of donors (interests, consistent outreach) | Enrichment tags interest areas (17, sourced); gift alerts become call tasks; the calendar with pre-drafted invites; the agent edits the calendar | B1, B11, B12, B10 |
| P3 | The people the nonprofit serves, not just donors | Community tab from self-reported intake; Neighbors tab for people met; outreach about programs, never an ask | on main (#60) |
| P4 | Demonstrating impact | Context store (time-ordered RAG) built from the website, news and posts; every campaign cites a success story, use of funds and org health | C1, C2 |
| P5 | Impact data at the source (zip codes) | Community impact view by zip | stretch |
| P6 | Every nonprofit is different | Drag in any messy file; the agent sorts tabs; the context agent learns the mission from the website | on main + D1 |
| P7 | Payment fraud (impersonated bank details) | Named as a limit in the README | B5 |
| C2 | Challenge #2: approve duplicates, keep gift history, catch late gifts | Dedupe 6/6 with approval (#65); gift alerts 5/5 (#48) shown on the dashboard and as tasks | on main + B13, B11 |

---

### 21.2. What we ship

#### 21.2.1 Nothing is preloaded: the app starts empty
- The only data source is `data/sample_inputs/` (all fictional): `give_miami_day_export_2022-2025.xlsx`,
  `board_retreat_notes.md`, `check_deposit_log_q3_2026.docx`, `donor_intake_forms_2026.docx`,
  `stock_and_daf_grants.docx`, `community_intake_forms_2026.docx`, `event_signin_sheet_nov1.xlsx`, with
  `answer_key.json` as ground truth (33 givers / 20 neighbors / 15 community; 113 gifts; $1,269,470; 6 duplicate groups;
  5 gift alerts).
- Today the app preloads: `service/db.py` has `SEED_DONORS` (line ~679) and `seed()` (line ~851) called from
  `reset_db(with_seed=...)`; "Try sample data" loads `web/public/snapshot.json`. Both leave the laptop path (D1).
- Committed caches (`data/research_cache.json`, `data/icp_cache.json`, `data/social_cache.json`,
  `service/context_cache.json`) are read only when a live call fails, and those rows are labeled "cached".
- **Q4 gauge:** the example files hold $750 of Q4 2026 gifts, so the gauge would read 0.5% of the $150k sample goal.
  Fix it in the example files: a fictional `online_gifts_oct_nov_2026.xlsx` plus an updated `answer_key.json` (D2).
- `reference data` that is not donor data stays seeded: the 17 interest tags.

#### 21.2.2 First run (onboarding)
```
1. Drag in the example files  --> ingest adapter (Carlos's stat-mcp extraction) --> people + gifts, tabs sorted
2. "Tell us about your organization": website (required) + X / LinkedIn / Instagram links (saved)
3. Context agent runs on its own, showing progress (sources read, items found):
      website + news (OpenAI hosted search) + public posts --> context store (kinds, embeddings, newest first)
      --> events + audiences + pre-drafted invites --> task generator --> alerts
4. Dashboard (Christian's mockup), every panel reading people/gifts + the context store
   Daily refresh (REFRESH_DAILY_AT) re-runs step 3: new items on top, tasks re-generated
```

#### 21.2.3 The context store: RAG ordered by time
- Builds on `org_context` (`service/db.py` line ~151: source, url, posted_at, fact, quote, priority, captured_at).
  Adds `kind` (success_story · program_update · use_of_funds · org_health · event · news · other), `title`,
  `embedding` (BLOB, OpenAI `text-embedding-3-small`), `cached`.
- `search_context(query=None, kinds=None, k=8)`: cosine similarity (numpy) × recency weight (half-life 90 days);
  ties go to the newest; no query returns the newest items of the asked kinds.
- Every row keeps its URL; a source that can't be read is labeled, never faked.

#### 21.2.4 Campaigns always tell the story
Every campaign, thank-you, outreach and event-invite draft calls `search_context(kinds=[success_story,
use_of_funds, org_health])` first and includes, newest first: ≥1 success story, 1 use-of-funds line, 1 org-health
line, each cited by id; the review screen shows the sources. If a kind is empty, staff are told and it is left out;
nothing is invented. Existing guard kept: `campaign_agent.py` already refuses to quote SAMPLE gift history to real orgs.

#### 21.2.5 Everything runs through the agent in the main UI
- The center agent (and the Ask sidebar) can do anything a screen can: CRM, interests, calendar, tasks, call notes,
  campaigns.
- Edits apply at once and show as a tool step with **Undo** (each write returns an undo token).
- Sends, merges and deletes show an **approval card** first (Agents SDK human-in-the-loop).
- The agent calls the same service functions as the buttons; after a write the UI refetches the affected panels.
- Every agent write is logged in `agent_actions`.

#### 21.2.6 Interest areas (enrichment's main job)
17 tags: arts_culture, education, youth_family, health_wellness, basic_needs, housing, economic_mobility,
community_development, environment_conservation, climate_resilience, animals, civic_media, equity_rights,
disability_access, science_technology, international, faith_based. Each tag carries confidence (high/medium/low),
evidence, source_url, source_type. Evidence ranked: board seat > named gift > named fund > public statement > event
sponsor > volunteer > attendance > social follow. No source, no tag; ambiguous identity, no tags; never inferred from
protected traits; staff tags never overwritten. Enrich proposes (`?dry_run=1`); **Save to profile** writes.
Individual-donor research stays organizations-first; fictional people have nothing on the web (correctly untagged).

#### 21.2.7 Voice
| | Dictation (🎙 in the chat box, Ask sidebar) | Call and transcribe (task card) |
|---|---|---|
| Model | `gemini-3.5-transcribe-live`, SMART mode | `gemini-3.5-transcribe-live` during the call; `gemini-3.5-transcribe` on the recording at the end (speaker labels, up to 8) |
| Transport | browser PCM16 16 kHz mono, ~100 ms frames → our `WS /transcribe/live` → Gemini Live API | same, plus `POST /transcribe/file` with the recorded audio |
| Stored | nothing | `call_notes` (title, folder, transcript, segments, staff_name, contact_name, summary) |
| Summary | — | OpenAI Agents SDK |
Key: `GEMINI_API_KEY` stays on the server (relay); paid tier for real donor calls (free tier may train Google models).
Twilio phone recording is a stretch (Florida needs all-party consent: spoken notice; a person makes the call).

---

### 21.3. UI target and wireframes (Christian's mockup, `docs/design/mockup/`)

#### 21.3.1 Home (screen 1-home)
```
+--+----------------------+-------------------------------------------+------------------------+
|[♥]| Donor Desk                                                       |            [☀] [✦Ask] |
+--+----------------------+-------------------------------------------+------------------------+
|⌂ | Q4 OUTREACH Oct1-Dec31| Good evening, <staff>    [Show meeting notes]| November          [+] |
|☏ |  (70%) Raised $X of  | +---------------------------------------+ | M T W T F S S          |
|👥|  $150k sample goal   | | TASK 1 OF 5 · CALL                    | |  dots on busy days     |
|✦ |  Reached today N     | | Call <donor> about failed monthly gift| | Tue 10 3 thank-you calls|
|➤ +----------------------+ | why: card failed Oct 10, monthly since | |        (added by agent)|
|📅| TODAY AT A GLANCE    | | [Lifetime $] [Last gift] [Prefers ☏]  | | Wed 18 Give Miami Day  |
|  | [3 gifts at risk]    | | [☏ Call and transcribe][Draft email]  | +------------------------+
|  | [2 possible dupes]   | | [Mark done]                           | | TASKS TO DO TODAY  [+] |
|  | [5 tasks today]      | +---------------------------------------+ | [ ] Call <donor> ...   |
|  | [11 days to GMD]     |  (you) Who gave this quarter and hasn't   | [ ] Check in with ...  |
|  +----------------------+        been thanked yet?                  | [ ] Review 2 duplicates|
|  | CRM  Open database → |  Agent: 3 donors, all from the gala: ...  | [ ] Welcome <new donor>|
|  | [🔍 Find a donor]    |  ✓ find_people  ✓ get_gifts               | [ ] Prep GMD list      |
|  | RD <name> [Card failed]| (you) Add thank-you calls Tuesday.      +------------------------+
|  | MB <name> [Late]     |  Agent: Done. Added 3 calls Tue 10-11 [Undo]| ARTIFACTS             |
|  | PR <name> [New]      |                                           | ▤ Gala thank-you drafts|
|  | TO <name> [Thanked]  | [Enrich X] [Who's late?] [Plan next week] | ▥ October summary      |
|  | ER <name> [Not yet]  | [+] Ask about donors...        [🎙] [➜]   | 🎙 Call notes · <name> |
+--+----------------------+-------------------------------------------+------------------------+
```
Header keeps only light/dark and Ask. Removed: sample badges, search bar, refresh, avatar.
"Show meeting notes" (the annotated overlay, screen 5) is a design aid: hidden for judging.

#### 21.3.2 Other screens
```
Projects open (2)            Ask sidebar (3) / expanded (4)          Phone (9)
+-----------------+          +-------------------------------+       +--------------+
| Projects [🔍]   |          | ✦ Ask Donor Desk     [⤢] [✕] |       | Donor Desk ☀✦|
| ▾ Campaigns   1 |          | [question............][🎙][↑]|       | task card    |
| ▾ Saved Ask   4 |          | Read-only: the AI sees your  |       | agent chat   |
| ▾ Donor lists 3 |          | question, never donor records|       | chips        |
|   Needs attn  6 |          | suggested questions ...      |       | [input 🎙 ➜] |
|   Star donors 2 |          +-------------------------------+       | ⌂ ☏ 👥 ✦ ➤ 📅 |
+-----------------+                                                  +--------------+
```

#### 21.3.3 Find a donor + Enrich (screen 7)
```
+----------------------------------------------------+
| Find a donor                                   [✕] |
| [🔍 Priya.........................................]|
| PR  <name>  First gift Oct 22 · $250 online        |
| [Lifetime $250] [Gifts 1] [Email p•••@example.org] |
| [Source: Donation page]                            |
| ▌Enrichment agent found (public web, review first):|
| ▌interest areas: [Youth & Family] [Environment]    |
| ▌works in pediatric health · source ↗              |
| [Save to profile]  [Open full record]              |
+----------------------------------------------------+
```

#### 21.3.4 Voice modal after a call (screen 6)
```
+-----------------------------------------------------------+
| ● Call ended · where should this go?                      |
| You:  Hi Rosa, it's Denise. I saw your monthly gift ...   |
| Rosa: Oh, I got a new card last month ...                 |
| Rosa: ... put me down for the beach cleanup on the 21st.  |
| Note title [Call with Rosa Delgado · card update.....]    |
| Folder [Call notes v]      Attach to [Rosa Delgado v]     |
|                                   [Cancel] [Save note]    |
+-----------------------------------------------------------+
then, in the agent chat (not in the mockup; added for the demo):
+-----------------------------------------------------------+
| Agent · from your call with Rosa                          |
| ✓ read_note  ✓ find_event("beach cleanup, 21st")          |
| [x] Task: send secure card-update link (today)            |
| [x] Calendar: Rosa attending Beach Cleanup (Sat Nov 21)   |
| [x] Context: prefers phone; new card since October        |
|                              [Apply selected] [Discard]   |
+-----------------------------------------------------------+
```

#### 21.3.5 Dictation in the chat box
```
+------------------------------------------------------------------+
| [+]  Who gave this quarter and hasn't been tha|   [● 🎙]  [➜]    |
|      ^ words appear live (interim in grey)      ^ press to stop  |
+------------------------------------------------------------------+
```

#### 21.3.6 Onboarding
```
Step 1 Upload                         Step 2 Your organization           Step 3 Building your context
+-------------------------------+    +----------------------------+     +-------------------------------+
| Drop your files here          |    | Website* [miamifoundation.org]|  | ✓ Website: 14 items           |
| .xlsx .docx .md .csv          |    | X  [..........]            |     | ✓ News: 6 items               |
| Put them in: (•) Let the agent|    | LinkedIn [..........]      |     | … Instagram: reading          |
|   sort ( ) Givers ( ) Neighbors|   | Instagram [..........]     |     | 3 success stories · 2 use of  |
|   ( ) Community               |    |               [Continue]   |     |  funds · 5 events → 23 tasks  |
| 68 people · 113 gifts found   |    +----------------------------+     |        [Go to dashboard]      |
+-------------------------------+                                       +-------------------------------+
```

#### 21.3.7 State summary
| UI piece | Before (main @ 6a18d17) | After |
|---|---|---|
| Layout | Projects sidebar + center cards + Ask sidebar | rail + left (gauge, glance, CRM) + center (task card, agent) + right (calendar, tasks, artifacts) |
| Data at start | seeded donors / cached snapshot | empty; drag in example files |
| Gauge | quarter vs sample goal | same, plus reached today; real Q4 gifts from the example files |
| Glance | one card | gifts at risk · duplicates · tasks today · days to next event |
| CRM | rail item | list with badges + find-a-donor pop-up with Enrich |
| Task card | none | today's task with why, chips, Call and transcribe / Draft email / Mark done |
| Agent chat | Ask sidebar only | center of home; tool steps, Undo, approval cards; writes CRM/calendar/tasks |
| Chat input | text | + attachments, 🎙 dictation, suggestion chips |
| Calendar | large month grid | small month with dots; items "added by agent" |
| Tasks | FakeRest (vanish on reload) | persisted in SQLite, generated + agent-created |
| Artifacts | none | call notes, drafts, reports |
| Enrich | writes immediately | proposes; Save to profile writes; interest tags |
| Voice | none | call transcript + speaker names + save; after-call Apply card |
| Onboarding | landing upload | 3 steps ending on the dashboard |
| Header | badges, search, refresh, avatar | light/dark + Ask only |

---

### 21.4. Element → data map (summary of `docs/ui-integration.md`)

| Element | Hook (80) | Endpoint | Status | Build |
|---|---|---|---|---|
| Rail, Projects sidebar, theme, Ask | existing | `useCampaigns`, `useGroups`, `useAsk` → `routes_ask` | ✅ #74 | — |
| Greeting name | `useOrgProfile` | `org_profile.staff_name` | ⏸ | D1 |
| Q4 gauge | `useTargets` | `/targets` + `reached_today` | ~ | B2 |
| Today at a glance, chips | `useHomeSummary` | `GET /home/summary` | ⏸ | B13 |
| CRM list badges | `usePeopleAttention` | `GET /people/attention` | ⏸ | B13 |
| Find a donor | `useDonors`, `useDonor` | existing | ✅ | — |
| Enrich → Save | `useEnrichPreview`, `useAcceptEnrichment` | `/enrich/{id}?dry_run=1`, `/people/{id}/enrichment/accept` | ⏸ | B1 |
| Task card, task list | `useTasks` | `/tasks`, `/tasks/generate` | ⏸ | B11 |
| Calendar | `useCalendarFeed` | `GET /calendar` | ~ | B12 |
| Artifacts | `useArtifacts` | `GET /artifacts` | ⏸ | B12 |
| Agent chat | `useChat` | `/chat` (+ new tools) | ~ | B10 |
| Dictation | `useDictation` | `WS /transcribe/live?purpose=dictation` | ⏸ | B3, B9 |
| Call transcript + modal | `useCallTranscript`, `useSaveCallNote` | `WS /transcribe/live?purpose=call`, `/transcribe/file`, `/people/{id}/call-notes` | ⏸ | B3, B9 |
| After-call card | `useAfterCall` | `/call-notes/{id}/actions`, `/apply` | ⏸ | B6 |
| Campaign review sources | `useCampaign` | campaign drafts + `sources[]` | ~ | C2 |
| Onboarding step 3 progress | `useContextStatus` | `/context/run`, `/context/status` | ✅ backend | C1 |

---

### 21.5. Integration contract (frozen before coding)

| Endpoint | Request | Response | Owner |
|---|---|---|---|
| `GET /interest-tags` | — | `[{slug, label, definition}]` | 42 |
| `GET/POST /people/{id}/interests` | POST `{tag, sub_tag?}` | `[{tag, sub_tag, confidence, evidence, source_url, set_by}]` | 42 |
| `DELETE /people/{id}/interests/{tag}` | — | `{removed: true}` (row kept) | 42 |
| `POST /enrich/{id}?dry_run=1` | — | `{facts[], interests[], contact{}}`, nothing written | 42 |
| `POST /people/{id}/enrichment/accept` | `{fact_ids, tags}` | `{saved}` | 42 |
| `GET /targets/quarters?as_of=` | — | `{quarters:[{label,start,end,raised}], ytd:{year,raised}}` | 48 |
| `GET /targets` | — | existing + `reached_today` | 48 |
| `GET /home/summary` | — | `{gifts_at_risk, duplicates, tasks_today, next_event{title,date,days}, reached_today, suggestions[]}` | 48 |
| `GET /people/attention?limit=` | — | `[{id, name, initials, line, badge}]` | 48 |
| `GET /tasks?due=today\|from&to&person_id` · `POST` · `PATCH /{id}` · `DELETE /{id}` | | `[{id, kind, title, why, person_id, chips[], due, time, done, source}]` | 3a |
| `POST /tasks/generate` | — | `{created}` (idempotent) | 3a |
| `GET /calendar?from&to` | — | `[{date, time, title, kind: event\|task, source, ref}]` | 3a |
| `GET /artifacts` | — | `[{kind, title, date, ref}]` | 3a |
| `POST /undo/{token}` | — | `{undone: true}` | 3a |
| `WS /transcribe/live?purpose=call\|dictation` | binary PCM16 frames; `{"type":"end"}` | `{"type":"interim"\|"final","text"}`, `{"type":"error","detail"}` | Agent Phone |
| `POST /transcribe/file` | audio | `{segments:[{speaker,text,start,end}]}` | Agent Phone |
| `POST/GET /people/{id}/call-notes` | `{title, folder, transcript, segments, staff_name, contact_name, duration_s}` | `{id, summary, created_at}` / list | Agent Phone |
| `POST /call-notes/{id}/actions` | — | `{steps[], actions:[{id,type,label,payload}]}` | 90b |
| `POST /call-notes/{id}/apply` | `{action_ids}` | `{applied:[{id,type,ref}]}` | 90b |
| `GET /people/{id}/pledges` | — | `[{amount, expected_by, status}]` | 90b |
| `GET /context/search?q&kinds&k` | — | `[{id, kind, title, text, source_url, posted_at, score}]` | 86 |

Rules: new routers (`routes_interests.py`, `routes_home.py`, `routes_tasks.py`, `routes_voice.py`,
`routes_after_call.py`) each add one `include_router` line in `service/main.py`; `db.py` gets only
`CREATE TABLE IF NOT EXISTS` blocks and guarded `ADD COLUMN`s, in the landing order of §8; `donors` and
`service/ingest/` untouched (🔒 Carlos).

---

### 21.6. Builds, owners and how each is built

#### 21.6.1 Owner map (live Claude Code sessions)
| Session | Already knows | Takes | Wave |
|---|---|---|---|
| **8b** | `db.py`, `routes_data.py`, contact_type | **D1** empty start · **D2** example dataset Q4 sheet | 1 |
| **86** | context agent, outreach, events, briefs | **C1** context store · **C2** story-first campaigns · close #49/#57 | 1 |
| **3a** | data layer (#53), outbox, send path | **B11** tasks + generator · **B12** calendar feed, artifacts, undo | 1 (critical path) |
| **42** | demographics extraction agent | **B1** interest tags | 1 |
| **48** | gift alerts (#48), targets | **B2** quarters + reached today · **B13** home summary + attention | 1 |
| **Agent Phone** | `/enrich` + donor route wiring, phone brief | **B3** voice backend (then S1 Twilio stretch) | 1 |
| **80** | web data hooks `providers/local/` | **B9** hooks, dictation + call audio capture, refetch helper | 1 |
| **12** | auto-deploy watcher (running) | deploy monitor + browser walk per merge | running |
| **90 [113a1a]** | chat agent (#58) | **B10** agent read + write tools, Undo, approvals, stream to assistant-ui | 2 |
| **90 [58e3c2]** ("90b") | idle reserve | **B6** after-call agent, pledges, RSVP | 2 |
| **98** | QA gate | one review subagent per PR | all |
| **c9** | written reviews; built none of this | independent evaluator (§10), overflow QA | Sun |
| **37** | — (confirm on brief) | **B5** README + demo-script skeleton | Sun AM |
| **Christian** | the UI | screens from the mockup | 1–2 |
| **Sharif** | — | integrates Christian's screens; demo call | — |
| **Carlos** | ingest 🔒 | on call if an upload fails | — |
| **Lead (Ideas)** | the plan | briefs, contract, merges pinned to approved SHAs, ROADMAP, unblocking | all |

#### 21.6.2 The loop every agent follows
```
lead: 5-field brief (CONTEXT / OWNS / TASK / DONE WHEN / RETURN)
  --> agent: git worktree add --no-track -b <branch> <path outside Dropbox> origin/main
             git push -u origin <branch>; check `git rev-parse --abbrev-ref @{upstream}` != main
  --> copy the listed code first, adapt minimally; tests from the smoke list first
  --> open the PR early (schema + stubs); push small commits; never push to main; never git add -A
  --> QA 98: subagent runs the build's smokes + full pytest + contract check --> APPROVE <full sha> | CHANGES
  --> lead: gh pr merge N --merge --match-head-commit <sha>; ROADMAP flip; tells dependents to rebase
  --> 12: auto-deploy main to Vercel (≤30 s); walks laptop + Vercel; posts counts per SHA
  --> c9 (Sun): grades §10; FAILs go back to the owner; repeat until all PASS
```

#### 21.6.3 Build cards

**D1 empty start (8b)** · OWNS `service/db.py` (seed call only), `service/main.py` startup, landing copy in web (one string), `service/tests/`
1. `reset_db()`/startup default `with_seed=False`; move `SEED_DONORS` into `service/tests/fixtures_seed.py`; keep tests passing with the fixture.
2. Remove "Try sample data → snapshot" from the laptop build (`VITE_DATA_MODE=live`); landing says "drag in the files from `data/sample_inputs/`".
3. Caches: read only in the live call's `except`; rows tagged `cached=1`.
4. Add `org_profile.staff_name` (set in onboarding step 2).
Done: fresh start = 0 people/gifts/tasks/context; full pytest green.

**D2 example dataset (8b)** · OWNS `data/sample_inputs/*`, `scripts/make_sample_inputs.py`
1. Add fictional `online_gifts_oct_nov_2026.xlsx` (messy like the others; example.com/555 numbers).
2. Update `answer_key.json` totals, per-quarter, gifts; `_README.md`.
Done: upload of the folder matches the key; Q4 gauge reads the new total.

**C1 context store (86)** · OWNS `service/org_context.py`, `org_context` columns in `db.py`, `routes_data.py` context search route, tests
1. Columns `kind`, `title`, `embedding`, `cached` (guarded ADD COLUMN).
2. Context agent: structured output classifies each item into a kind (enum); embed `title + text` with `text-embedding-3-small`.
3. `search_context()` with recency weight; `GET /context/search`.
4. Onboarding run ends with a call to `/tasks/generate` (3a's function) once it exists.
Done: every row has kind + source_url; newest-first holds; daily refresh adds on top.

**C2 story-first campaigns (86)** · OWNS `service/campaign_agent.py`, `outreach_agent.py`, `event_outreach.py`, tests
1. Each agent calls `search_context(kinds=[success_story, use_of_funds, org_health])` before drafting.
2. Prompt: use ≥1 of each when present, cite by id; draft carries `sources[]`; post-check rejects uncited claims; empty kind → staff note.
3. Keep the SAMPLE-history guard and approval rules.
Done: 5 drafts each cite all three kinds; 0 uncited claims.

**B11/B12 tasks, calendar, artifacts (3a)** · OWNS `service/tasks.py`, `routes_tasks.py`, `tasks` + `agent_actions` tables, tests
1. Tables (land first). 2. CRUD + service functions with undo tokens; `POST /undo/{token}`.
3. Generator (idempotent): failed/late alert → call (why + chips), duplicate group → review, first gift < 30 days → welcome, event ≤ 14 days → prep.
4. `/calendar` (events + dated tasks; `source`), `/artifacts` (drafts; call notes when present).
Done: 5 call tasks + 1 review per duplicate group; rerun adds 0; CRUD + undo pass.

**B1 interest tags (42)** · OWNS `service/interests.py`, `routes_interests.py`, `enrich_agent.py`, interest tables, tests
1. Tables + 17-tag seed. 2. Enrich: enum structured output + `contact{}`; identity check.
3. `?dry_run=1` propose; `/enrichment/accept`; add/remove with staff-wins; service functions return undo tokens.
Done: smokes 9; 3 live runs on sample organizations.

**B2/B13 money and home (48)** · OWNS `service/targets.py`, `routes_targets.py`, `routes_home.py`, tests
1. `quarters()` + `/targets/quarters`; `reached_today`. 2. `/home/summary`, `/people/attention`.
3. Guard missing tables until 3a / Agent Phone merge.
Done: quarters = answer key; gifts at risk = 5.

**B3 voice (Agent Phone)** · OWNS `service/transcribe.py`, `call_notes.py`, `routes_voice.py`, `call_notes` table, `scripts/smoke-gemini-live.py`, `scripts/smoke-transcribe-ws.py`, `requirements.txt` (+google-genai), tests
1. ~60-line WS relay (two asyncio loops around `client.aio.live.connect`, `input_audio_transcription`); `purpose=dictation` SMART, no storage.
2. `/transcribe/file` with `client.interactions.create`, verbatim + `diarization_mode: speaker`.
3. `call_notes` save/list; OpenAI Agents SDK summary; undo token.
Done: smokes 3, 10; key absent from `web/`.

**B9 web hooks (80)** · OWNS `web/src/components/atomic-crm/providers/local/*` (new files), `providers/local/audio/` (lifted)
1. Types + hooks for every endpoint in §5, contract-shaped mocks first; flip to real on each merge.
2. Lift Google live-api-web-console `src/lib/audio-recorder.ts`, `src/lib/worklets/audio-processing.ts`, `src/lib/audioworklet-registry.ts` (Apache-2.0: keep headers + NOTICE); `useDictation()`, `useCallTranscript()` (template: assistant-ui `examples/with-elevenlabs-scribe`).
3. Refetch helper for tasks, calendar, people, targets, summary, context.
Done: `pnpm tsc --noEmit` + provider tests; snapshot build renders with 0 console errors.

**B10 agent tools (90 [113a1a])** · OWNS `service/chat_agent.py` (+ a stream adapter module)
1. Tools: reads (`find_people`, `get_person`, `get_alerts`, `get_events`, `get_calendar`, `get_tasks`, `get_call_notes`, `search_context`); writes (`update_person`, `add_interest`, `remove_interest`, `accept_enrichment`, `log_gift`, `merge_duplicate`, `dismiss_duplicate`, `add_calendar_item`, `move_calendar_item`, `delete_calendar_item`, `rsvp_event`, `create_task`, `update_task`, `complete_task`, `delete_task`, `save_call_note`, `apply_after_call_actions`, `draft_email`, `draft_sms`, `send`, `undo`).
2. Writes return undo tokens; sends/merges/deletes use human-in-the-loop approval (copy `openai-agents-python/examples/agent_patterns/human_in_the_loop_server.py`).
3. Stream to assistant-ui via `assistant-stream` (Python) + a ~100-line event mapper; approval cards with `makeAssistantToolUI` + `addResult`.
Done: smoke 12.

**B6 after-call agent (90 [58e3c2])** · OWNS `service/after_call_agent.py`, `routes_after_call.py`, pledges table + `event_audience.rsvp` column, tests
1. Agents SDK agent, `output_type` = Pydantic list of typed actions (`create_task`, `rsvp_event`, `record_pledge`, `add_context_note`, `tag_interest`).
2. `/actions` proposes; `/apply` calls 3a's and 42's service functions.
Done: smoke 11; 0 writes before Apply.

**B5 ship-out (37 + lead)** · README (models named, how to run from empty, limits: P7 fraud hold, social tokens, individual research parked), demo-script skeleton for Sharif's call, repo public with MIT by Sun 4:45 PM after a history check (TEAM_CONTACTS, judges, transcripts never committed).

**Screens (Christian; Sharif integrates)** · built from §3 and `docs/ui-integration.md` on 80's hooks; each screen goes through the same loop.

#### 21.6.4 Code to lift (`docs/research/repos-to-lift.md`)
| Need | Lift | License |
|---|---|---|
| Chat UI, tool steps, approval cards | assistant-ui (already in #69): `makeAssistantToolUI`, `addResult`; prompt-kit chips | MIT |
| Agent → UI stream | `assistant-stream` (PyPI) + our event mapper | MIT |
| Human approval | openai-agents-python `examples/agent_patterns/human_in_the_loop_server.py`, `human_in_the_loop_stream.py`; `output_type=Pydantic` | MIT |
| Mic capture | google-gemini/live-api-web-console audio files (above) | Apache-2.0 |
| Gemini relay | ~60 lines of our own | — |
| Mini calendar, palette, gauge | shadcn `calendar` (react-day-picker), `command` (cmdk), radial `chart` (Recharts) | MIT |
| Twilio stretch | `twilio-python`, `record=True` + `recording_status_callback` | MIT |
Do not use: agent-chat-ui, vercel/ai-elements (deprecated end Nov 2026), ChatKit widget, CopilotKit, `gemilive` as a dependency, browser-direct Gemini with a long-lived key.

---

### 21.7. Folder / file structure (only what changes)
```
service/
├── db.py                    new tables/columns only, landing order §8; default seed removed (D1)
├── main.py                  one include_router line per new router; startup without seed
├── org_context.py           C1 kinds, embeddings, search_context
├── campaign_agent.py        C2 story-first drafts with sources
├── outreach_agent.py        C2
├── event_outreach.py        C2
├── tasks.py                 NEW B11/B12 tasks, generator, calendar feed, artifacts, undo
├── routes_tasks.py          NEW B11/B12
├── interests.py             NEW B1 tags, staff-wins
├── routes_interests.py      NEW B1
├── enrich_agent.py          B1 enum tags + contact, dry run
├── targets.py               B2 quarters, reached_today
├── routes_targets.py        B2
├── routes_home.py           NEW B13 summary, attention
├── transcribe.py            NEW B3 Gemini live relay + file pass
├── call_notes.py            NEW B3 notes + summary agent
├── routes_voice.py          NEW B3
├── after_call_agent.py      NEW B6
├── routes_after_call.py     NEW B6
├── chat_agent.py            B10 read + write tools, approvals, undo
├── requirements.txt         + google-genai, assistant-stream
└── tests/                   test_tasks, test_interests, test_targets_quarters, test_home_summary,
                             test_context_store, test_campaign_sources, test_call_notes, test_after_call,
                             test_agent_tools, fixtures_seed.py (moved SEED_DONORS)
web/src/components/atomic-crm/providers/local/   B9 hooks (interests, homeSummary, tasks, calendarFeed,
                             artifacts, voice, dictation, afterCall, contextSearch) + audio/ (lifted)
web/src/components/atomic-crm/…                   Christian's screens (home, onboarding, modals)
data/sample_inputs/          D2 online_gifts_oct_nov_2026.xlsx, answer_key.json, _README.md
scripts/                     smoke-gemini-live.py, smoke-transcribe-ws.py, verify-e2e.py cases (12)
.env.example                 GEMINI_API_KEY, GEMINI_TRANSCRIBE_MODEL, GEMINI_TRANSCRIBE_LIVE_MODEL (done)
plan.md                      §21 = this plan; ROADMAP.md flips per merge
README.md, docs/demo-script.md   B5
```

---

### 21.8. Flowchart (runtime) and landing order
```
+------------------+     +-------------------+     +------------------------------+
| Drag example     |---->| ingest adapter    |---->| people + gifts (SQLite)      |
| files (step 1)   |     | (Carlos, stat-mcp)|     +------------------------------+
+------------------+     +-------------------+          |            |
                                                        v            v
+------------------+     +-------------------+     quarters /    task generator (B11) <---+
| Org website +    |---->| context agent (C1)|      summary /       |                     |
| socials (step 2) |     | web+news+posts    |      attention      v                     |
+------------------+     +-------------------+      (B2,B13)    tasks table --> task card |
                                |                      |           |   --> task list      |
                                v                      v           |   --> calendar feed  |
                     context store (RAG, newest)   left column     |                      |
                                |                                  |                      |
             +------------------+------------------+               |                      |
             v                                     v               |                      |
   campaign / outreach agents (C2)        events + audiences ------+----------------------+
   cite story + use of funds + health
             |
             v
   drafts --> [approval card] --> send (email / SMS, dry run by default)

[Enrich] --> enrich agent (B1) --> proposals --> [Save to profile] --> donor_interests + facts
[🎙 chat] --> WS /transcribe/live (dictation) --> Gemini live --> words in input box (no storage)
[Call and transcribe] --> WS /transcribe/live (call) --> live transcript
        --> end: /transcribe/file (speaker names) --> [Save note] --> call_notes
        --> after-call agent (B6) --> [Apply] --> tasks · RSVP · pledge · context
Agent chat (B10) --> tools --> same service functions --> undo token / approval --> UI refetch (B9)
main merges --> 12 auto-deploys Vercel snapshot --> walk
```
| Order | Lands in `db.py` / main | Unblocks |
|---|---|---|
| 1 | 3a `tasks`, `agent_actions` | 48 tasks_today, B6, B10 |
| 2 | 8b empty start + new example sheet | 48 totals, 12 walk from empty |
| 3 | 42 interest tables | B6 `tag_interest`, B10 |
| 4 | Agent Phone `call_notes` | 48 reached_today, 3a artifacts, B6 |
| 5 | 86 `org_context` columns + search | C2, B10 |
| 6 | 90b pledges + RSVP | B10 `apply_after_call_actions` |
| 7 | 90 B10 tools | full agent-first walk, c9 grading |
80's hooks run in parallel throughout (mock first, real on each merge).

---

### 21.9. Derisking (dependency order; each passes before the next step's code)

| # | What it proves | Command | Expected | If it fails → |
|---|---|---|---|---|
| 1 | Empty start | `python -c "from service import db; db.reset_db()"` then SQL counts | people 0, gifts 0, tasks 0, org_context 0 | find the remaining seed path (startup, snapshot, cache) |
| 2 | Upload is the only source | upload `data/sample_inputs/*` via `/ingest` | tabs 33/20/15 (+ new sheet's people), gifts and total = updated `answer_key.json` | 8b fixes the sheet or key; Carlos checks ingest |
| 3 | Gemini key reaches the live model | `python scripts/smoke-gemini-live.py <20s wav>` | final text contains the scripted words | check key tier / model id in AI Studio; fall back to file model per chunk |
| 4 | Tables create; `donors` unchanged | `pytest service/tests -k schema` | pass; `donors` columns unchanged | make migrations IF NOT EXISTS / guarded |
| 5 | Context store fills, newest first | onboarding step 2 with miamifoundation.org, then `GET /context/search?kinds=success_story` | every row has kind + source_url; dates descending | 86 fixes classification / ordering |
| 6 | Campaigns tell the story | `pytest service/tests/test_campaign_sources.py` + 5 live drafts | each draft cites ≥1 success_story, use_of_funds, org_health; 0 uncited claims | tighten prompt + post-check |
| 7 | Task generator | `pytest service/tests/test_tasks.py -k generate` | 5 call tasks + 1 review per duplicate group; rerun 0 | fix rules / idempotency key |
| 8 | Money is exact | `pytest service/tests/test_targets_quarters.py` | quarters = updated key; Q4 > 0 | fix dates / failed-charge exclusion |
| 9 | Enrich | `pytest service/tests/test_interests.py` + 3 live orgs | only the 17 tags, each sourced; 0 writes before Save; made-up person 0 tags | tighten schema / identity rule |
| 10 | Voice | `python scripts/smoke-transcribe-ws.py <wav>`; restart; `GET /people/{id}/call-notes` | interim + final; file pass ≥2 speakers; note survives restart; dictation 0 rows | fix PCM framing / table |
| 11 | After-call | `pytest service/tests/test_after_call.py` | expected actions; 0 rows before Apply; Apply writes all | tighten action schema |
| 12 | Agent does everything | `pytest service/tests/test_agent_tools.py` + Playwright per tool | row changes; panel updates without reload; Undo restores; sends/merges/deletes need a click | fix the tool or refetch key |
| 13 | End to end on the laptop | 12's walk: empty → drag files → website → dashboard → chat → campaign → Enrich → call → Apply | all panels populated; 0 console errors; 0 failed requests | walk back to the failing smoke |
Ground truth after 13: SQL row counts vs `answer_key.json`; spot-check 3 context URLs by hand; Sharif's visual pass.

---

### 21.10. Evaluation criteria (graded by c9, never by the builders)

| Criterion | Metric + threshold | How measured | Evidence |
|---|---|---|---|
| Nothing preloaded | 0 rows of people, gifts, tasks, context before the first upload | SQL on fresh start | query output |
| Everything traces to the example files | 100% of people and gifts map to a file row in `answer_key.json` | QA script | report row |
| First run lands on a populated dashboard | glance counts > 0; tasks generated; ≥1 item per kind where the site has one | Playwright + SQL | screenshot + counts |
| Context store sourced, recent-first | 100% rows with source_url; newest-first order holds | SQL | query output |
| Campaigns tell the story | 100% of 5 drafts cite ≥1 success story, 1 use of funds, 1 org health; 0 invented facts | citation check + review | report |
| Money is exact | equals the updated answer key; pledges never count | pytest | pass line |
| Challenge #2 | fuzzy/possible duplicates stay pending until staff approve; exact identity matches may auto-merge but every auto-merged person shows a "!" review icon with Keep / Split (Sharif, Sun Nov 8); gift history and answer-key totals unchanged after Split; 5/5 alerts shown as tasks | API + SQL + Playwright | counts |
| Enrich tags | ≥2 of 3 sample orgs get ≥1 sourced tag; 0 outside the 17; 0 for a made-up person | API runs | JSON |
| Transcription | first words < 2 s; ≥90% word match on a scripted 20 s read | smoke + WER | log |
| Call notes | note + summary survive restart; dictation stores 0 rows | curl after restart; SQL | output |
| Agent does everything | every write tool works from chat; panel updates; Undo works; 0 sends/merges/deletes without a click | Playwright + SQL | log + screenshots |
| Key stays server-side | 0 Gemini key in `web/dist` or network | grep + Playwright network log | output |
| Demo path clean | 0 console errors, 0 4xx/5xx on the laptop and the Vercel snapshot | 12's walks | log |
Scorecard at close: `| Criterion | Threshold | Result | Evidence | PASS/FAIL |`; any FAIL keeps the work open; 3 stalled rounds → Sharif.

---

### 21.11. Timeline (freeze Sun 4:15 PM)
| When | What |
|---|---|
| On approval | Wave 1 briefs together: 8b (D1, D2), 86 (C1, C2), 3a (B11/B12), 42 (B1), 48 (B2/B13), Agent Phone (B3), 80 (B9); QA clears #73 (event-loop fix) and #69 (Ask panel) first; this plan copied into `plan.md` §21 and PR #77 merged |
| As wave-1 tables land | Wave 2: 90 [113a1a] (B10), 90 [58e3c2] (B6); 86 closes #49/#57 |
| Christian's draft arrives | Sharif integrates on 80's hooks; build → integrate → test on one loop |
| Sun 9 AM | merges, walks, c9 round 1 |
| Sun 11 AM | rehearsals from an empty start (reset DB each time); 37 drafts README + demo script |
| Sun 1 PM | c9 final scorecard; stretch only if all PASS |
| Sun 3:30 PM | tag `demo`; history check; repo public with MIT; freeze 4:15; submit by 4:45 |
Cut order if the clock wins: Twilio → Artifacts → CRM badges → Community impact. Never cut: empty start, context
store + story-first campaigns, tasks, voice, after-call, agent write tools.

---

### 21.12. Implementation steps (lead, in order)
1. On approval: copy this plan into `plan.md` §21; point `docs/finish-plan.md` to it; QA approves PR #77; merge pinned.
2. Send the seven wave-1 briefs in one batch (5 fields each, §5 contract, §6.3 card, git rules).
3. Track each PR: QA verdict → pinned merge → ROADMAP flip → tell dependents to rebase (§8 order) → 12's walk numbers.
4. As 3a + Agent Phone + 42 merge, send wave-2 briefs (B10, B6).
5. When Christian's draft lands, Sharif integrates; lead keeps the contract and hooks current.
6. Sun 9 AM: start c9; route FAILs; repeat until all PASS.
7. Sun AM: rehearsals; B5; history check; public + MIT; tag `demo`.

### 21.13. Open items
- Q4 example sheet (D2): included by default; say if you'd rather lower the sample goal instead.
- Sessions 12 and 37: roles confirmed on brief (12 already confirmed as the deploy watcher).
- Nit from 12's walk: Vercel's "Live AI isn't configured" answer shows a "Cached answer" badge (UI owner).

## 22. Demo run plan (Sharif, Sun Nov 8). The plan an agent executes; `docs/demo-script.md` stays the word-for-word script

Sharif: *"Start with showing the onboarding about putting in the data and then taking it to the dashboard."* This
section is the run order, the checks around it and the fallbacks. The bold labels, spoken lines and per-step timings
are in `docs/demo-script.md` (the script wins on wording; this section wins on order and checks). It describes main
as of Sun Nov 8 afternoon: no suggestion chips, the dashboard briefing, streaming agent replies, calendar v3. Nothing
here is run until Sharif says go.

### 22.1. Files touched
```
plan.md                         §22 (this section): run order, T-minus checklist, smokes, criteria, roles, fallbacks
docs/demo-script.md             read only here: the words and bold labels for every step below
scripts/demo_reset.py           T-30: --warm empties the db, warms the upload cache, checks the stage numbers
scripts/public_tunnel.py        T-15: on | off | status for the public site (the tunnel runs on --port 8401)
scripts/live_stack.ps1          T-30: stops / starts LIVE's service (:8001) and web (:5173) in C:\Users\Shari\dd-live-main
scripts/smoke-openai.py         smoke 1: key + model tiers + one Agents SDK tool call (7/7)
data/sample_inputs/             the 8 files dragged in on stage (not answer_key.json or _README.md)
```
No UI or code changes: this section only orders what is already on main.

### 22.2. The stage run (flow)
```
 T-30  +-----------------------------------------------+
       | venv python: scripts\demo_reset.py --warm      |  service stopped
       |  -> "PASS stage numbers: 77 people / 9 ..."    |--(exit 1)--> run it again
       +-----------------------+-----------------------+
                               v
       +-----------------------------------------------+
       | LIVE service :8001 + web :5173 (local mode)    |  scripts\live_stack.ps1 (IT lane)
       | smokes 1-4 (22.4)  ->  browser on Step 1 of 3  |
       +-----------------------+-----------------------+
                               v
 T-0   +-----------------------------------------------+
  (1)  | EMPTY APP: "Donor Desk · Step 1 of 3"          |  "Nothing is preloaded."
       +-----------------------+-----------------------+
                               v
  (2)  +-----------------------------------------------+
       | ONBOARDING                                    |
       |  drag 8 files -> Import 8 files (~10 s)       |
       |  receipt: 77 people · 131 gifts · 40/22/15 ·  |
       |           9 possible duplicates               |
       |  website miamifoundation.org -> Continue      |
       |  Reading your website (~30 s) -> "Your desk   |--("Still reading your site.")--> Continue to the
       |  is set up." -> Go to the dashboard           |                                  dashboard
       +-----------------------+-----------------------+
                               v
  (3)  +-----------------------------------------------+
       | DASHBOARD TOUR: tour card -> Not now          |
       |  "Here's your day." (4 lines) · Q4 gauge ·    |
       |  Impact & story · week strip (4 events) ·     |
       |  Tasks · CRM · Files & drafts                 |
       +-----------------------+-----------------------+
                               v
  (4)  +-----------------------------------------------+
       | DEMO MOMENTS (in this order)                  |
       |  a agent chat streams ("Plan next week")      |
       |  b duplicates in chat (Review -> inbox ->     |
       |    Ask the agent to fix)                      |
       |  c live call: "Call Christian Gonzalez"       |
       |  d transcript -> after-call card -> Apply     |
       |  e calendar v3 (next week -> 5K ⓘ -> batch)   |
       |  f Impact & story (Copy for a grant report)   |
       |  g CRM row expand + Enhance (Knight)          |
       |  h donor summary ("About <name>")             |
       +-----------------------+-----------------------+
                               v
  (5)  +-----------------------------------------------+
       | CLOSE: the closing line (demo-script "Close") |
       +-----------------------------------------------+
   any step fails --> its fallback (22.7) --> next step
   laptop or network dies --> Vercel preview tab (read-only sample data), say so
```

Step details (labels and timings from the Nov 8 dress rehearsals on main):

| # | Step | Operator does | Screen shows |
|---|---|---|---|
| 1 | Empty app | Hard refresh http://localhost:5173 | **Donor Desk · Step 1 of 3**, **Drag in your files.** |
| 2a | Files | Drop the 8 files, leave **Let the agent sort**, **Import 8 files** | **Import finished: 77 people · 131 gifts (+1 declined charge on record)**, **40 Givers · 22 Neighbors · 15 Community**, **9 possible duplicates to review** |
| 2b | Website | Type `miamifoundation.org`, **Continue** | **Reading your website · m:ss**, then **Your desk is set up.** (e.g. 15 facts) |
| 3 | Dashboard | **Go to the dashboard**, **Not now** on the tour card | **Here's your day.**, the gauge (**66%**, **$98.8k**), **Impact & story**, week strip with Sat 14 / Sun 15 (×2) / Thu 19 |
| 4a | Chat streams | Type *"Plan next week"* in **Ask the agent…** | step cards in ~2 s, the plan types out live (~10 s) |
| 4b | Duplicates in chat | Briefing line **9 possible duplicates to review.** → **Review** (opens the inbox, with the duplicates banner) → **Ask the agent to fix** | the agent works the duplicates in the chat; merging still waits for a click |
| 4c | Live call to Christian | In **Ask the agent…** type *"Call Christian Gonzalez"* → his call sheet → the sheet's **Call**: the panel **Call Christian Gonzalez** opens in the card: "Your phone (…) rings first. When you pick up, Christian Gonzalez (…) is called and sees your number.", the notice line "Christian Gonzalez hears “Hello. This call is recorded for our notes.” before the call connects.", and **Cancel** / **Call** → the panel's **Call** dials → answer the staff phone → keep it under 30 s → **Hang up** | **Ringing your phone…** → **Calling Christian Gonzalez…** (his phone rings; the recording notice plays) → **Connected · recording** → after **Hang up**: **Getting the recording…**, **Transcribing…**, **Summarizing…**, **Suggesting follow-ups…** → **Saved to the call notes**, the **Summary** and **Suggested follow-ups**, each with its own **Apply** (the in-card call has no **Apply selected**; that's the Live transcript card in 4d) |
| 4d | Call → after-call card | Rail **Live transcript** (opens on **Listening**) → **Demo call** → **Generate summary** | the scripted call with Hye-jin Park streams in (~10 s); the summary and **Suggested next steps** (~4 s); the after-call card proposes a card-update task, the RSVP ("RSVP goes to: The Give Miami 5K · Sun, Nov 15") and a context note → **Apply selected** writes the ticked ones |
| 4e | Calendar v3 | Briefing **Open calendar** → **›** → **ⓘ** on **The Give Miami 5K** → **Open batch** | **Calendar · Events**, **SUGGESTED BY THE AGENT**, the 5K campaign page (~3 s) |
| 4f | Impact | Click the **Impact & story** card | the stories by kind, **Copy for a grant report** |
| 4g | CRM + Enhance | Type *"Add the Knight Foundation as a contact."*; **CRM** heading → expand the Knight row → **Enhance** → **Save to profile** | **Enhancing…**, sourced interest tags (cached: under 1 s) |
| 4h | Donor summary | Open a donor's profile (e.g. Hye-jin Park) | **About Hye-jin** · **written by the agent** at the top of the Overview |
| 5 | Close | Presenter says the closing line | the dashboard |

The Live transcript demo call (4d) is with Hye-jin Park (#210): her failed $40 gift, then an RSVP to the Give Miami
5K, then the after-call card and **Apply selected**; `docs/demo-script.md` step 11 carries the words.

**4c, the live call.** Christian Gonzalez is a teammate added as a donor on LIVE only. His real number never goes in
a committed doc: write "his verified number". The T-30 reset empties LIVE's db, and anyone added before onboarding
would break the empty start (setup treats existing people as "already set up"). So **the IT lane adds him off-screen
during step 3 (the dashboard tour)**, in its own terminal, never on the projector:
`cd C:\Users\Shari\dd-live-main; & "C:\Users\Shari\Dropbox (Personal)\GenAI Company\Projects\devday_hackathon\.venv\Scripts\python.exe" -c "from service import db, agent_writes; c = db.connect(); print(agent_writes.add_contact(c, 'Christian Gonzalez', phone='<his verified number>')[0]['id']); c.commit()"`
(prints only his id). Then it checks `(Invoke-RestMethod "http://localhost:8001/phone/preview?donor_id=<his id>").ready`
→ `True` before the presenter reaches 4c (only the flag is shown, no numbers). The panel shows both phone numbers;
everything is public (Sharif), but this doc never quotes the digits: it writes "(…)". If it's not ready, 4c is skipped for 4d (fallback below). The staff phone (`STAFF_PHONE`) rings
first, so the person answering it is part of the call. Labels are from the code (`phone.ts` `statusLabel`,
`PhoneCallInline`); 54's live test call confirms them.

### 22.3. T-minus checklist (laptop operator)
- [ ] **T-60 (rehearsal):** run 22.2 end to end once, then smoke 6 (22.4), then reset.
- [ ] **T-30 (reset), OWNER: the IT lane (session 20).** The stage laptop runs LIVE: the service on :8001 (the
      writable one; :5173's `VITE_API_URL` points there) and the web on :5173. `demo_reset.py` resets the db of the
      folder it runs from, so it runs from `C:\Users\Shari\dd-live-main`, **never the Dropbox repo**.
      1. Stop :8401 (the public copy: a second service with `PUBLIC_MODE=1` over LIVE's db; the IT lane owns it).
      2. Stop LIVE's service only: `scripts\live_stack.ps1 stop -Stack live -Only service`.
      3. From `C:\Users\Shari\dd-live-main`, with the repo venv's Python (the one `live_stack.ps1` uses; plain
         `python` may lack the deps), in PowerShell:
         `cd C:\Users\Shari\dd-live-main; & "C:\Users\Shari\Dropbox (Personal)\GenAI Company\Projects\devday_hackathon\.venv\Scripts\python.exe" scripts\demo_reset.py --warm --port 8001`. It must end with
         **`PASS stage numbers: 77 people / 9 duplicate suggestions`**. Exit 1 means run it again.
      4. Start LIVE's service: `scripts\live_stack.ps1 start -Stack live -Only service`.
      5. Smokes 3–4 (22.4) on :8001 / :5173.
      6. Restart :8401 (the IT lane), then the T-15 checks.
- [ ] **T-25:** ask every other session to pause model-heavy work until after the demo. All sessions share one API
      key, and a busy key slows invites and agent replies (Nov 8: 429s).
- [ ] **T-20:** smokes 1–4 (22.4), in order.
- [ ] **T-15 (public site):** the public site stays live for the whole run (Sharif: no public-link switch during the
      demo); T-15 only checks it. The public link (https://devday-donor-desk.vercel.app) shows the laptop's live data
      through the tunnel (`docs/public-tunnel.md`). The tunnel runs on `--port 8401`: the public copy with
      `PUBLIC_MODE=1` over LIVE's db. :8001 stays the writable laptop service and is never tunnelled.
      1. `python scripts/public_tunnel.py status` must print the pid, the tunnel URL and `health: HTTP 200`, and
         `curl -s http://localhost:8401/public-mode` must return `{"enabled": true}` (with #254 merged:
         `"enabled": true, "redacted": false`, the show-all mode).
      2. Open the public link in a fresh incognito window: no **Sample data** badge; the dashboard, the CRM and the
         calendar (4 events) all load with the live data, and the DevTools console shows 0 errors.
      **Fallback (the snapshot):** if `status` prints `off`, the health check fails, or the page shows **Sample
      data**, the public link is serving the read-only snapshot, which is fine for judges: say "the public link
      shows a snapshot of the same data". Only with 10+ minutes to spare, bring it back with
      **`python scripts/public_tunnel.py on --port 8401`** (always with `--port 8401`: a bare `on` defaults to 8001 and
      would tunnel LIVE's unrestricted, writable API), then the 3 steps it prints, in order:
      (1) restart the public copy from `C:\Users\Shari\dd-live-main` (LIVE's db):
      `PUBLIC_MODE=1 PUBLIC_ORIGINS=https://devday-donor-desk.vercel.app uvicorn service.main:app --host 127.0.0.1 --port 8401`;
      (2) from `web/`, in Git Bash: `printf '%s' "<tunnel url>" | vercel env add VITE_API_URL production`, then
      `local` for `VITE_DATA_MODE` (`vercel env rm` the old values first);
      (3) `vercel --prod --yes`.
      Write down which state it's in.
- [ ] **T-15 (phone, IT lane):** LIVE's `.env` has the six call settings, checked without printing their values:
      `Select-String -Path C:\Users\Shari\dd-live-main\.env -Pattern '^(PHONE_CALLS|TWILIO_ACCOUNT_SID|TWILIO_AUTH_TOKEN|TWILIO_PHONE_NUMBER|STAFF_PHONE|SEND_ALLOWLIST)=' | % { $_.Line.Split('=')[0] }`
      must print all six names; `Select-String -Path C:\Users\Shari\dd-live-main\.env -Pattern '^PHONE_CALLS=on'`
      must match; `SEND_ALLOWLIST` must include his verified number. (The `/phone/preview` check for Christian comes
      after he's added, during step 3; see 4c.)
- [ ] **T-10 (mic):** open **Live transcript** (it should show **Listening**), then **Open Ask sidebar** →
      **Dictate** → **Stop dictation**. Grant the browser mic permission.
- [ ] **T-5 (screen):** browser zoom 110%, notifications off, DevTools console open on a second screen; close other
      apps (Dropbox sync paused, no other dev servers).
- [ ] **T-5 (fallback):** the Vercel preview open in a second tab (https://devday-donor-desk.vercel.app); a hotspot
      ready as Wi-Fi backup.
- [ ] **T-0:** hard refresh: the app shows **Donor Desk · Step 1 of 3** with nothing behind it.

### 22.4. Derisking: smokes in dependency order
1. **What it proves:** the API key, the model tiers and the Agents SDK work.
   **Command:** `.venv/Scripts/python.exe scripts/smoke-openai.py` · **Expected:** `7/7`, exit 0.
   **If it fails →** check `.env` (`OPENAI_API_KEY`, `OPENAI_MODEL_*`), then rerun; don't start the demo on a failing key.
2. **What it proves:** the upload reads the 8 files to the stage numbers, and the cache is warm.
   **Command:** T-30 step 3 (from `dd-live-main`, the venv Python, `--warm --port 8001`; LIVE's service
   stopped; never from the Dropbox repo) · **Expected:** `PASS stage numbers: 77 people
   / 9 duplicate suggestions (expected 77 / 9, …)`, exit 0. **If it fails →** run it again (it retries the model read);
   twice FAIL means demo the counts the receipt shows and say "the agent sorted them".
3. **What it proves:** the service is up, empty and private.
   **Command:** `curl -s http://localhost:8001/health` · `curl -s http://localhost:8001/events` ·
   `curl -s http://localhost:8001/public-mode` · **Expected:** HTTP 200 · `[]` · `{"enabled":false}` (:8001 is
   never in public mode).
   **If it fails →** restart the service from the reset's printout; a non-empty `/events` means rerun step 2.
4. **What it proves:** the web talks to that service in local mode.
   **Command:** open http://localhost:5173 · **Expected:** **Donor Desk · Step 1 of 3**, 0 errors in the DevTools
   console. **If it fails →** check `VITE_API_URL=http://localhost:8001` and `VITE_DATA_MODE=local`; restart the web
   (`scripts\live_stack.ps1 restart -Stack live -Only web`).
5. **What it proves:** the public link serves the live laptop data (or, knowingly, the snapshot).
   **Command:** `python scripts/public_tunnel.py status`; `curl -s http://localhost:8401/public-mode`; then open
   https://devday-donor-desk.vercel.app incognito · **Expected:** the pid + URL + `health: HTTP 200`;
   `"enabled": true` (with #254: `"redacted": false` too); the page loads without the **Sample data** badge.
   **If it fails →** the snapshot is the fallback (see T-15); restart the tunnel only with 10+ minutes to spare, and
   only as `python scripts/public_tunnel.py on --port 8401` (never a bare `on`: it tunnels :8001).
6. **What it proves (end to end, T-60 only):** the whole run works and the data is right.
   **Command:** run 22.2 steps 1–5 in the browser, then `scripts\demo_reset.py --check` from `dd-live-main` with the same venv Python (it approves the
   suggested merges on a COPY of the db) · **Expected:** `PASS` lines for people / gifts / alerts against
   `answer_key.json` (68 people: 33 givers, 20 neighbors, 15 community; 131 gifts). Run it **before** the IT lane
   adds Christian: with him the db holds 68 + Christian = 69 people (34 givers), and the check would FAIL on that
   alone. **If it fails →** note which
   count differs, tell the lead, and demo without the merge step. Then reset (smoke 2) before T-30.

### 22.5. Evaluation criteria (definition of done for the stage run)
| Criterion | Metric + threshold | How measured | Evidence |
|---|---|---|---|
| Stage numbers before going on | `PASS stage numbers: 77 people / 9` | `demo_reset.py --warm` output | the terminal line, kept on screen |
| Import receipt matches the answer key | 77 people · 131 gifts · 40/22/15 · 9 duplicates on screen | read the receipt (step 2a) | rehearsal screenshot |
| Setup is fast enough for a stage | import ≤ 15 s; context ≤ 45 s (or the "Still reading" path taken) | stopwatch from click to screen | rehearsal timing table |
| All 4 events land | Sat 14 Early Giving, Sun 15 5K + Festival, Thu 19 Give Miami Day on the week strip | read the week strip / calendar | rehearsal screenshot |
| Agents feel live | first step card ≤ 3 s; "Plan next week" done ≤ 15 s; call sheet ≤ 35 s | stopwatch | rehearsal timing table |
| Calendar to campaign | **Open batch** opens the campaign page ≤ 5 s | stopwatch | rehearsal timing table |
| Data stays right | with the suggested merges approved: 68 people, 131 gifts (on screen after the live-call setup: 68 + Christian = 69, 34 givers) | `demo_reset.py --check` (smoke 6, on a copy, before Christian is added) | its PASS lines |
| No visible errors | 0 console errors, 0 failed requests during the run | DevTools console + Network on the operator's screen | rehearsal note |
| Fits the slot | machine wait ≤ 3 min in total (rehearsal #2: ~131 s) | sum of the stopwatch times | rehearsal timing table |

Each criterion is graded at the T-60 rehearsal by someone who isn't the operator. Any FAIL is fixed or covered by its
fallback before T-30.

### 22.6. Who does what
| Role | Does | Doesn't |
|---|---|---|
| Presenter | speaks every line from `docs/demo-script.md`, points at the screen, takes questions | touch the laptop mid-step |
| Laptop operator | the T-minus checklist, every click and typed prompt, watches the console, triggers fallbacks | improvise prompts (type them exactly) |
| Backup | holds the Vercel tab and the hotspot; times the steps at the rehearsal | interrupt the run |

### 22.7. Fallbacks (if X fails → say/do Y)
| Step | If | Say / do |
|---|---|---|
| 1 Empty app | **Step 1 of 3** isn't showing, or the page errors | Don't start: stop the service, rerun T-30 step 3 (`demo_reset.py --warm`, venv Python, from `dd-live-main`; it must PASS), restart, hard refresh. |
| 2a Import | over 20 s or an error | "The agent is reading eight messy files." If it errors: **Use the example files**, then continue. |
| 2b Context | **Still reading your site.** | **Continue to the dashboard**: "It keeps reading in the background; the facts land in a minute." |
| 3 Dashboard | an event is missing | "The agent found these on the site; a missed one comes back on the next read." Carry on. |
| 4a Chat | no step card after 5 s | "It's pulling the events and tasks." If nothing after 20 s: retype once, then move on. |
| 4b Duplicates | the agent stalls | Same banner → **Review merges →**: show the pair and **Merge ✓** there instead. |
| 4c Live call | it doesn't connect, `/phone/preview` isn't ready, or Twilio errors | "Calls go through Twilio; here's the sheet and the demo call instead." Show the call sheet, then do 4d (the Live transcript demo call). |
| 4d Call + after-call | the transcript or summary stalls, or **Apply selected** fails | "The call is transcribed and turned into follow-ups; nothing is written until staff click Apply." Show the summary's **Suggested next steps** and move on. |
| 4e Calendar | **Open batch** fails | Show the **SUGGESTED BY THE AGENT** card: "12 invites are drafted and waiting for approval." |
| 4f Impact | the panel is empty | "This fills from the website read." Show **Here's your day.** instead. |
| 4g Enhance | slow (cache miss) | "It's reading the public web; every tag will carry its source." Skip **Save to profile** if over 30 s. |
| 4h Summary | **About …** says no notes | "The agent writes this from calls and notes as they come in." |
| Public link | the tunnel is down or the page shows **Sample data** | "The public link shows a snapshot of the same data." Keep demoing on the laptop. |
| Any | laptop, network or service down | Switch to the Vercel tab: "This is the read-only preview of the same data." |
