# Test and verification record

This file records the checks run for the demo user journey and the other agent changes present in this working
tree. Results are scoped to the command shown; a focused pass is not a claim that every feature has been tested.

## Demo journey: landing, onboarding, dashboard

The landing tests assert that the bare URL presents **Get started**, clicking it routes into onboarding, and
the dashboard renders only after entering a workspace hash route. The onboarding receipt test covers the
structured import summary. The Impact panel tests cover its story and dashboard rendering.

From `web/` (with dependencies installed):

```bash
npm run test:unit:app -- --run --project app \
  src/components/atomic-crm/landing/KindredLanding.sample.test.tsx \
  src/components/atomic-crm/landing/KindredLanding.local.test.tsx \
  src/components/atomic-crm/landing/KindredLandingGate.local.test.tsx \
  src/components/atomic-crm/onboarding/OnboardingSteps.receipt.test.tsx

npm run test:unit:app -- --run --project app \
  src/components/atomic-crm/home/panels/ImpactPanel.test.tsx
```

**Verification:** landing, route-gate, and onboarding receipt: 4 files, 9 tests passed. Impact panel: 1 file,
10 tests passed, including the “Saved research” label for cached facts. These browser tests require Playwright
Chromium and permission to bind a local test port.

## Context fallback and organization identity

The fallback tests cover timed-out reads, same-host and different-host handling, saved URLs, cached facts,
cached provenance, and preventing an omitted organization name from replacing an agent-discovered name.

From the repository root:

```bash
python -m pytest service/tests/test_context_fallback.py service/tests/test_main.py -q
```

**Verification:** 32 passed. Six FastAPI lifecycle deprecation warnings were reported. One regression test was
added after review showed that file-cache facts were returned to onboarding but not persisted for the dashboard;
the fix now saves same-host fallback facts and marks their database rows as cached. A failed first read for a
different organization still saves only its submitted setup fields.

## ICP and prospect verification

The ICP tests cover deterministic profile and prospect scoring, source quote and number verification, timeout
and cache behavior, donor exclusion, SQLite migration and persistence, API routes and snapshot parity, and
browser rendering. The browser test confirms hidden page content is ignored and non-200 pages are rejected.

```bash
python -m pytest service/tests/test_icp.py service/tests/test_icp_prospects.py -q
```

**Verification:** 24 passed. Chromium and permission to bind a temporary localhost port were available.

## Broader service suite

```bash
python -m pytest service/tests -q \
  --ignore='service/tests/test_ask 2.py' \
  --ignore='service/tests/test_campaigns 2.py' \
  --ignore='service/tests/test_merge_undo 2.py' \
  --ignore='service/tests/test_targets 2.py'
```

**Verification:** 721 passed, 10 skipped. Four untracked agent test files with a literal ` 2` suffix were
excluded because they target unmerged code and currently fail collection/setup against this branch. Running
the entire discovered tree without those exclusions also picks up those files. The filtered run needed local
port access for its server tests. Seven warnings included FastAPI lifecycle deprecations and a duplicate
OpenAPI operation ID warning.

## Type checking and working-tree caveat

```bash
npm run typecheck
```

**Verification:** blocked by four TypeScript errors in untracked campaign files named `CampaignList 2.tsx`,
`CampaignNew 2.tsx`, `CampaignReview 2.tsx`, and `OutboxList 2.tsx`; each imports `SimulatedNote` from
`campaignUi`, where it is not exported. The onboarding receipt fixture mismatch found during review was fixed.
These ` 2` files are separate concurrent working-tree additions and were not changed as part of the landing
journey review.

`git diff --check` passed after the review edits.
