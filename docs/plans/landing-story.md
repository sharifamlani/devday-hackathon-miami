# Landing story: hero + problem + working demo + how it works

**ROADMAP row:** 11.3 · **Owner:** lead (Sharif's green go, Thu Nov 26, 2026) · **Approved design:** the
artifact mockup v7, https://claude.ai/artifact/GWRVFGdRaCR7UwkpBuMNKL (private; reviewed with Faye)

The bare URL keeps today's upload screen at the top (same dropzone, buttons, dialogs and import flow) and adds
four sections below it: the problem (auto-flipping before/after), a **working Gatherly demo** on the sample
snapshot with an auto-playing cursor, a 3-step "how it works" player, and a closing call to action. The demo is
the approved mockup's code lifted into the repo; it never writes anywhere (in-memory only, snapshot.json in).

## 1. Files

```
web/src/components/atomic-crm/landing/
├── KindredLanding.tsx            MODIFY  sticky header + centered hero; upload box/dialogs unchanged; renders the sections below
├── LandingSections.tsx           NEW     Problem (auto-flip), How it works (3-step player), Closing CTA
├── LandingDemo.tsx               NEW     loads snapshot.json, mounts the demo, shows a fallback if the file can't load
├── landingDemo/
│   ├── deriveDemoData.ts         NEW     snapshot.json -> the demo's data (port of the mockup's extract scripts + home/demo/scenarios.ts rules)
│   ├── deriveDemoData.test.ts    NEW     counts and card numbers checked against web/public/snapshot.json
│   └── demoApp.ts                NEW     the mockup's demo + auto-tour, lifted (render, events, tour)
├── landing-story.css             NEW     section + demo styles, all scoped under .gl (no clash with Tailwind/shadcn)
├── kindred-landing.css           MODIFY  page scrolls; ambient colors stay behind the hero only
└── LandingStory.test.tsx         NEW     sections render, in-page nav keeps location.hash "", demo mounts
docs/plans/landing-story.md       NEW     this plan + scorecard at close
ROADMAP.md                        MODIFY  row 11.3, banner, changelog, version
```

## 2. How it runs

```
 visitor -> bare URL -> KindredLandingGate (hash "", "#", "#/welcome") -> KindredLanding
   |
   +-- [1] header + hero + upload box (unchanged) --live: ingest -> UploadProcessing -> #/onboarding
   |                                                 sample: dialog -> #/dashboard
   +-- [2] Problem: Without/With flips every 2 s (a click holds 8 s)
   +-- [3] LandingDemo --fetch SNAPSHOT_URL--> deriveDemoData --> demoApp(root, data)
   |        |                                                    |  in-memory state only (no fetch, no POST)
   |        +-- fetch fails -> "Open the sample workspace" link  +-- auto-tour when >=25% visible;
   |                                                                 real click pauses, resumes after 15 s idle
   +-- [4] How it works player   [5] Closing CTA -> scrolls to the upload box
   header links -> scrollIntoView (never change location.hash: the hash IS the router)
```

## 3. Wireframe

The approved artifact (v7) is the wireframe: hero (brand line, headline, subtitle, upload box, Try sample data)
-> problem -> demo window -> how it works -> closing. Phone: one column; the demo's sidebar becomes a top tab row.

## 4. Derisking (in dependency order)

| # | What it proves | Command | Expected | If it fails |
|---|---|---|---|---|
| 1 | Demo data derives from the real snapshot | `npx vitest run --project unit src/components/atomic-crm/landing/landingDemo` | pass: 44 donors, 9 pairs, 19 tasks, 4 runs, audience 4, Hye-jin $480 / 7 gifts / Oct 10 declined | fix deriveDemoData before any UI |
| 2 | Upload screen unchanged | `npx vitest run src/components/atomic-crm/landing` | every existing Kindred test passes | restore the dropzone JSX verbatim |
| 3 | Types + Vercel build | `npm run typecheck && npm run build:demo` | exit 0 both | fix before any deploy |
| 4 | Local walk of the demo bundle | Playwright on `vite preview` 127.0.0.1:53xx | sections in order, tour plays, 0 console errors, 0 non-GET requests | fix the failing piece |
| 5 | **End to end on prod** | Playwright on https://devday-donor-desk.vercel.app at 1440 + 390 | criteria A–F below | route the FAIL back to build |

## 5. Evaluation criteria (definition of done)

| | Criterion | Metric + threshold | How measured | Evidence |
|---|---|---|---|---|
| A | A visitor can still upload from the first screen | existing landing tests 0 failed; Upload button fully visible without scrolling at 1440×900 and 390×844 | vitest; Playwright bounding box on prod | test line; walk JSON |
| B | Scrolling shows hero, problem, demo, how it works, closing, in that order | 5/5 sections in order at both widths | Playwright on prod | walk JSON + screenshots |
| C | The demo plays by itself and hands over | within 10 s of scrolling to it the cursor clicks at least 2 steps; a real click pauses it | Playwright on prod | walk JSON |
| D | The demo never writes | 0 non-GET requests during 60 s of tour + clicks | Playwright network log on prod | walk JSON |
| E | In-page navigation never leaves the landing | location.hash stays "" after every header link | Playwright on prod | walk JSON |
| F | Clean page | 0 console errors, 0 failed requests, page scrollWidth = viewport at 390 | Playwright on prod | walk JSON |
| G | Graded independently | an evaluator that didn't build it marks A–F PASS | evaluator sub-agent | scorecard below |

## 6. Scorecard

Graded by an independent evaluator (a sub-agent that didn't build it) on production, main 803db64, Thu Nov 26, 2026.
Its raw results: `desk.json` / `phone.json` + screenshots in the landing session's scratchpad `eval/`.

| Criterion | Threshold | Result (desktop / phone) | Evidence | PASS/FAIL |
|---|---|---|---|---|
| A. Upload from the first screen | button inside the first viewport, readable | inside / inside; white on rgb(36,39,40) | rects [618,483,822,527] in 1440×900, [93,374,297,418] in 390×844; landing suites 139/139 | PASS |
| B. Section order | 5/5 in order | 5/5 / 5/5 | hero → problem → demo → how it works → closing | PASS |
| C. Demo plays, then hands over | ≥2 steps in ~12 s; real click pauses | 4 / 4 state changes in 13 s; "Play tour" after click | 62 samples at 1 Hz, 28 changes; cursor visible throughout | PASS |
| D. Never writes | 0 non-GET requests | 0 / 0 | 7 requests per run, all GET, over 62 s of tour + Merge + Ask | PASS |
| E. Hash kept | location.hash "" after header links | 4/4 / 1/1 visible | URL stayed the bare origin | PASS |
| F. Clean page | 0 console errors, 0 failed requests, no sideways scroll | 0, 0, 1440 / 0, 0, 390 | console and network logs empty | PASS |
| G. Independent grade | A–F PASS | 6/6 | evaluator scorecard above | PASS |

Evaluator notes, handled in #338: on a return visit the tour resumed mid-sequence (now it restarts from the top); on phones the
demo window's top-bar labels wrapped (now one line). Not verified: real iOS Safari / Android Chrome (desktop Chromium only).
