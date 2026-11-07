# DevDay Exchange Community Hackathon: Miami

MCP and agent service for Project 2: help a small nonprofit fundraising team import donor records, review likely duplicates, and identify donors worth a timely, thoughtful follow-up. The user-requirements overview is the challenge brief and research in [Project 2: Duplicate donor records, and donors who quietly stop giving](research/2.%20Duplicate%20donor%20records%2C%20and%20donors%20who%20quietly%20stop%20giving.md).

## Product flow

1. Staff submit unstructured donor notes, a CSV, or JSON export.
2. CSV/JSON rows are normalized with pandas and Pydantic; unstructured text is extracted into the same schema by the Agents SDK.
3. The application reads structured rows using `get_donor_records`; deterministic functions summarize recorded gifts and rank possible duplicate candidates.
4. Staff review duplicate suggestions; the system never merges records automatically.
5. The Agents SDK evaluates one donor at a time against the nonprofit's selected criteria, returns a `pass`, `fail`, or `insufficient_evidence` with cited profile evidence, and the server calculates an equal-weight average plus evidence coverage.
6. Staff choose whether and how to follow up. The score is a rubric-fit/pursuit-priority aid, not a probability that someone will give.

Every structured record includes `first_name`, `last_name`, `email_address`, `donation_amount`, `phone_number`, `date_of_last_donation`, and `id`. Missing text values are empty strings, a missing amount is `null`, and an absent ID is generated as a UUID. See [the tool guide](stat-mcp/TOOLS.md#ingestion-contract) for aliases and details.

## Architecture

FastMCP is the service and MCP interface; there is no separate FastAPI layer in this starter. The OpenAI Agents SDK is used inside bounded donor evaluations. The eventual UI/agent host can call the FastMCP Streamable HTTP endpoint; keep the OpenAI key and donor data on the server side.

```text
Frontend / application agent
       │ MCP Streamable HTTP
       ▼
FastMCP server (`stat-mcp`)
   ├── Pydantic input/output validation
   ├── pandas ingestion + deterministic donor analysis
   └── OpenAI Agents SDK → evidence-based criterion assessments
                         → equal-weight aggregation + coverage
```

## `stat-mcp` tools

- `GET /tools` — return a JSON overview of all registered tools and their descriptions; MCP clients can also use `tools/list`.
- `import_donor_data` — normalize CSV/JSON or use the Agents SDK to extract donor fields from unstructured text.
- `summarize_donor_dataset` — report row/field counts and descriptive stats for donation amounts.
- `suggest_duplicate_donors` — return candidate pairs and matching evidence for human review.
- `get_donor_profile` — return one allowlisted profile row.
- `get_donor_records` — return paginated normalized records to an authorized UI/backend.
- `get_suggested_donor_fields` / `get_suggested_scoring_criteria` — provide field and rubric metadata to a UI or agent.
- `score_donor` — call the Agents SDK to assess one donor across the chosen rubric.
- `score_donor_dataset` — score at most 25 rows per request, one bounded LLM call per donor.
- `aggregate_donor_criterion_scores` — calculate the score and evidence coverage from validated criterion results.

See [Agent Integration](stat-mcp/AGENT_INTEGRATION.md) for the intended call sequence and [Required Fields](stat-mcp/REQUIRED_FIELDS.md) for the canonical data contract.

Suggested rubric dimensions: mission affinity, documented giving-capacity evidence, relationship/access, timing/readiness, and stewardship fit. Donor criteria remain configurable. See [stat-mcp/TOOLS.md](stat-mcp/TOOLS.md) for contracts, evidence rules, fields, and the Annie Duke-inspired uncertainty-aware decision notes.

## Run locally

```bash
cd stat-mcp
cp -n .env.example .env  # only creates .env if one does not already exist
uv sync
uv run python -m stat_mcp.server
```

The MCP endpoint is served at `http://127.0.0.1:8000/mcp` by default, and the tool catalog is at `http://127.0.0.1:8000/tools`. FastMCP clients discover tools over MCP; the catalog route is for a UI or operator. For a hosted deployment, use HTTPS and add authentication/authorization before allowing remote access.

## Current limitations

This is a hackathon starter, not ready for real donor records: uploaded datasets are stored in process memory and disappear at restart; there is no user authentication, tenant isolation, durable storage, retention policy, or production-grade identity resolution. Unstructured source text is sent to OpenAI for extraction; scoring sends a minimized profile without names, emails, or phone numbers. The dataset scoring tool makes one model call per donor and is capped at 25 records per call. Use synthetic data. Staff must review every duplicate and scoring result, and approve all outreach.

## Dependencies and keys

See [stat-mcp/DEPENDENCIES.md](stat-mcp/DEPENDENCIES.md) for the dependency ledger. The service declares FastMCP, OpenAI Agents SDK, OpenAI Python SDK, pandas, Pydantic, python-dotenv, and Starlette in `stat-mcp/pyproject.toml`. Copy the blank `stat-mcp/.env.example` to `.env` only if needed, then set `OPENAI_API_KEY`; never include it in browser code, tool output, or logs.
