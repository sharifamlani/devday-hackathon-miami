# Plan: one user journey, three screens, three URLs

**Status:** BUILT on `feat/user-journey-urls` (Sharif: "execute the plan in a separate branch", Sun Nov 8 evening) · awaiting QA gate,
independent evaluator (§12) and lead merge · drafted Sun Nov 8, 2026, 3:30 PM
**Builds on:** Carlos's `feat/demo-user-journey` (merged `f21e23c`; proposal `docs/proposals/demo-user-journey-lead-approval.md`)
**ROADMAP rows:** rides on 5E.11 (landing gate) and 5C (onboarding → context dataset). No new §3 row is needed if
Sharif accepts it as the follow-up to 5E.11.

> **Clock warning.** `CLAUDE.md` puts the freeze (F) at **Sun 3:30 PM**; `ROADMAP.md` §0 says **4:15 PM**. The
> journey already works end to end on `main` today (walk below), only without separate URLs. **Sharif decides:** ship
> this before F (about 90 minutes of work plus the flywheel), or keep it for after the event and demo the current
> flow. One fix is worth taking regardless: Step 1 (prefill the website). Step 0 (T-30 reset smoke) was fixed by #306.

---

## 1. The journey we want

```
  http://localhost:5173/          ──upload──▶   /#/onboarding        ──Continue──▶   /#/dashboard
  LANDING (bare URL, no hash)                    ONBOARDING (2 cards)                 DASHBOARD (Home)
  "Upload donor data" / "Try sample data"        receipt → your organization          populated workspace
```

Every visit starts at the bare URL. Each screen is its own page with its own URL; none floats over another.

## 2. Where we are today (walked on `main` @ `054bb4a`, isolated stack, empty DB, 3:20 PM)

| Check | Result |
|---|---|
| Journey works end to end | ✅ landing → import (77 accounts · 19 duplicates removed · 9 to review) → org step → dashboard |
| Dashboard fills after the org step | ✅ 37 s after Continue: 66% / $98.8k, **16 sourced facts**, Give Miami events, **18 tasks** |
| Console errors / failed requests | ✅ 0 / 0 |
| Separate URLs | ❌ landing at `/`, then **everything** at `/#/`. Onboarding is an overlay (a portal) drawn over the dashboard |
| Bare URL always shows the landing | ❌ only on an empty app. A browser that finished setup, or **any fresh browser once the DB has people**, goes straight to the dashboard (`KindredLandingGate` + `shouldAdopt`) |
| Website prefilled | ❌ name is prefilled ("The Miami Foundation"), website is blank. Carlos's proposal promised both |
| Import time, cold cache | ⚠️ ~51 s on a fresh worktree (demo script says ~8 s after the warm reset) |
| T-30 stage reset smoke 4 | ✅ fixed by #306 (`4e1d8cb`): it now accepts the landing ("Try sample data"). It failed at `054bb4a` |
| LIVE stack (:8001/:5173) | ⚠️ runs `350ae92` (3 merges behind) and holds 78 people, so it opens on the dashboard until the reset |
| Proposal doc | ⚠️ describes "Get started" + "Import demo files" buttons that a later commit removed. Stale; Step 7 fixes it |

## 3. The three screens: where each one lives today and how they join

| Screen | URL (after) | Component today | Mounted by today | Change |
|---|---|---|---|---|
| **Landing** | `/` (no hash) | `web/src/components/atomic-crm/landing/KindredLanding.tsx` (`KindredLanding`) + processing view `web/src/components/atomic-crm/upload/UploadProcessing.tsx` | `KindredLandingGate` in `root/DonorDesk.tsx`, **and** again as onboarding step 0 (`LandingStep` in `onboarding/OnboardingFlow.tsx`) | Gate always shows it on an empty hash. Upload / sample → processing animation → go to `#/onboarding` |
| **Onboarding** | `/#/onboarding` | receipt = `UploadProcessing` (result mode); org form = `OrganizationStep` in `onboarding/OnboardingSteps.tsx` | overlay opened by `OnboardingGate` in `layout/Layout.tsx` + `MobileLayout.tsx` | New full-page route (`CustomRoutes noLayout` in `root/CRM.tsx`) → `OnboardingPage.tsx` showing the two existing cards in turn. The overlay stops opening by itself |
| **Dashboard** | `/#/dashboard` (`#/` redirects there) | `home/HomePage.tsx` | `CRM dashboard={HomePage}` (react-admin home, path `/`) | Route alias + one `isHomePath()` helper replacing 10 `pathname === "/"` checks |

