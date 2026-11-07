# `stat-mcp`: tool contracts and scoring guide

The user-requirements source is [Project 2: Duplicate donor records, and donors who quietly stop giving](../research/2.%20Duplicate%20donor%20records%2C%20and%20donors%20who%20quietly%20stop%20giving.md). It describes a small nonprofit team importing gifts from several channels, resolving likely duplicate people safely, and finding donors whose expected gifts are late. The app should reduce admin work while keeping staff in control.

## Tool surface

| Tool | Purpose | Important boundary |
| --- | --- | --- |
| `GET /tools` | List each registered MCP tool name and description as JSON for the UI. | Read-only catalog; actual MCP discovery is also available through `tools/list`. |
| `import_donor_data` | Parse one CSV/JSON/XLSX/DOCX/Markdown/text file, emit source events, then derive person summaries. Binary content is base64. | Text is sent to the configured OpenAI model; inspect warnings for table/prose overlap. |
| `import_donor_files` | Import 1–20 named base64 files in one call; supports the complete hackathon upload set. | Each file is limited to 20 MB and the batch to 50 MB; data remains in process memory. |
| `get_donor_transactions` | Page through preserved source events, including one row per explicitly stated gift. | Never combine multiple gifts into a total at import time. |
| `summarize_donor_dataset` | Report person/event counts and gift-level count/sum/mean/median/min/max from explicit gift events. | An absent gift is not evidence of payment failure. |
| `suggest_duplicate_donors` | Rank candidate pairs using exact email/phone and name similarity. | Suggestions only; never merge or alter records automatically. |
| `get_donor_profile` | Fetch one normalized donor row for the UI/backend. | Contains PII; the prototype has no user authentication yet, so use synthetic data only. |
| `get_donor_records` | Return a page of normalized donor rows for the UI/backend. | Contains PII; authorize the caller and do not pass entire pages into an LLM context. |
| `get_suggested_donor_fields` | Give the UI/agent a field catalog with labels, descriptions, and sensitivity guidance. | “Unknown” remains distinct from “no.” Do not infer protected or sensitive traits. |
| `get_suggested_scoring_criteria` | Provide editable sample criteria and rubric definitions to the UI/agent. | Examples are starting points; nonprofits set the actual criteria and thresholds. |
| `score_donor` | Evaluate one record against up to 12 criteria using one Agents SDK model call. | Omits name/email/phone from the scoring prompt; returns evidence-grounded assessments for staff review. |
| `score_donor_dataset` | Score up to 25 records sequentially, one model call per record. | Cost scales with records; records are not consolidated across source datasets. |
| `aggregate_donor_criterion_scores` | Average per-criterion `pass` / `fail` outcomes for one donor. | Equal weights; insufficient-evidence results are excluded from the mean and shown in coverage. |

## Ingestion contract

The user may upload `.csv`, `.json`, `.xlsx`, `.docx`, `.md` / `.markdown`, or `.txt` files. XLSX reads all worksheets; DOCX reads paragraphs and tables; Markdown reads prose and pipe tables. Binary files are base64-encoded for MCP transport; each file is limited to 20 MB and each batch to 50 MB. Narrative text is limited to 50,000 characters per extraction and uses the Agents SDK. See [REQUIRED_FIELDS.md](REQUIRED_FIELDS.md) for the transaction and derived person contracts.

```text
Jordan Lee donated $250 on August 3, 2026. Email jordan@example.org, phone (305) 555-0134.
```

The import's primary output is an event row. Each explicit gift has its own `transaction_id`, `amount`, and `transaction_date`, plus person identity, `contact_type`, channel, fund, and source location. Person summaries are grouped only through a source-scoped person key; same names or contact details remain separate duplicate candidates for human review. A summary's total is the sum of its explicit gift rows. A missing gift stays absent, not a zero-dollar transaction. See [REQUIRED_FIELDS.md](REQUIRED_FIELDS.md).

`import_donor_files` accepts `files: [{"name": "...xlsx", "content": "<base64>"}]`. `GET /tools` returns a JSON catalog and MCP clients can use `tools/list`. After import, `get_donor_transactions` returns source events and `get_donor_records` returns derived person summaries. The main app has no `/ingest` adapter yet; a future adapter should persist gift events to `gifts` and person projections to `donors`.

## Suggested criteria for a nonprofit-configured rubric

The agent evaluates every selected criterion independently and must cite the supplied profile evidence. The included starter suggestions are:

