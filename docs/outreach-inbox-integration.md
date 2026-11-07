# Outreach inbox integration handoff

Christian requested a simpler inbox instead of a dense dashboard. The new slice is isolated at `web/outreach-inbox/`, alongside the Atomic CRM shell merged in `72705f6`. It intentionally leaves `web/package.json`, `web/src/main.tsx`, the CRM providers and database migrations untouched.

## Ownership and reconciliation

- Sharif retains the agent service, scoring, database and enrichment work described in `plan.md`.
- This branch supplies the complete fictional UI interaction path and deterministic example cadence.
- The demo script describes this standalone slice. Its sample brief/draft and voice features are explicitly examples/simulations, not claims about the team’s live backend.
- The supplied Library reference is `libfile_d9d4d3a717bc8191b7f650fe3af97fc0` (736×552). It was inspected visually; warm panels and minimalist Phosphor icons are adapted into an inbox. The health dashboard’s decorative charts were intentionally omitted to satisfy the later simplification request.
- Deadline: November 8, 2026 at 4:45 p.m. Eastern. No deploy, merge or submission was performed by this task.

## Integration sequence

1. Review the inbox composition in a working browser before deciding whether it becomes the CRM’s main route or a separate demo route.
2. Agree service contracts around donor identity, stable gift IDs, source rows, duplicate suggestions, cadence/score reasons, drafts and staff outcomes. `src/domain.ts` is the local fixture contract, not an assertion that the backend already implements it.
3. Wire authenticated service queries and mutations in place of React state. Require a persisted staff decision for merges and approvals, preserving source history and an undo/audit strategy. Do not migrate real data through the fictional import flow.
4. Replace fixture text with the backend’s sourced Agents SDK results and label cached results. Preserve the distinction between a deterministic cadence alert and the backend’s propensity score.
5. Keep the voice simulation isolated. The latest Foundation plan cuts automated solicitation; the demo makes no call and requests no microphone. Twilio browser conference capability is technically feasible but is not configured or authorized to incur charges here.
6. Run each changed application’s local checks; walk the combined app in a browser before merging. No hosted CI workflow was added.
