# DonorSignal: current product plan

**Status:** backend MCP scaffold and synthetic examples exist locally. The frontend, server walkthrough, persistence, authentication, and cross-source donor consolidation are not complete. Delivery status lives in `ROADMAP.md`; the short demo path lives in `docs/demo-script.md`.

**Requirements source:** [Project 2: Duplicate donor records, and donors who quietly stop giving](research/2.%20Duplicate%20donor%20records%2C%20and%20donors%20who%20quietly%20stop%20giving.md).

## 1. Problem and goal

Small nonprofit teams receive donor information from multiple systems and notes. Staff spend time correcting records, checking likely duplicates, understanding gift history, and deciding which donors merit a personal follow-up. The product should make those facts easier to review without taking identity or outreach decisions away from staff.

**Current goal:** accept unstructured notes, CSV, or JSON; normalize donor records into a consistent schema; summarize stated giving data; suggest possible duplicates; and assess a donor against criteria chosen by the nonprofit.

The equal-weight criterion score is a **rubric-fit / staff-priority aid**, not a calibrated probability that a donor will give. Annie Duke's uncertainty-aware decision practice informs how evidence, unknowns, and eventual outcomes should be shown; it is not a donor-propensity model.

## 2. Canonical donor record

Every normalized record contains the following required fields:

| Field | Missing value behavior |
|---|---|
| `id` | Generate a UUID if absent or marked `NA`. |
| `first_name` | Empty string. |
| `last_name` | Empty string. |
| `email_address` | Empty string. |
| `donation_amount` | JSON `null`; never substitute zero for unknown. |
| `phone_number` | Empty string. |
| `date_of_last_donation` | Empty string. |

The complete field list, accepted source aliases, and JSON example are in [stat-mcp/REQUIRED_FIELDS.md](stat-mcp/REQUIRED_FIELDS.md). Recognized optional fields currently include contact preference, organization, employer, giving history, gift count, engagement notes, stated interests, relationship owner, and source.

## 3. Current user workflow

1. The application submits content to FastMCP's `import_donor_data` tool.
2. CSV/JSON inputs are parsed into the canonical schema. Unstructured prose is extracted by an OpenAI Agents SDK agent; unknown values remain empty or null, and missing IDs are generated.
3. The backend receives a dataset ID and import summary, then reads normalized rows in pages with `get_donor_records` for the UI.
4. `summarize_donor_dataset` reports statistics on provided donation amounts. `suggest_duplicate_donors` returns candidate pairs and evidence. Staff review every pair; no merge is performed.
5. The UI obtains suggested fields and criteria, then calls `score_donor` or bounded `score_donor_dataset` for a staff-defined opportunity.
6. The agent returns a pass/fail/insufficient-evidence assessment per criterion. Python calculates the equal-weight average and evidence coverage. Staff decide whether to pursue and approve any outreach.

See [stat-mcp/AGENT_INTEGRATION.md](stat-mcp/AGENT_INTEGRATION.md) for MCP transport, tool sequence, result shape, limits, and integration notes.

## 4. Current service architecture

```text
UI / server-side application agent (not implemented here)
        │ MCP Streamable HTTP
        ▼
FastMCP (`stat-mcp`)
  ├── Pydantic canonical schemas
  ├── pandas CSV parsing + descriptive statistics
  ├── deterministic duplicate candidate ranking
  ├── OpenAI Agents SDK extraction of unstructured text
  └── OpenAI Agents SDK per-donor criteria assessment
        └── deterministic equal-weight score + coverage
```

The service is run with `uv run python -m stat_mcp.server` from `stat-mcp/`. Its local MCP URL is `http://127.0.0.1:8000/mcp`; `GET /tools` returns tool metadata for a UI/operator. MCP clients should use normal MCP tool discovery. There is no separate FastAPI service in the current design.

## 5. Implemented MCP tools

- `import_donor_data`: CSV/JSON normalization or model-assisted unstructured text extraction.
- `get_donor_records`: paginated canonical records for the UI/backend (contains PII).
- `get_donor_profile`: fetch one normalized donor record (contains PII).
- `summarize_donor_dataset`: count, sum, mean, median, minimum, and maximum of recorded donation amounts.
- `suggest_duplicate_donors`: explainable pair candidates; never merges.
- `get_suggested_donor_fields` and `get_suggested_scoring_criteria`: metadata for the UI/agent.
- `score_donor`: one donor assessment.
- `score_donor_dataset`: at most 25 donor records per call, with one sequential model call per record.
- `aggregate_donor_criterion_scores`: calculate the score and coverage from provided assessments.
- `GET /tools`: HTTP JSON catalog of registered MCP tool names/descriptions.

The score tool accepts no more than 12 criteria at once. Each criterion has `id`, `label`, `question`, and optional `evidence_fields`. Results retain the criterion ID, outcome, rationale, evidence snippets, and optional confidence. Insufficient evidence is excluded from the score denominator and reflected in coverage.

## 6. Guardrails

- Keep duplicate detection advisory; a shared email/phone can describe a household.
- Missing gifts do not prove a failed payment or donor lapse.
- Never auto-merge records or send outreach.
- The scoring model sees a minimized profile without donor name/email/phone. The unstructured extractor receives the submitted text, which may contain personal data.
- Do not infer protected traits, health, religion, political views, family circumstances, wealth from lifestyle proxies, or intent to give.
- Use synthetic donor data until the nonprofit approves model processing and the service gains authentication, authorization, persistence, retention controls, and audit logging.
- Keep `OPENAI_API_KEY` on the server and out of browser code, tool output, and logs.

## 7. Not implemented yet

- Frontend upload/review/decision screens.
- Authentication, tenant isolation, and per-dataset authorization.
- Persistent dataset storage and retention/deletion policies.
- Cross-source identity consolidation or staff-approved merge workflow.
- Gift transaction ledger, personal giving-cadence calculations, and overdue-gift alerts.
- Lapsed-donor predictions or calibrated giving-probability estimates.
- Donor outreach drafting/sending.

The original challenge brief discusses lapsed gifts and the larger fundraising workflow; these features remain future work. The present implementation should not be described as already detecting lapsed donors or predicting gift likelihood.

## 8. Local setup

From `stat-mcp/`, run `uv sync`, set `OPENAI_API_KEY` in the ignored `.env`, and start the server:

```sh
uv run python -m stat_mcp.server
```

In a second terminal, the JavaScript MCP example is in `stat-mcp/examples/sample-call.mjs`; its usage and synthetic fixtures are documented in `stat-mcp/examples/README.md`.
