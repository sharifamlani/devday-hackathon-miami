# Import and transaction examples

The MCP client in `sample-call.mjs` shows text, CSV, and JSON calls and the current tool workflow. The official event upload fixtures are in `../../data/sample_inputs/`; the readers support `.xlsx`, `.docx`, and `.md` files there as well. Files can be passed individually to `import_donor_data` with a base64 payload, or in a batch to `import_donor_files`.

Supported inputs:

- `.xlsx`: every worksheet is read; sheet and row are retained as source location.
- `.docx`: paragraphs and tables are read. Narrative and table events can overlap, so warnings require review.
- `.md` / `.markdown`: prose is extracted and pipe tables are parsed as structured rows.
- `.csv`, `.json`, `.txt`: tabular data is normalized or prose is extracted.

Each explicit gift becomes its own transaction event with its own amount and date. The importer does not turn a lifetime total into a gift or invent missing transaction history. Person summaries are grouped only when events share a source-scoped person key or source ID. Matching names, emails, and phone numbers remain duplicate evidence for staff review; they do not merge people during import. See [the transaction contract](../REQUIRED_FIELDS.md).

## Run the JavaScript client

From `stat-mcp/`, set up and start the service:

```sh
uv sync
uv run python -m stat_mcp.server
```

Then run the sample MCP client in another terminal:

```sh
npm install @modelcontextprotocol/sdk
STAT_MCP_URL=http://127.0.0.1:8010/mcp node examples/sample-call.mjs
```

The sample performs bounded rubric scoring and incurs model calls. Use synthetic records and the lowest useful `--score-all` scope.

## Main app adapter

The `stat_mcp.file_ingest.extract_file_transactions(filename, payload)` async library function does not start a server. An adapter can call it from the existing FastAPI `/ingest` route, then call `stat_mcp.transactions.project_people(events)` and write people plus individual gift events to the existing SQLite tables. The adapter must apply the SQLite contract and preserve a human review path for warnings and incomplete gift dates.
