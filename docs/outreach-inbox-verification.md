# Outreach inbox local verification

Verified November 7, 2026. Application: `web/outreach-inbox/`. This report covers the new standalone slice, not the team’s Atomic CRM shell or agent service.

## Actual results

- `npm ci`: passed, clean install from the committed lockfile (138 packages).
- `npm run ci`: passed (exit 0).
- TypeScript `tsc -b`: passed.
- Vitest: **2 files passed, 25 tests passed** (21 domain cases and four interaction flows).
- Vite production build: passed; initial JS bundle ~329 KB, gzip ~99 KB. Font assets are bundled locally.
- Preview server: returned HTTP 200 in its own execution session. This is startup evidence only.
- Cloud browser: **blocked** by relay error, “upstream connect error or disconnect/reset before headers. reset reason: connection termination.” No rendered application screenshot, mobile capture, actual browser file upload, or application console verdict exists.
- No deployment, merge, hosted CI run, credential creation, model call, email, SMS, microphone access, or phone call occurred in this task.

## Coverage

Domain checks cover quoted/BOM/CRLF CSV, embedded newlines and escaped quotes, malformed input, required unique mapping, impossible/future dates, invalid amounts, conflicting donor identity IDs and gift IDs, repeated transaction provenance, human-reviewed duplicate suggestions, gift-total preservation, distinct same-day gifts, monthly date clamping, annual-gift timing, exclusion of future history, and seven-day grace boundaries.

Local DOM interaction checks cover built-in sample preview/import and replacement acknowledgment, merge and undo with source gifts retained, keep-separate, simulated join/mute/leave and recorded staff outcome, edited draft approval without sending, snooze/restore, and search empty-state recovery. These are jsdom tests; they do not establish rendered fidelity or browser networking/media behavior.

## Reproduce

```sh
cd web/outreach-inbox
npm ci
npm run ci
npm run dev -- --host 0.0.0.0 --port 4173 --strictPort
```

The full local command output remains in `/workspace/scratch/b661abe191a6/outreach-local-ci.log` in the build workspace. `design-qa.md` intentionally says `final result: blocked` until a working browser verifies the rendered app.

## Coordination and remaining checks

The team added the Atomic CRM shell under `web/` while this frontend was in progress, then updated its plan to use local SQLite and give Carlos ownership of ingest. This standalone slice does not change the CRM manifest, entry point, service, migrations, or providers. Integration with that shell and service is still required. The parent CRM’s recursive lint/prettier tooling may discover this nested prototype; verify or explicitly scope those tools during integration. Its own local checks were not run here.

Automatic approval review rejected relocating `web/outreach-inbox` to `prototypes/outreach-inbox` and removing the local `web` directory: it considered the operation a broad, potentially disruptive shared-project reorganization not clearly authorized by the user. The command did not execute and was not retried. The tested prototype remains at `web/outreach-inbox`.
