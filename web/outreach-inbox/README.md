# Kindred outreach inbox

Christian’s simplified Gmail-style donor outreach concept, using the supplied warm beige/gray dashboard reference. This standalone UI slice lives beside the team’s Atomic CRM shell so it can be reviewed and integrated without replacing anyone’s work.

All people, gifts, staff notes, program information, and conversation text are fictional. No real donor records are included. State stays in memory in one browser tab and resets on reload.

## Run and check locally

Requires Node 22.12+ (verified with Node 24.22.1).

```sh
cd web/outreach-inbox
npm ci
npm run ci
npm run dev -- --host 0.0.0.0 --port 4173 --strictPort
```

`npm run ci` runs TypeScript, domain and interaction tests, and the production build. It makes no OpenAI or telephony requests. Checks use a package-specific `*.checks.ts(x)` pattern so the parent CRM’s browser Vitest project does not discover them. The team’s existing Atomic CRM checks are separate; this slice does not modify that app’s entry point, package manifest, migrations, or data providers.

## Demo path

1. Choose **Import donor list → Use our fictional sample**. Review the column mappings and four source-row previews; all 18 gift rows are validated. Acknowledge replacing the fictional workspace, then import.
2. Review **1 possible duplicate**. Rosa Delgado and R. Delgado share an email. Keep separate or explicitly approve the merge. The primary name/email remain; all four gift IDs and their original row references remain. **Undo merge** reverses the last merge until a later donor mutation/import. Review history is available in the duplicate dialog.
3. Open Rosa. Her July 30, August 30 and September 30 gifts establish a monthly cadence. The next gift was expected October 30; review starts November 6 after a seven-day grace period. The fixed demo date is November 7, 2026. Open a gift row to inspect transaction ID and source references.
4. Prepare a check-in, edit the example draft, and approve it for staff follow-up. This records a local task only; nothing is sent. Snooze/restore, search, missed-gift filtering, and completed tasks work.
5. Elena’s **Join** opens the briefing for a simulated 6:42 call. Read why she was flagged and the example transcript; join, mute/unmute the simulation, leave, and save an outcome. This never requests a microphone or opens a connection.

Custom CSV imports contain gifts and donor identities only. Only the built-in sample attaches fictional call and staff-note fixtures. CSV is supported; export XLSX to CSV first. Imports replace the tab’s workspace after explicit acknowledgment. Limits: 2 MB and 5,000 gift rows.

Required columns (mapping may rename them): `donor_id,name,email,gift_id,gift_date,amount`. Optional: `source`. Dates are ISO `YYYY-MM-DD`, amounts are positive USD decimal values. Stable gift IDs deduplicate repeated transactions; conflicting date/amount values are rejected rather than discarded. Name or email matches produce suggestions, never automatic merges. Source-row provenance is retained for all imported rows.

## Backend integration boundary

`src/domain.ts` holds the typed `Donor` and `Gift` structures plus deterministic demo cadence. `src/sample.ts` is the fixture adapter. Replace that fixture boundary with Sharif’s service data after the API contract is agreed. Server-authorized merge, audit, gifts, status and draft approval remain necessary before connecting real records. The current in-memory code is not a persistence or authorization layer.

The demo’s cadence estimate is **not** the planned backend propensity score. It does not predict willingness to donate. It never infers a failed card from an absent gift. Annual December gifts are not flagged early in November. The source calculation and actual dates are visible.

Drafts and call transcripts are example text; there is **no model invocation** in this slice. It therefore does not by itself satisfy the event’s OpenAI API / Agents SDK requirement. Live generation, sourced enrichment, the Foundation-branded experience, database storage and the CRM route are team integration work. This fictional Tidepath demo avoids implying that the Miami Foundation performs AI solicitation.

## Voice feasibility and remaining setup

Twilio’s [Voice JavaScript SDK](https://www.twilio.com/docs/voice/sdks/javascript) supports browser voice. A staff join path can use a server-authorized participant in a [TwiML Conference](https://www.twilio.com/docs/voice/twiml/conference). It needs a configured account, server-issued short-lived access tokens, a TwiML App/Voice URL, authenticated conference authorization, validated webhooks, HTTPS microphone permission, and explicitly approved calling costs. No credentials were created or charges incurred here. No Twilio SDK or token endpoint is wired in this branch.

Voice remains a **fictional simulation**. The team’s latest plan cuts automated calls for the Miami Foundation persona; do not enable solicitation through this demo. Staff-led calling and any further voice scope need alignment with that plan.

## Verification status

See `design-qa.md` and `docs/outreach-inbox-verification.md` at the repository root. The cloud browser could not reach the local preview relay; visual fidelity, mobile rendering, browser console health and native file-chooser behavior remain unverified. Local DOM interaction tests exercise the workflow but do not replace browser QA.