1. **Mission affinity:** the donor has an explicitly recorded interest or prior engagement aligned with this specific ask.
2. **Giving capacity evidence:** documented giving history or an organization-provided capacity indicator makes the proposed ask size plausible. Gift history is not personal wealth.
3. **Relationship and access:** a named staff/board relationship or a donor-initiated channel supports a respectful next step.
4. **Timing and readiness:** recent engagement, an upcoming relevant moment, or a donor-stated intention supports outreach now.
5. **Stewardship fit:** the organization can explain why this ask is relevant and provide an appropriate, personalized follow-up.

Use a structured assessment for each donor/criterion:

- `pass`: evidence supports the criterion.
- `fail`: available evidence contradicts the criterion.
- `insufficient_evidence`: the record does not let the reviewer decide.

The final score is `100 × passes / (passes + fails)`. The response also reports coverage, `assessed criteria / requested criteria`, so a high score based on one known criterion cannot masquerade as a complete review. The score is a **rubric fit / pursuit-priority aid**, not a probability of donating, a capacity estimate, or an automated decision. Staff choose weights and thresholds later if the organization has a defensible reason to use them.

## Annie Duke-inspired decision practice

The interface should show the evidence, uncertainty, decision owner, proposed next action, and (when available) the outcome for later review. The scoring tools accept an optional `opportunity_context` (for example, the campaign purpose and proposed ask) so the staff-defined rubric can evaluate an actual decision. Keep “quality of the decision given what we knew then” separate from “what happened afterward.” This borrows the uncertainty-aware process from Annie Duke's *Thinking in Bets*; the rubric itself is our product design, not a framework published by Annie Duke. Do not present the arithmetic rubric score as a calibrated probability unless historic, representative outcomes support calibration.

For high-value asks, show a decision card with: **what we know**, **what we do not know**, **why this donor is worth staff time now**, **low-risk next step**, and **what would change our mind**. A “pass” is a prompt for human consideration, never a send/ask instruction.

## UI/agent field suggestions

| Field | Use | Sensitivity / guardrail |
| --- | --- | --- |
| Name and preferred form of address | Personalize a staff-reviewed draft. | Restrict to necessary staff; do not guess pronouns. |
| Email/phone and contact preference | Contact through approved channels. | PII; keep out of logs and model prompts unless necessary. |
| Gift dates, amount, campaign, channel, recurring flag | Giving history, cadence, and context. | Financial data; no payment-card data in this system. |
| Stated interests and donor-authored notes | Evidence of mission fit. | Quote or cite source; avoid sensitive-trait inference. |
| Engagement history and event participation | Recency and relationship evidence. | Use only recorded interactions; expose source and date. |
| Relationship owner / introduction path | Identify a respectful internal next step. | Staff-entered; do not imply a personal relationship from a name match. |
| Ask amount, purpose, and date | Evaluate a particular opportunity. | Organization-supplied; distinguish proposed ask from past gift. |
| Source row, import batch, and update time | Future audit metadata. | Not currently stored as separate fields; add before using live multi-source data. |

Do not infer or score protected traits, health, religion, political views, family circumstances, wealth from lifestyle proxies, or likelihood to respond to pressure. Follow donor preferences and suppression lists. Keep outreach drafts editable and require human approval before sending.

## MVP limitations

Datasets are held in process memory and disappear when the server stops. Each imported source is a separate dataset; cross-source consolidation is not implemented. There is no authentication, tenant isolation, persistence, consent/purpose enforcement, or production-grade identity resolution. Unstructured source text is sent to the configured OpenAI model for extraction; scoring sends a minimized profile without name, email, or phone. The profile field allowlist is a guardrail, not a complete privacy system. Use synthetic data for the hackathon. Before using real records, obtain the nonprofit's approval for model processing and add authentication and per-dataset authorization, encrypted storage and retention controls, audit logging, organization-approved field/criteria configuration, and review by the nonprofit's data owner.

## Framework references

- [FastMCP 4 server tools](https://gofastmcp.com/docs/servers/tools)
- [FastMCP custom HTTP routes](https://gofastmcp.com/docs/deployment/running-server)
- [FastMCP HTTP deployment](https://gofastmcp.com/docs/deployment/http)
- [OpenAI Agents SDK MCP connections](https://openai.github.io/openai-agents-python/mcp/)
- [Annie Duke on decision making under uncertainty](https://www.annieduke.com/article-decision-making-by-thinking-in-bets-annie-duke/)
