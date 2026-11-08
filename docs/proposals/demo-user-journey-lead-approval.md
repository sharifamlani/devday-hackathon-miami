# Proposal: Demo user journey update

**Status:** Proposed for lead review  
**Requested by:** Sharif  
**Scope:** Frontend entry/onboarding, organization context research and demo data handoff  
**Approval requested:** Approve the scope and decisions in “Lead decisions” before implementation.

## Goal

Make the live demo follow one clear path:

**Landing page → onboarding → sample documents structured on screen → The Miami Foundation researched → populated dashboard.**

The dashboard should be the result of setup, not the first screen. The experience must identify cached research when the live lookup cannot complete.

## What exists today

- `KindredLandingGate` has a landing page, but the root URL routes first-run users to the CRM shell and opens onboarding there. Existing users with records also go to the shell. The bare URL therefore does not consistently start at the landing page.
- The landing page has separate “Upload donor data” and “Try sample data” actions. The sample dialog imports documents and then opens the workspace while marking setup complete, bypassing the onboarding journey.
- Onboarding already accepts CSV, XLSX, DOCX and Markdown, can load sample files from `web/public/sample/`, uploads through the service, and shows an ingest receipt. Loading the samples and submitting the upload are separate actions.
- The organization step requests a website and optional social links. `ContextRun` accepts the website and social URLs, but has no organization-name field. The Miami Foundation website and social links are available in backend configuration.
- The context service performs live website/news research. It has a host-keyed saved context fallback, and marks the response as fallback when the live operation times out or fails. The onboarding status and fallback label need to be checked as part of the revised path. Partial source failures should also be reviewed so previously saved relevant facts are not hidden.
- The onboarding research starts an event search and invokes task generation. The dashboard’s Impact & Story area uses saved context. These are existing pieces to connect and verify; the current flow does not establish that one general search fills every panel.
- The snapshot build is read-only. Actual document ingestion requires the API-connected live build.

## Proposed changes

### 1. Make the landing page the demo front door

- Route the bare app URL to the landing page consistently, regardless of whether the browser already has onboarding state or the service already has records.
- Add one prominent **Get started** action to open onboarding.
- Preserve direct workspace routes and approved deep links, including a clear route for returning to the dashboard.
- Keep any separate file-upload shortcut only if the lead wants it; it must not silently skip the onboarding/research sequence in the demo path.

### 2. Make sample ingest a single onboarding action

- Keep manual multi-file upload.
- Add a **Use demo files** action in onboarding that loads the published sample manifest and submits the selected fixture set to ingest without requiring a second submit click.
- Reuse the current sample documents and ingest receipt, showing people, gifts, classifications and duplicate/review counts before continuing.
- Confirm the sample manifest excludes the answer key and documentation files, and that the fixture set remains compatible with the live ingest service.

### 3. Prefill and persist The Miami Foundation

- Add an organization name to the onboarding organization step, prefilled as **The Miami Foundation** for this demo.
- Prefill its website from the existing configuration and send the name through the API to the saved organization profile.
- Keep the organization editable so the same flow can research another nonprofit.

### 4. Make research, fallback and downstream outputs explicit

- Run live research for the selected organization and use the existing matching-host cache if the live search fails or exceeds its time limit.
- Show a visible status such as **“Using saved Miami Foundation research; live search did not finish.”** Show source dates/links where available and distinguish saved facts from newly retrieved facts.
- Define and implement behavior for partial results: use successful live sources, retain matching cached facts for failed sources where appropriate, and label each source’s status.
- Decide what “other organizations” means for this demo. Proposed bounded scope: research organizations explicitly named in the selected nonprofit’s public pages/news (such as partners, funders, and featured community organizations), with source links and a small result limit. Do not broaden to unrelated organizations or infer a funding relationship.
- Map grounded outputs to the UI: organization stories/facts to **Ideas & Stories**, current dated events to the calendar, and actionable event/outreach steps to tasks. Keep existing donor-derived task generation and make the origin of each task clear.
- Ensure a research failure does not block the user from reaching the dashboard; expose the status and allow a retry there.

### 5. Make the dashboard the completed journey

- After ingest and organization research, open the dashboard and refresh its data from the just-completed setup.
- Display the imported donor/gift data, organization research and source status, calendar results, and generated tasks from the onboarding run.
- In read-only snapshot mode, state that uploads and live research are unavailable and label all displayed sample/cached material accordingly.

## Acceptance criteria

1. A fresh browser opening the main URL sees the landing page, not the dashboard or an onboarding overlay.
2. **Get started** opens onboarding; completing it leads to the dashboard.
3. **Use demo files** loads and submits the sample set in one action and shows the structured import receipt before the next step.
4. The organization step starts with The Miami Foundation’s name and website, and the saved profile retains both.
5. A successful live run is labeled live; a timeout/failure uses only same-organization cached data and is visibly labeled as saved/cached. Partial source outcomes are also accurately labeled.
6. Research results feed Ideas & Stories; event results feed the calendar; generated tasks appear on the dashboard with their source/origin clear.
7. Research or event search failure does not strand onboarding; the user can continue to the dashboard and see status/retry affordance.
8. Direct workspace deep links still open the requested workspace view.
9. Snapshot mode clearly identifies sample/read-only data and does not imply that uploads or live research occurred.

## Suggested implementation sequence

1. Agree on the demo route behavior and “other organizations” scope.
2. Update root routing and the landing CTA; preserve deep links.
3. Wire the one-action sample ingest into onboarding and verify the manifest.
4. Add organization name/default through frontend request, backend model and profile persistence.
5. Improve live/cache/partial status handling and source-level provenance in onboarding and dashboard.
6. Wire and verify research, event and task outputs on the dashboard.
7. Walk the acceptance criteria in the live API-connected build and the snapshot build.

## Lead decisions

Please approve or adjust these choices before implementation:

1. **Main URL:** should `/` always be the landing page, with the dashboard available through an explicit workspace route?
2. **Demo files:** should onboarding automatically import the full existing sample set after one click, or load it into the picker for review before a separate confirmation?
3. **Other organizations:** should research be limited to organizations named on The Miami Foundation’s own site/news, or is there a specific set/list Sharif expects?
4. **Research outputs:** should the event/task behavior above be included in this change, or should the first delivery focus on landing → onboarding → organization research → dashboard and leave further downstream enrichment as a follow-up?
5. **Snapshot build:** is the read-only snapshot an expected stage path, or will the demo use only the API-connected live build?

## Code areas likely involved

- Front door and CTA: `web/src/components/atomic-crm/root/DonorDesk.tsx`, `web/src/components/atomic-crm/landing/KindredLanding.tsx`
- Onboarding flow and sample ingest: `web/src/components/atomic-crm/onboarding/OnboardingFlow.tsx`, `OnboardingSteps.tsx`, `firstRun.ts`, `web/src/components/atomic-crm/landing/sampleFiles.ts`
- Context request and fallback: `web/src/components/atomic-crm/providers/local/types.ts`, local provider/hooks, `service/main.py`, `service/org_context.py`
- Dashboard destinations: `web/src/components/atomic-crm/home/panels/ImpactPanel.tsx`, calendar components, task routes and generation

This proposal documents scope for approval only; implementation has not started.
