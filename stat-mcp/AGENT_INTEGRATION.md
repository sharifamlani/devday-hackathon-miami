# Agent and service integration

This guide is the implementation handoff for an agent wiring `stat-mcp` into the main application. For this checkout, use the **Python library path** inside the existing FastAPI service. Use the bundled JavaScript client only if the host application is Node.js or a Node gateway is deliberately introduced.

## Main use workflow

The product flow is **upload → extract events → review → persist → analyze**:

1. An authenticated staff user uploads one or more CSV, JSON, XLSX, DOCX, Markdown, or text files through the main app's onboarding UI. The browser sends files only to the authenticated FastAPI backend.
2. FastAPI validates file count, extensions, and sizes, reads the bytes, and calls `extract_file_transactions(filename, payload)` for each file. Narrative extraction uses the configured OpenAI model; structured readers parse rows locally.
3. The importer returns explicit transaction events plus warnings. Preserve one event for each explicitly stated gift, source filename/location, unknown amount/date as null, and the source-scoped person identity. Do not invent a gift from a lifetime total.
4. Derive person rows with `project_people(events)`. Present the import summary and warnings for staff review, especially narrative/table overlap, ambiguous dates, and gift rows missing required database fields.
5. After approval, persist the accepted person projections to `donors` and each valid explicit gift to `gifts` in one SQLite transaction. Keep upload/batch metadata and source locations for traceability. Never persist non-gift profile/contact events as gifts.
6. On the persisted data, the main app can calculate gift summaries, show possible duplicate people for staff review, and request rubric assessments. `stat-mcp`'s in-memory dataset tools are useful for prototypes and standalone MCP clients; they are not the production system of record.

The system's output is structured, reviewable data. Duplicate matches remain suggestions; rubric scores are evidence-grounded prioritization aids, not probabilities or automated outreach decisions.

## Integration choice

| Host | Recommended integration | Reason |
|---|---|---|
| Current main app (Python FastAPI + SQLite) | Import Python functions directly; implement `/ingest` in the existing FastAPI app. | Avoids a second service hop and writes through the existing authenticated/database boundary. |
| Separate Node.js backend | Use `stat-mcp/client-js` over MCP Streamable HTTP. | Provides a typed-by-contract JavaScript wrapper for the MCP tool surface. |
| Browser/frontend | Call the authenticated main FastAPI app only. | Keep donor files, MCP endpoint, and OpenAI credentials server-side. |

Do not add the JS client as a dependency to the current Python FastAPI service. The SDK is a separate optional client package, not a replacement for the Python extraction library.

## What exists

- FastMCP Streamable HTTP server at `http://127.0.0.1:8010/mcp`; port 8010 avoids the main FastAPI service on 8000.
- `GET /tools` catalog for a UI/operator and normal MCP `tools/list` discovery.
- File readers for `.csv`, `.json`, `.xlsx`, `.docx`, `.md` / `.markdown`, and `.txt`.
- Transaction-first imports: each explicit gift is preserved as an event; person summaries are derived projections.
- Pandas summaries and duplicate suggestions, Pydantic schemas, and an Agents SDK narrative extractor / criterion evaluator.
- In-memory MCP dataset storage. It is not connected to the main service's `data/donors.db` or web app.

The primary product still uses FastAPI/SQLite. Its `/ingest` route is not mounted in the current checkout (`service/ingest/router.py` is absent). When that route is implemented, it can call the file-processing library directly; do not start a second HTTP service or write a second database. The library entry point is `stat_mcp.file_ingest.extract_file_transactions(filename, payload)`. It returns `(format, events, warnings)`. `stat_mcp.transactions.project_people(events)` derives person summaries. The adapter should map summaries to `donors` and each explicit `gift` event to one `gifts` row in a single SQLite transaction.

### FastAPI adapter outline

Keep the route in the main service's existing ingestion/router structure and follow its auth, database session, and error-response conventions. Suggested sequence:

```python
from stat_mcp.file_ingest import extract_file_transactions
from stat_mcp.transactions import project_people

async def ingest_uploads(files, authenticated_user, db):
    parsed_events = []
    warnings = []
    for upload in files:
        payload = await upload.read()
        file_format, events, file_warnings = await extract_file_transactions(
            upload.filename or "upload", payload
        )
        parsed_events.extend(events)
        warnings.extend({"filename": upload.filename, "message": item} for item in file_warnings)

    people = project_people(parsed_events)
    # Validate/map person and gift records using the live schema.
    # Persist accepted records plus import/source metadata in one db transaction.
    # Return counts, warnings, and review-required rows; do not return raw file contents.
```

This is pseudocode, not a ready-made route: adapt dependency injection, `UploadFile` handling, ORM models, duplicate-key policy, and transaction syntax to the main service. Verify the current `plan.md` §13 and §16 schema before mapping. The live `gifts.gift_date` requirement means a gift with no defensible date must be returned for correction/review or rejected with a clear row error, never assigned a fabricated date. Avoid partially committing a batch if any accepted row fails validation.

