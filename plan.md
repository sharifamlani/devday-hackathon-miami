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
