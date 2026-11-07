# Demo script: DonorSignal

**Current demo surface:** the FastMCP HTTP server and JavaScript sample client. A frontend is not in the repository yet. Use synthetic data only. Keep the live path small enough for the available demo time; use cached output only when clearly labeled.

**Demo length:** 60 seconds (event brief Q1 is unanswered).

| Seconds | Say | Show / do |
|---|---|---|
| 0:00–0:10 | “A donor record can arrive as a spreadsheet, JSON export, or a note. We turn those inputs into one consistent shape.” | Show a short synthetic staff note beside the returned canonical fields. |
| 0:10–0:25 | “Required fields are always present. Missing text stays blank, unknown donation amount stays null, and missing IDs are generated.” | Show `id`, first/last name, email, amount, phone, and last-donation date, including one missing-value example. |
| 0:25–0:40 | “The server summarizes reported giving and highlights possible duplicate records with its matching evidence.” | Show `summarize_donor_dataset` and one `suggest_duplicate_donors` result. Explain that this is a review suggestion. |
| 0:40–0:53 | “For a donor, the agent reviews the nonprofit’s criteria and shows its evidence. Unknowns remain unknown.” | Show one `score_donor` result with criterion outcome, rationale, evidence, score, and coverage. Label cached output if not live. |
| 0:53–1:00 | “This is a staff decision aid. It does not automatically merge records or contact donors.” | Show `GET /tools` or the final structured result. |

**Where the AI is visible:** the unstructured-text extraction output and per-criterion assessment rationale/evidence.

**If asked “where is the AI?”** The OpenAI Agents SDK extracts donor fields from narrative notes and evaluates the selected donor criteria.

**If asked “is that live?”** State whether each displayed extraction or assessment is live or cached; do not imply a cache is live.

**If asked “how do you know it is right?”** Show the source text and evidence; unknown fields and insufficient-evidence criteria are not turned into negative answers.

## Known limits to disclose

- There is no UI in the repository yet; the current integration example prints JSON from a JavaScript MCP client.
- Each import remains a separate in-memory dataset. Cross-source consolidation and merging are not implemented.
- The dataset scoring tool uses one model call per record. Use one donor for a short live demo; the sample batch mode is slower and costs more.
- Unstructured notes are sent to the configured OpenAI model. Use the fictional sample files.
- `/tools` is a tool catalog route, not an authenticated data API.