**How they join:** the browser's onboarding state (`onboardingState.ts`, localStorage) already records `files`
(the import receipt), `links` and `completedAt`. The pages read it as their entry guard:

- `/#/onboarding` with no saved import **and** no people in the service → back to `/`.
- `/#/dashboard` with no people in the service → back to `/`.
- `/` always renders the landing. When the service already has people it adds one link, **Open dashboard →**
  (`#/dashboard`), so a returning user isn't trapped.

## 4. Folder / file structure (only what this plan touches)

```
web/src/components/atomic-crm/
├── landing/
│   ├── KindredLanding.tsx         MOD  gate: empty hash = landing, always; after import → navigate #/onboarding;
│   │                                   "Open dashboard →" when people exist
│   └── KindredLandingGate.local.test.tsx  MOD  new cases: filled DB still shows landing; #/onboarding passes through
├── onboarding/
│   ├── OnboardingPage.tsx         NEW  full-page route: receipt card → OrganizationStep → navigate #/dashboard
│   ├── OnboardingPage.test.tsx    NEW  guard redirects; Continue lands on #/dashboard; research started once
│   ├── OnboardingFlow.tsx         MOD  drop LandingStep (step 0 belongs to the landing now); keep for snapshot build
│   ├── OnboardingGate.tsx         MOD  no auto-open overlay; keeps the tour offer + background-read status line
│   ├── OnboardingSteps.tsx        MOD  prefill website "miamifoundation.org" next to the prefilled name
│   ├── RestartOnboardingMenuItem.tsx MOD  "Set up again" navigates to #/onboarding
│   └── onboardingState.ts         MOD  isHome() accepts /dashboard; shouldAutoShow no longer used for the overlay
├── home/
│   ├── homePath.ts                NEW  isHomePath(pathname) + HOME = "/dashboard": one definition of "home"
│   ├── HomePage.tsx, useWorkspaceHotkeys.ts                MOD  use isHomePath / HOME
├── layout/DashboardControls.tsx, layout/MobileLayout.tsx    MOD  use isHomePath / HOME
├── contacts/donorCrmUi.tsx, contacts/DuplicateMerge.tsx     MOD  use isHomePath / HOME
├── onboarding/TourRunner.tsx                                MOD  use HOME
└── root/CRM.tsx                   MOD  <Route path="/onboarding"> (noLayout) + <Route path="/dashboard"> + "/" → "/dashboard"
scripts/
├── stage_reset.sh                 MOD  smoke 4 looks for the landing ("More time for people") at :WEB/
└── verify-journey.py              NEW  headless walk of the 3 URLs from an empty DB (adapted from the walk in §2)
docs/
├── demo-script.md                 MOD  steps 1–3 name the three URLs
├── proposals/demo-user-journey-lead-approval.md  MOD  "superseded by docs/plans/user-journey.md"
└── plans/user-journey.md          THIS FILE
ROADMAP.md                         MOD  flip 5E.11, §0 banner, §6 changelog, version bump
```

Untouched (🔒 Carlos owns ingest): `service/ingest/`, the `/ingest` route body. No backend code changes. The backend
already does both jobs; this plan only points each screen at the right endpoints (§6).

## 5. Flowchart: runtime and data flow

```
+--------------------+  Upload / Try sample   +---------------------+   POST /ingest (multipart)
| LANDING  /         |----------------------->| processing view     |---------------------------+
| KindredLanding     |                        | (UploadProcessing)  |                           v
+--------------------+                        +---------------------+          +--------------------------------+
     ^   |  people exist?                              |  result lands         | service/ingest_router.py       |
     |   +--yes--> shows "Open dashboard ->"           |  save receipt to      |  parse xlsx/docx/md/csv/txt    |
     |                                                 |  onboardingState      |  classify giver/neighbor/comm. |
     | guard: no import & no people                    v                       |  merge exact dupes (19)        |
+----+-----------------------------------------------------------+            |  queue look-alikes (9)         |
| ONBOARDING  /#/onboarding   (OnboardingPage)                   |            +---------------+----------------+
|  card 1: receipt  77 accounts · 19 removed · 9 to review       |<-- result -------------------+   SQLite
|          "Review matches" -> #/contacts (setup paused)          |                                  data/donors.db
|  card 2: OrganizationStep  name + website (prefilled)          |
+-----------------------------+----------------------------------+
                              | Continue: save links, completedAt; navigate at once
                              v
                 readOrganizationInBackground(links)   (onboarding/backgroundRead.ts, not awaited)
                              |
          +-------------------+--------------------+-------------------------+
          v                                        v                         v
 POST /context/run                         POST /tasks/generate       POST /events/refresh
 service/org_context.build_context         (routes_tasks.py)          (main.py)
 website + news, <= 30 s, same-host         donor + event tasks        dated events from the site
 cache fallback, saves profile + facts            |                         |
          | slow? -> POST /context/refresh, polled by GET /context/refresh   |
          v                                        v                         v
+---------------------------------------------------------------------------------------------+
| DASHBOARD  /#/dashboard   (HomePage)        react-query invalidates when the read finishes   |
|  Impact & story  <- GET /context (facts: success_story, use_of_funds, org_health, program_)  |
|  Ideas           <- (none on screen: chat chips removed in #310; see §6 open question)        |
|  Calendar        <- GET /events        Tasks <- GET /tasks       Briefing <- /duplicates ...  |
|  "Refresh research" in Impact & story -> POST /context/refresh                               |
+---------------------------------------------------------------------------------------------+
```

