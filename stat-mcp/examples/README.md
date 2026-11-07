# Synthetic donor examples

`sample-call.mjs` connects to the running FastMCP server and demonstrates three inputs: a JSON CRM export, a CSV event export, and unstructured staff notes. It imports each source, reads a summary and duplicate suggestions, scores donor rows, and prints normalized donor fields with criterion outcomes/evidence.

The fixtures contain 282 source rows about an overlapping population of 120 fictional donors: 120 CRM profiles, 90 event rows, and 72 narrative notes. They deliberately include missing values, source-field aliases, similar names, and unverified staff recollections. The examples are synthetic and make no claims about real nonprofits. Regenerate the files with `python3 examples/generate_synthetic_data.py`.

Each source remains its own dataset. The current server does not consolidate people across imports; duplicate suggestions only compare records within a dataset. The example does not merge records or treat unverified recollections as confirmed gifts.

## Run the JavaScript client

From `stat-mcp/`, install the official MCP JavaScript client dependency in the consuming application and start the Python server separately:

```sh
npm install @modelcontextprotocol/sdk
uv run python -m stat_mcp.server
```

Then, in another terminal, from `stat-mcp/`:

```sh
STAT_MCP_URL=http://127.0.0.1:8000/mcp node examples/sample-call.mjs
```

By default, the script makes at most 25 model evaluations per source (75 total for the included fixtures). To score every source row, pass `--score-all`; this makes 282 model calls. That is a cost demonstration, not a recommended production workload. The unstructured notes are sent to the configured OpenAI model for extraction, and scoring makes one call per donor row. Use only the fictional fixtures in this demo.

## Output contract

The table uses the canonical fields in [REQUIRED_FIELDS.md](../REQUIRED_FIELDS.md), including `id`, `first_name`, `last_name`, `email_address`, `donation_amount`, `phone_number`, and `date_of_last_donation`. It also retains source, record index, optional profile fields, `score`, `score_label`, `coverage`, and `human_decision_required`.

For each configured criterion, the output contains `criterion_<id>_outcome`, `criterion_<id>_rationale`, and `criterion_<id>_evidence`. Preserve `insufficient_evidence` as its own state; do not rewrite it as `fail` or score it as zero. Missing text values are empty strings and a missing amount is null. The aggregate score is rubric fit, not a giving probability.

The example prints JSON columns and rows to stdout for inspection. The host UI can adapt those rows to a table or CSV export. Do not pass whole paginated donor profiles to the model; the scoring tool receives a minimized profile.
