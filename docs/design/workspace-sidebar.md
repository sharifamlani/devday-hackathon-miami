# Unified donor workspace

The home page centers the existing agent chat. One shared sidebar replaces the separate home overview and navigation rail, including on mobile. The top circular button collapses the sidebar to icons; each icon opens a panel anchored beside it. The expanded stack includes progress, calendar, tasks, CRM, projects, and files/drafts. Its preference is saved locally; on small screens an expanded sidebar can be dismissed with the backdrop or Escape.

CRM shortcuts open the existing donor and organization directory components inside the home workspace. Back to chat restores the mounted conversation. Both directory variants keep import, CSV export, and duplicate review. Search appearance and wording are shared; filters use an anchored menu and the table occupies the same width as the duplicate banner. Status badges get a separate column when space permits. Columns adapt to available panel width, including with the right pane open. The donor profile contact and ranking cards start on the same grid row. The header no longer shows the Sample data badge; cached-mode limits remain visible in the sidebar and mutation dialogs.

## Data wiring and team changes

All donor data, rankings, merges, imports, drafts, task counts, and attention rows still use the existing shared providers. No service, ingest, API contract, credential, or deployment settings change. The home day panel uses the existing GET/POST/PATCH /tasks hooks and GET /calendar, including task kind, time, and optional donor. Successful mutations invalidate the shared calendar, task, and home-summary queries. Snapshot writes are disabled in that panel with an explanation.

Reconciled against main `1a366f75973efee1058c016e4617b0192bf50a9d`: kept the team's latest full-calendar task feed, refresh behavior, task details, service-backed outreach plan, mobile calendar route, and backend duplicate/task fixes. Calendar changes in this PR are layout-only on top of that implementation.

## Local verification

From web/:

```sh
npm ci --ignore-scripts
npm run typecheck
npm run lint
npm run build:demo
npx vitest run --config vitest.workspace.config.ts
```

Typecheck, lint, demo build, and 279 tests in 27 suites passed after reconciling the team changes. Tests include provider contracts, task/calendar handling, hosted Ask core, and two server-rendered sidebar-access regressions. The sidebar tests isolate data hooks and dialogs; they do not prove live API calls or browser interactions. Existing config-loader, large-bundle, and source-map warnings remain. The partial local checkout lacks the unchanged landing ambient image; that build warning is not a source deletion.

## Acceptance still needed

- New-layout browser checks: local Vite starts on 127.0.0.1:4173, but the cloud browser's terminal.local route returns an upstream connection error. No visual or interaction acceptance is claimed.
- Live API: no service responds on 127.0.0.1:8000 here. Test creating a dated task, observing it in both calendars, completing it, and confirming persistence after reload against Sharif's service.
- Uploads: the deployed sample flow says it opens a cached workspace and cannot import. This change preserves Carlos's shared import endpoint; it does not prove a live multi-format import or reconcile its gift totals.
- Vercel: the connector returns project-not-found for devday-donor-desk and no accessible team context. No deployment or production revision is confirmed by this work.
- Rehearsal: expand/collapse; click every collapsed icon; test Escape and outside click; open Donors/Organizations from CRM; search/filter/sort; review duplicates; inspect James Carter; open/close the right pane at laptop and phone widths; send a question through the existing configured chat path. No live model calls were made for these checks.