## 6. Backend → frontend wiring (cleaning and organization research)

Both jobs already exist in the service and are already called from the frontend. This table is the contract each
screen relies on; the plan moves calls between screens and adds none.

| Job | Screen that starts it | Frontend call (file) | Endpoint (service file) | What comes back / where it shows |
|---|---|---|---|---|
| **Clean the data**: parse, sort into Givers/Neighbors/Community, merge exact copies, queue look-alikes | Landing | `donorDeskMethods.uploadFiles(files)` (`providers/local/httpClient.ts`) → `ingestSummary()` (`onboarding/firstRun.ts`) | `POST /ingest` (`service/ingest_router.py`, 🔒 Carlos) | `people_added`, `by_tab`, `duplicates_removed`, `duplicate_suggestions`, `flagged_for_review` → onboarding receipt card |
| Review look-alikes | Onboarding ("Review matches") and Dashboard briefing | `getDuplicates()` (`providers/local/hooks.ts`) | `GET /duplicates`, `POST /duplicates/{id}/merge` (`service/routes_data.py`) | the 9 matches; merge keeps gift history |
| **Research the organization** | Onboarding (Continue) | `readOrganizationInBackground(links)` → `runContext({name, website, socials})` (`onboarding/backgroundRead.ts`) | `POST /context/run` → `org_context.build_context` (`service/main.py`) | profile + dated, sourced facts saved to SQLite; `served_from` live / fallback labels cached facts |
| Slow read keeps going | Dashboard | `startBackgroundRead()` + `useBackgroundWatcher` (`onboarding/backgroundRead.ts`) | `POST` / `GET /context/refresh` | status line on the dashboard; facts land when done |
| **Impact & story** | Dashboard | `useOrgContext()` → `getContext()` (`providers/local/hooks.ts`) | `GET /context` (`service/routes_data.py`) | facts grouped by kind in `home/panels/ImpactPanel.tsx`; "Copy for a grant report" |
| **Ideas** | Dashboard | **none on screen.** The chat chips were removed (#310, Christian). `GET /home/summary` still returns `suggestions` | `GET /home/summary` (`service/routes_*`) | nothing shows them today |
| Events → calendar, tasks | Dashboard | `getEvents()` (`crmHttp.ts`), `generateTasks()` (`providers/local/tasks.ts`) | `POST /events/refresh`, `GET /events`, `POST /tasks/generate`, `GET /tasks` | Calendar tile, Tasks tile (Preparation tasks per event) |
| Retry research | Dashboard | `useRefreshContext()` (`crmHooks.ts`) | `POST /context/refresh` | "Refresh research" in Impact & story |

**Open question for Sharif:** "Ideas" has no surface today. The chat chips that carried them were removed in #310,
so nothing on screen shows the service's suggestions. If you want an **Ideas & Stories** panel instead, that is a new screen element. It needs its own row and
its own wireframe.

## 7. Wireframes

### 7.1 Landing: `http://localhost:5173/`

```
BEFORE (empty app: same as AFTER; filled app or finished browser: you never see it)

AFTER (always, on the bare URL)
+--------------------------------------------------------------------------+
|                                  gatherly                     [Pause ▮▮] |
|                                                                          |
|                          Less time on tasks.                             |
|                        **More time for people.**                         |
|                  Your mission deserves more of your time.                |
|                                                                          |
|            +--------------------------------------------------+          |
|            |            [⇪ Upload donor data]                 |          |
|            |  or drag and drop your files here (CSV, Excel…)  |          |
|            +--------------------------------------------------+          |
|                           Try sample data                                |
|        1 Upload your list · 2 Understand your donors · 3 Reach out       |
|                                                                          |
|                     Open dashboard →     ← NEW, only when people exist   |
+--------------------------------------------------------------------------+
   ("Skip for now" removed: it belonged to the overlay version of step 1)
```

Processing state (same URL, after a click; existing `UploadProcessing`, unchanged):

```
+--------------------------------------------------------------------------+
|                                  gatherly                                |
|                       [ folders shuffling into a box ]                   |
|                       Bringing your data together.                       |
|                       [██████████░░░░░░░░]                               |
|                  Reading files and recognizing accounts.                 |
+--------------------------------------------------------------------------+
           │ result lands → URL becomes /#/onboarding (no click)
           ▼
```

### 7.2 Onboarding: `/#/onboarding` (full page, not an overlay)

```
BEFORE: the receipt was on the landing URL; the org form was an overlay over the dashboard at /#/

AFTER, card 1 of 2: what the cleaning found
+--------------------------------------------------------------------------+
| gatherly                                     Step 1 of 2   Finish later  |
|                                  ✓                                       |
|                      Your donor data is ready.                           |
|                     A clearer picture of your people.                    |
|              +---------------------------------------------+             |
|              | ✓  77  Accounts recognized                  |             |
|              | ✓  19  Duplicates removed                   |             |
|              +---------------------------------------------+             |
|              9 possible matches still need review. Review matches        |
|                      [ Create organization profile → ]                   |
+--------------------------------------------------------------------------+

AFTER, card 2 of 2: the organization to research
+--------------------------------------------------------------------------+
| ‹ gatherly                                   Step 2 of 2   Finish later  |
|                          Your organization.                              |
|                       Start with your website.                           |
|   Organization name  [ The Miami Foundation           ]                  |
|   Website            [ miamifoundation.org            ]  ← NEW prefill   |
|   + Add social links                                                     |
|                        [        Continue        ]                        |
+--------------------------------------------------------------------------+
           │ Continue → research starts in the background → /#/dashboard (< 2 s)
           ▼
```

Error state (service down on Continue): the card stays and shows "We couldn't reach the Gatherly service. Check that
it's running, then try again." (existing `plainError`). The URL does not change.

### 7.3 Dashboard: `/#/dashboard`

```
BEFORE: same layout at /#/, with the setup overlay on top during first run

AFTER, first 2 s (research still running)
+-------------------+------------------------------------------------------+
| gatherly          |  Good afternoon, Denise.                             |
| Q4 2026 outreach  |  Agent · Here's your day.                            |
|  66%   $98.8k     |  [15 tasks today. First up: Call Rafael …   Start →] |
| Impact & story    |  [9 possible duplicates to review.         Review →] |
|  Still reading    |                                                      |
|  your website…    |  ┌ Your desk is ready. One-minute tour? [Not now] ┐  |
| November  Nov 8–14|                                                      |
|  (no events yet)  |  (Add your first donors) (Who should I thank…)       |
| Tasks 15          |  [+  Ask the agent…                        🎤  → ]   |
| CRM               |                                                      |
+-------------------+------------------------------------------------------+

AFTER, ~35 s (research landed; nothing reloaded by hand)
+-------------------+------------------------------------------------------+
| Impact & story    |  [Next event: Give Miami Day — Early Giving opens,   |
|  16 sourced facts |   in 6 days (Nov 14).               Open calendar →] |
|  · Copy for a     |                                                      |
|    grant report   |  (Enrich Desmond Achebe-Wells) (Who's late on a      |
| November [Gi…]    |   (no chips: removed in #310)                        |
| Tasks 18          |                                                      |
+-------------------+------------------------------------------------------+
```

### 7.4 State summary

| UI piece | BEFORE | AFTER |
|---|---|---|
| Bare URL `/` | landing only on an empty app | landing **always** |
| "Open dashboard →" on landing | — | shown when the service has people |
| "Skip for now" on landing | shown (overlay step 1) | removed |
| After import | Continue button → overlay at `#/` | automatic → `#/onboarding` |
| Receipt card | on the landing URL | onboarding card 1 |
| Org form | overlay over the dashboard | onboarding card 2, full page |
| Website field | blank | `miamifoundation.org` (editable) |
| Dashboard URL | `#/` | `#/dashboard` (`#/` redirects) |
| Setup overlay auto-opening | yes | never; "Set up again" → `#/onboarding` |
| Impact & story / calendar / tasks fill | after ~35 s | unchanged |

## 8. Derisking (in dependency order; do not start N+1 until N passes)

| # | What it proves | Command | Expected | If it fails → |
|---|---|---|---|---|
| S1 | Reset smoke finds the new step 1 (regression) | `bash scripts/stage_reset.sh test` | `upload step shown: True` and `READY: test is empty` | fix the smoke's selector, not the landing |
| S2 | The three routes resolve in the shell | `cd web && npx vitest run src/components/atomic-crm/landing src/components/atomic-crm/onboarding` | all pass, incl. new guard cases | fix route registration in `CRM.tsx` before any UI work |
| S3 | `#/dashboard` is "home" everywhere (hotkeys, tour, rail Home button) | `cd web && npx vitest run src/components/atomic-crm/home src/components/atomic-crm/layout` | all pass | **fallback:** keep the dashboard at `#/`, drop the alias, keep S4–S6 |
| S4 | Typecheck + build | `cd web && npx tsc --noEmit && npm run build` | exit 0 | fix types; no deploy |
| S5 | Cleaning reaches onboarding with real counts | `python scripts/verify-journey.py http://localhost:5191 --until onboarding` | `onboarding url=/#/onboarding people=77 removed=19 review=9` | check `ingestSummary` and saved `files` state |
| S6 | **End to end, empty DB**: three URLs, populated dashboard | `python scripts/verify-journey.py http://localhost:5191` | `PASS 3 urls · facts>=10 · events>=1 · tasks>=15 · console 0 · failed 0` | route the failing screen to its owner with the screenshot |
| G1 | Ground truth: the dashboard numbers are the DB's | `curl -s :8191/people` · `curl -s :8191/context` · `curl -s :8191/events` | counts = 77 people, facts = Impact & story count, events ≥ 1 | the UI is lying: open a bug, don't adjust the test |

## 9. Evaluation criteria (definition of done, graded by an independent evaluator agent)

| # | Criterion | Metric + threshold | How measured | Evidence |
|---|---|---|---|---|
| E1 | A fresh browser on the bare URL sees the landing, **even with a filled DB** | landing text present: yes, both DB states | `verify-journey.py` cases `fresh-empty`, `fresh-filled` | `walk.json` + `01-landing.png` |
| E2 | Upload leads to onboarding at its own URL | URL = `/#/onboarding` within 120 s of the click; no overlay on `/#/` | `verify-journey.py` | `walk.json` step `onboarding` |
| E3 | Receipt shows what the cleaning did | 77 / 19 / 9 on screen = `/ingest` response fields | script compares DOM vs the captured `/ingest` JSON | `walk.json` |
| E4 | Org step is prefilled | name = "The Miami Foundation", website = "miamifoundation.org" | script reads the input values | `walk.json` |
| E5 | Continue lands on the dashboard URL fast | URL = `/#/dashboard` ≤ 2 s after Continue | script timer | `walk.json` `since_continue` |
| E6 | Research fills Impact & story, calendar, tasks | ≤ 60 s after Continue: facts ≥ 10, events ≥ 1, tasks ≥ 15 | script + `GET /context`, `/events`, `/tasks` | `walk.json` + `05-dashboard.png` |
| E7 | Clean run | 0 console errors, 0 HTTP ≥ 400, at 1440 px and 390 px | script listeners | `walk.json` |
| E8 | Nothing else broke | full `vitest` suite and `pytest service/tests` pass; deep links `#/contacts`, `#/calendar` still open | `npx vitest run` · `pytest -q service/tests` · script | CI log lines |
| E9 | T-30 reset is green | `stage_reset.sh test` exits 0 | run it | its `READY` line |

## 10. Implementation steps (each = one commit on its own branch; PR → QA gate → lead merges)

0. ~~**Reset smoke fix**~~: done by #306 (`4e1d8cb`).
1. **Prefill website** (`OnboardingSteps.tsx`). Independent; take it now.
2. **`homePath.ts` + the 10 call sites**: one definition of home. S3.
3. **Routes in `CRM.tsx`**: `/onboarding` (noLayout) → `OnboardingPage`, `/dashboard` → `HomePage`, `/` → `/dashboard`. S2.
4. **`OnboardingPage.tsx`**: lift the receipt (`UploadProcessing` result mode) and `OrganizationStep` as they are (copy,
   don't rewrite). Continue = Carlos's `readOrganizationInBackground` + `finish()` + `navigate(HOME)`. Guards. S5.
5. **Landing gate** (`KindredLanding.tsx`): always the landing on an empty hash; after import `navigate("#/onboarding")`;
   "Open dashboard →"; remove `LandingStep` and the overlay auto-open (`OnboardingFlow.tsx`, `OnboardingGate.tsx`). S4.
6. **`scripts/verify-journey.py`**: the §2 walk, extended to E1–E7. S6 + G1.
7. **Docs**: `demo-script.md` steps 1–3, mark Carlos's proposal superseded, ROADMAP flip + §0 + §6 + version.

Owners: Carlos reviews steps 4–5 (his flow); QA gates each PR merged with current main; the evaluator grades §9.

## 11. Restart onboarding from the menu under the user's name (Sharif, Sun Nov 8, ~4:10 PM)

**It already exists.** `onboarding/RestartOnboardingMenuItem.tsx` is mounted in the account menu
(`layout/DashboardControls.tsx` desktop, `layout/MobileHeader.tsx` mobile). Walked on `f17ffa9`: avatar → **Set up again**
reopens setup at step 1 (the landing); **Skip for now** returns to the dashboard; 0 writes, 0 console errors. Before
setup is finished the item reads **Finish setup** instead.

**Gaps:**
1. The menu header says **Account** and the avatar says **A**. The user's name (Denise) appears nowhere in it, so
   "underneath the user's name" isn't true yet.
2. **Set up again → Try sample data on a filled database imports everything a second time** (seen on LIVE at 2:28).
   Nothing guards against it.
3. In the three-URL design, **Set up again** must go to `/` (the landing), not reopen an overlay (§4 already lists
   `RestartOnboardingMenuItem.tsx`; its target changes from `#/onboarding` to `/`).

```
Account menu (bottom-left avatar)
BEFORE                                   AFTER
+------------------------------+         +------------------------------+
| Account                      |         | Denise                       |  ← the user's name heads the menu
|------------------------------|         | Development team             |  ← role line (optional)
| 📣 Campaigns                 |         |------------------------------|
| ☎ Outreach inbox             |         | ↺ Restart onboarding         |  ← renamed from "Set up again", moved first
| ↺ Set up again               |         | 🧭 Restart tour              |
| 🧭 Restart tour              |         | 📣 Campaigns                 |
| Public link on            ✓  |         | ☎ Outreach inbox             |
| Motion …                     |         | Public link on            ✓  |
| ⎋ Logout                     |         | Motion …  ·  ⎋ Logout        |
+------------------------------+         +------------------------------+
 [A]  ← avatar initial                     [D]  ← initial of the user's name

Click "Restart onboarding" with people already in the database:
+-----------------------------------------------------------+
| Start setup again?                                        |
| Your 77 people stay. Importing the same files again would |
| add them twice: use "Skip upload" to keep your data.      |
|                 [ Cancel ]  [ Skip upload ]  [ Start over ]|
+-----------------------------------------------------------+
   Skip upload → /#/onboarding (organization card)   ·   Start over → /   ·   Cancel → stays
```

| UI piece | BEFORE | AFTER |
|---|---|---|
| Menu header | "Account" | user's name |
| Avatar | "A" | user's initial |
| Restart item | "Set up again", third item | "Restart onboarding", first item |
| Filled-DB guard | none (double import possible) | confirm dialog with Skip upload |

**Evaluation criteria for this item (graded with §9):**

| # | Criterion | Metric + threshold | How measured | Evidence |
|---|---|---|---|---|
| E10 | The menu shows the user's name above the restart item | header text = the staff persona's name; restart item present | Playwright: open Account menu, read header + items | `restart.json` |
| E11 | Restart reaches onboarding | click → URL `/` (Start over) or `/#/onboarding` (Skip upload) | Playwright | `restart.json` |
| E12 | No double import | after Restart → Skip upload → Continue, `/people` counts unchanged (77) | `curl /people` before/after | counts in `restart.json` |

Implementation step 8 (after the freeze): name + initial from the profile in `DashboardControls.tsx` / `MobileHeader.tsx`;
rename and reorder the item; add the filled-DB confirm in `RestartOnboardingMenuItem.tsx`.

## 12. Scorecard (filled at close by the evaluator)

| Criterion | Threshold | Result | Evidence | PASS/FAIL |
|---|---|---|---|---|
| E1–E12 | see §9 and §11 | — | — | — |
