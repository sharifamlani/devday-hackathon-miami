# stat-mcp

`stat-mcp` is a Python FastMCP service that turns nonprofit source files into reviewable transaction events and derived person summaries. Its MCP tools support transaction listing and gift summaries, duplicate suggestions, configurable rubric scoring, and field/criteria discovery.

## Scope

**Included:** CSV, JSON, XLSX, DOCX, Markdown, and text readers; source locations and warnings; one event per explicit gift; source-scoped person projections; deterministic summaries and duplicate candidates; Agents SDK extraction from narrative text; and evidence-based criterion assessments.

**Not included yet:** the primary FastAPI `/ingest` adapter, writes to `data/donors.db`, durable storage, authentication or per-user session isolation, automatic identity merging, outreach, or calibrated giving-probability predictions. Imported datasets currently live in a process-wide dictionary and disappear when the MCP process restarts. Keep the service private and use synthetic data until a tenant-aware persistence boundary is added.

The live app's `gifts` table is transaction-oriented. Map each explicit `gift` event to one gift row, then build donor/person rows from the source-scoped grouping key. Keep matching people separate for human duplicate review. Do not turn lifetime totals into individual gifts or invent missing dates and amounts.

## Main application workflow

The intended flow is **staff upload → FastAPI validation → file extraction → staff review → one SQLite transaction → donor analysis**. The existing Python FastAPI app should call the `stat_mcp` parsing library directly from its `/ingest` adapter, persist accepted gift events and derived people through its existing database layer, then expose summaries, duplicate suggestions, and evidence-based rubric assessments to the UI. The browser should never connect to MCP directly. See [Agent Integration](AGENT_INTEGRATION.md) for the step-by-step adapter handoff and Node.js alternative.

## Initialize and run

From the repository root:

```sh
./stat-mcp/scripts/init-and-run.sh
```

The script creates `stat-mcp/.env` from the blank example only when it does not exist, syncs Python dependencies with `uv`, and starts the service. Add `OPENAI_API_KEY` in `stat-mcp/.env` for narrative extraction and criterion scoring. Structured file reading and deterministic tools do not require an OpenAI call.

The MCP endpoint is `http://127.0.0.1:8010/mcp`; the read-only tool catalog is `http://127.0.0.1:8010/tools`. The main FastAPI app uses port 8000. Set `STAT_MCP_HOST` and `STAT_MCP_PORT` in `stat-mcp/.env` to override the MCP listener.

## JavaScript client

The server-side Node.js package in [`client-js/`](client-js/) wraps MCP discovery, file imports, transaction/person reads, summaries, duplicate suggestions, and scoring. It uses the official `@modelcontextprotocol/sdk` and connects over Streamable HTTP. It is not published to npm; install it in the main server as a local `file:` dependency. From the main server package directory, run (adjusting the relative path if needed):

```sh
pnpm add file:../stat-mcp/client-js
```

This installs the package and its SDK dependency. In the consuming Node.js 20+ backend:

```js
import { readFile } from "node:fs/promises";
import { StatMcpClient } from "@devday-miami/stat-mcp-client";

const stat = new StatMcpClient({
  endpoint: process.env.STAT_MCP_URL ?? "http://127.0.0.1:8010/mcp",
});

await stat.connect();
try {
  const imported = await stat.importFiles([
    {
      name: "gift-export.xlsx",
      bytes: await readFile("./uploads/gift-export.xlsx"),
    },
  ]);
  const transactions = await stat.getTransactions(imported.dataset_id, { limit: 100 });
  const people = await stat.getPeople(imported.dataset_id, { limit: 100 });
  const summary = await stat.summarize(imported.dataset_id);
  // Apply authorization and staff review before writing to the CRM database.
} finally {
  await stat.close();
}
```

`importFiles()` accepts 1–20 files, each up to 20 MB and 50 MB combined. The client is server-side only: never expose the MCP endpoint, API key, or raw donor files to browser code. The current main application is Python/FastAPI, so its future `/ingest` route should import and call `stat_mcp.file_ingest.extract_file_transactions()` directly; it does not need this JavaScript package. The JS client is for a Node.js gateway or other Node-based host that connects to the MCP service. Neither integration automatically writes to `data/donors.db` yet.

See [Agent Integration](AGENT_INTEGRATION.md), [Required Fields](REQUIRED_FIELDS.md), and [Tools](TOOLS.md) for tool contracts, schema, warnings, and the database mapping boundary.
