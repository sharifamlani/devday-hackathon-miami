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
1. **One branch per agent, in its own git worktree** (`git worktree add ../dd-<lane> -b feat/<lane>`).
   Sessions sharing one folder would switch branches under each other.
2. Touch only your paths. Anything outside them goes to the lead as a request.
3. Build against the §13 contract. Contract changes go through Carlos + Sharif via the lead.
4. Commit small, push your branch, open a PR, and tell the lead. **Never push to `main`; never merge.**
5. Each deliverable ends with its §8 smoke passing, and the output pasted to the lead.

**Integration order (dependency):** Local database (schema + routes) → Carlos's ingest fills it → scoring →
enrich + outreach (in parallel) → UI wires to all → end-to-end smoke on the demo laptop.