### Node.js host using the bundled client

If a Node backend is intentionally used, install the local package from that backend directory (adjust the relative path):

```sh
pnpm add file:../stat-mcp/client-js
```

Start `stat-mcp` separately with `./stat-mcp/scripts/init-and-run.sh`, then use the client server-side:

```js
import { readFile } from "node:fs/promises";
import { StatMcpClient } from "@devday-miami/stat-mcp-client";

const stat = new StatMcpClient({
  endpoint: process.env.STAT_MCP_URL ?? "http://127.0.0.1:8010/mcp",
});
await stat.connect();
try {
  const imported = await stat.importFiles([
    { name: "gifts.xlsx", bytes: await readFile("/private/uploads/gifts.xlsx") },
  ]);
  const [summary, transactions, people, duplicateReview] = await Promise.all([
    stat.summarize(imported.dataset_id),
    stat.getTransactions(imported.dataset_id, { limit: 200 }),
    stat.getPeople(imported.dataset_id, { limit: 50 }),
    stat.suggestDuplicates(imported.dataset_id),
  ]);
  // Require staff review and persist through the host application's DB layer.
} finally {
  await stat.close();
}
```

The client exposes `importFile`, `importFiles`, `getTransactions`, `getPeople`, `summarize`, `suggestDuplicates`, `getSuggestedFields`, `getSuggestedCriteria`, `scorePerson`, and `scorePeople`. The MCP server's imported datasets are process-local and do not replace persistence in the host application.

## Supported files and upload journeys

| Extension | Handling |
|---|---|
| `.csv` | Read rows using pandas. |
| `.json` | Accept an object or object list under `transactions`, `gifts`, `records`, `donors`, or `data`. |
| `.xlsx` | Read all worksheets and preserve sheet/row locations. |
| `.docx` | Read paragraphs and tables; tables are parsed as structured rows. |
| `.md` / `.markdown` | Send prose for extraction and parse pipe tables as rows. |
| `.txt` | Send text for extraction. |

Each file is limited to 20 MB. MCP clients pass binary data as base64. The batch tool accepts 1–20 files:

```js
const imported = await call("import_donor_files", {
  files: uploads.map(file => ({
    name: file.name,
    content: Buffer.from(file.bytes).toString("base64"),
  })),
});

const events = await call("get_donor_transactions", {
  dataset_id: imported.dataset_id,
  offset: 0,
  limit: 100,
});
```

For integration inside the primary FastAPI service, call the library directly instead of MCP:

```python
from stat_mcp.file_ingest import extract_file_transactions
from stat_mcp.transactions import project_people

file_format, events, warnings = await extract_file_transactions(upload.filename, await upload.read())
people = project_people(events)
# After the /ingest route is implemented, in one SQLite transaction:
# insert/update people, then insert each event with
# transaction_type == "gift" into gifts, preserving its amount/date/source location.
```

The adapter must honor the database contract in `plan.md` §13 and §16. In particular, map `contact_type` to `donor`, `beneficiary`, or `contact`; do not treat `total_giving` or lifetime totals as individual gifts; do not manufacture missing gifts; and do not write non-gift profile/contact events into `gifts`. The SQLite `gifts.gift_date` column is required, so incomplete gift rows need a review/error path rather than an invented date. Keep source filename and row/sheet/table location for traceability.

When a DOCX or Markdown file contains both narrative and a table, both are extracted and a warning is emitted because the same event can appear twice. Require staff review of that warning before database insertion; automatic fuzzy transaction deduplication is intentionally not performed.

## Person projections and analysis

`project_people()` groups only events sharing a source-scoped `person_group_key` (or source ID). Structured rows without an explicit identifier remain separate, even when names or emails match, so duplicate candidates remain available for staff review. The narrative extractor can reuse a local group key for events that clearly refer to the same person within one source. It derives gift totals, gift counts, and the latest unambiguous date from explicit gift events only. A contact with no gifts remains a person with null donation amount and count; it does not receive a fake zero gift.

The MCP tools `get_donor_records`, `score_donor`, and `score_donor_dataset` operate on those derived person projections. The rubric score is not the live app's deterministic gift-cadence propensity score or a probability of donating. Show coverage and retain `insufficient_evidence` separately from `fail`.

## Privacy and deployment

Narrative extraction sends submitted text to the configured OpenAI model. Use synthetic records until the nonprofit approves model processing. The MCP prototype has no authentication, durable storage, or tenant isolation. Keep the service local or behind the existing authenticated server-side boundary; keep keys out of browser code and logs. The current file library can be called without running the MCP server, so a FastAPI adapter does not create a port conflict.
