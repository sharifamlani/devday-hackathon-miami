# Integration walkthrough for an application agent

This guide is for the agent or developer connecting the UI to the current `stat-mcp` service.

## What exists

- Python FastMCP service using Streamable HTTP at `http://127.0.0.1:8000/mcp` locally.
- Read-only HTTP tool catalog at `GET http://127.0.0.1:8000/tools` (JSON names/descriptions and the MCP endpoint path).
- CSV/JSON normalization and Agents SDK extraction for unstructured text.
- Temporary in-process dataset storage. Dataset IDs stop working when the server restarts.
- Pydantic validation and canonical fields documented in [REQUIRED_FIELDS.md](REQUIRED_FIELDS.md).
- Pandas summary statistics and deterministic duplicate suggestions.
- An Agents SDK rubric evaluator with a deterministic equal-weight aggregation function.

This repository does not yet contain the frontend, a REST API, authentication, persistent storage, or a merge workflow. Connect from a server-side application/backend. Do not put the OpenAI key or donor file contents in browser code.

## Recommended user journey

1. **Connect and discover.** Use MCP Streamable HTTP on `/mcp`. A human UI may call `GET /tools` to display the available tool names and descriptions. MCP clients should use the protocol's normal `tools/list` method for tool discovery.
2. **Upload.** Call `import_donor_data` with `content`, `file_format` (`auto`, `csv`, `json`, or `text`), and optional `source_name`. Maximum upload is 2 MB; unstructured text is limited to 50,000 characters.
3. **Render normalized rows.** Read `dataset_id` from the import response, then page through `get_donor_records(dataset_id, offset, limit)`; `limit` is at most 50. Render the page directly in the authorized UI. These records contain PII—do not forward full pages to an LLM.
4. **Show deterministic analysis.** Call `summarize_donor_dataset(dataset_id)` and `suggest_duplicate_donors(dataset_id, threshold)`. Display match evidence and require staff to confirm/reject candidates. Never merge automatically.
5. **Get criteria and score.** Call `get_suggested_scoring_criteria` to populate an editable rubric or provide organization-authored criteria. Each criterion has `id`, `label`, `question`, and optional `evidence_fields`. Call `score_donor` for an individual record, or `score_donor_dataset` for a bounded batch. There can be at most 12 criteria and 25 donors per dataset-scoring call. An optional `opportunity_context` is limited to 1,000 characters.
6. **Present the result.** Show `score`, `coverage`, each criterion outcome/rationale/evidence, and `human_decision_required`. Keep `insufficient_evidence` distinct from `fail`; score only means rubric fit, not donation probability. Staff decide whether to pursue and approve any contact.

## MCP client call shape

The runnable JavaScript example at [examples/sample-call.mjs](examples/sample-call.mjs) shows imports and tool calls using the official MCP JavaScript SDK. The core call pattern is:

```js
const imported = await call("import_donor_data", {
  content: uploadedText,
  file_format: "text", // or "csv", "json", or "auto"
  source_name: file.name,
});

const page = await call("get_donor_records", {
  dataset_id: imported.dataset_id,
  offset: 0,
  limit: 20,
});

const summary = await call("summarize_donor_dataset", {
  dataset_id: imported.dataset_id,
});

const duplicates = await call("suggest_duplicate_donors", {
  dataset_id: imported.dataset_id,
  threshold: 0.65,
});

const scoring = await call("score_donor_dataset", {
  dataset_id: imported.dataset_id,
  criteria,
  max_records: 10,
  opportunity_context: "Review fit for the community learning fund.",
});
```

`call` in the example wraps `Client.callTool`, checks `isError`, and parses the JSON text result. If the UI needs to display all normalized rows, fetch all pages in the server-side application, not through model reasoning. Keep API errors visible as actionable UI states rather than silently replacing them with empty rows.

## Interpreting assessment results

- Each assessment returns `criterion_id`, `outcome`, `rationale`, `evidence`, and optional `confidence`.
- `outcome` is `pass`, `fail`, or `insufficient_evidence`.
- Final `score` is `100 × passes / (passes + fails)` across criteria with enough evidence. If none can be assessed, score is `null`.
- `coverage` is assessed criteria divided by requested criteria. Always show it beside the score.
- The Agents SDK makes one LLM call per donor. `score_donor_dataset` processes rows sequentially; the per-call row cap controls request size but each donor still incurs a model call.
- Duplicate scores are matching heuristics for review, not calibrated identity probabilities. Shared phones/emails can represent a household.

## Data handling and deployment boundary

The unstructured-text extractor sends the submitted text to the configured OpenAI model. The scoring evaluator sends an allowlisted, minimized profile without name/email/phone; it still includes giving history and selected staff notes. Confirm the nonprofit's data-use approval before processing real data. Use synthetic records for the hackathon.

`GET /tools` describes the tool catalog and contains no donor rows. The current custom route is unauthenticated, as is the rest of this prototype. Keep the server local or behind an authenticated server-side boundary. Before public deployment, add per-user/dataset authorization, durable storage with retention controls, TLS, and audit logging. Do not infer payment failure from missing donations, merge automatically, or send outreach automatically.
