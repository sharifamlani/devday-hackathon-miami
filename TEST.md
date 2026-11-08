# Test and verification record

These checks were run on local `main` after integrating the newer `origin/main` implementation with the demo
journey changes. Commands are shown from the directory indicated; Playwright browser tests need Chromium and
permission to bind a temporary local test port.

## Landing, onboarding, and dashboard

From `web/`:

```bash
npm run test:unit:app -- --run --project app \
  src/components/atomic-crm/landing/KindredLanding.sample.test.tsx \
  src/components/atomic-crm/landing/KindredLanding.local.test.tsx \
  src/components/atomic-crm/landing/KindredLandingGate.local.test.tsx \
  src/components/atomic-crm/onboarding/OnboardingSteps.receipt.test.tsx \
  src/components/atomic-crm/onboarding/onboardingState.test.ts \
  src/components/atomic-crm/onboarding/firstRun.test.ts \
  src/components/atomic-crm/home/panels/ImpactPanel.test.tsx \
  src/components/atomic-crm/home/calendar/CalendarV3.test.tsx \
  src/components/atomic-crm/calendar/CalendarPage.test.tsx \
  src/components/atomic-crm/ask/AskSidebar.render.test.tsx
```

**Result:** 10 files passed, 124 tests passed. This covers the current sample import and onboarding flow, the
default organization name, accepted `.txt` files, the dashboard's cached-research label, and the latest calendar
and Ask-panel updates.

## Type checking

From `web/`:

```bash
npm run typecheck
```

**Result:** passed. During the upstream merge, this check exposed a blur-handler type error for optional
organization-name fields. The handler now treats missing values as empty strings, and the organization name
field remains prefilled while allowing another organization to be entered.

## Context fallback and API

From the repository root:

```bash
python -m pytest service/tests/test_context_fallback.py service/tests/test_main.py -q
```

**Result:** 32 passed. This includes same-host cached facts reaching the dashboard with cached provenance,
different-host isolation, preserving the agent-discovered organization name when the request omits one, and
using an explicit name when supplied.

## Full service suite

From the repository root:

```bash
python -m pytest service/tests -q
```

**Result:** 753 passed, 10 skipped. The ICP and prospect verification tests are included in this run. Seven
warnings remain: FastAPI lifecycle deprecations and one duplicate OpenAPI operation ID warning.

`git diff --check` passed after resolving the upstream merge.
