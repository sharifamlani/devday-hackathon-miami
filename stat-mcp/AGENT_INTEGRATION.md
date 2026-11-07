# Agent and service integration

## What exists

- FastMCP Streamable HTTP server at `http://127.0.0.1:8010/mcp`; port 8010 avoids the main FastAPI service on 8000.
- `GET /tools` catalog for a UI/operator and normal MCP `tools/list` discovery.
- File readers for `.csv`, `.json`, `.xlsx`, `.docx`, `.md` / `.markdown`, and `.txt`.
- Transaction-first imports: each explicit gift is preserved as an event; person summaries are derived projections.
- Pandas summaries and duplicate suggestions, Pydantic schemas, and an Agents SDK narrative extractor / criterion evaluator.
- In-memory MCP dataset storage. It is not connected to the main service's `data/donors.db` or web app.

The primary product still uses FastAPI/SQLite. For that integration, import the file-processing library from the existing `/ingest` route; do not start a second HTTP service or write a second database. The library entry point is `stat_mcp.file_ingest.extract_file_transactions(filename, payload)`. It returns `(format, events, warnings)`. `stat_mcp.transactions.project_people(events)` derives person summaries. The caller should map summaries to `donors` and each explicit `gift` event to one `gifts` row in a single SQLite transaction.

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
# In one SQLite transaction: insert/update people, then insert each event with
# transaction_type == "gift" into gifts, preserving its amount/date/source location.
```

The adapter must honor the database contract in `plan.md` §13 and §16. In particular, map `contact_type` to `donor`, `beneficiary`, or `contact`; do not treat `total_giving` or lifetime totals as individual gifts; do not manufacture missing gifts; and do not write non-gift profile/contact events into `gifts`. The SQLite `gifts.gift_date` column is required, so incomplete gift rows need a review/error path rather than an invented date. Keep source filename and row/sheet/table location for traceability.

When a DOCX or Markdown file contains both narrative and a table, both are extracted and a warning is emitted because the same event can appear twice. Require staff review of that warning before database insertion; automatic fuzzy transaction deduplication is intentionally not performed.

## Person projections and analysis

`project_people()` groups only events sharing a source-scoped `person_group_key` (or source ID). Structured rows without an explicit identifier remain separate, even when names or emails match, so duplicate candidates remain available for staff review. The narrative extractor can reuse a local group key for events that clearly refer to the same person within one source. It derives gift totals, gift counts, and the latest unambiguous date from explicit gift events only. A contact with no gifts remains a person with null donation amount and count; it does not receive a fake zero gift.

The MCP tools `get_donor_records`, `score_donor`, and `score_donor_dataset` operate on those derived person projections. The rubric score is not the live app's deterministic gift-cadence propensity score or a probability of donating. Show coverage and retain `insufficient_evidence` separately from `fail`.

## Privacy and deployment

Narrative extraction sends submitted text to the configured OpenAI model. Use synthetic records until the nonprofit approves model processing. The MCP prototype has no authentication, durable storage, or tenant isolation. Keep the service local or behind the existing authenticated server-side boundary; keep keys out of browser code and logs. The current file library can be called without running the MCP server, so a FastAPI adapter does not create a port conflict.
