/**
 * Example JavaScript MCP client for the donor-analysis tools.
 * Run from stat-mcp after starting the HTTP MCP server.
 * Requires @modelcontextprotocol/sdk (v1.x).
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { readFile } from "node:fs/promises";

const endpoint = new URL(process.env.STAT_MCP_URL ?? "http://127.0.0.1:8010/mcp");
const client = new Client({ name: "donor-demo-js", version: "1.0.0" });
const transport = new StreamableHTTPClientTransport(endpoint);
const scoreAll = process.argv.includes("--score-all");

// Stable columns for a UI/export. Criterion names come from the server's rubric catalog.
const BASE_COLUMNS = [
  "dataset_id", "record_index", "id", "first_name", "last_name",
  "email_address", "donation_amount", "phone_number", "contact_type", "date_of_last_donation",
  "contact_preference", "source", "organization", "employer", "gift_count",
  "giving_history", "engagement_notes", "stated_interests",
  "relationship_owner", "score", "score_label", "coverage",
  "assessed_criteria", "requested_criteria", "human_decision_required",
];

function toolResult(result) {
  if (result.isError) throw new Error(result.content?.map(x => x.text ?? "").join("\n"));
  const text = result.content?.find(x => x.type === "text")?.text;
  if (!text) return result.structuredContent ?? result;
  try { return JSON.parse(text); } catch { return text; }
}

async function call(name, args = {}) {
  return toolResult(await client.callTool({ name, arguments: args }));
}

async function main() {
  await client.connect(transport);
  const criteriaResponse = await call("get_suggested_scoring_criteria");
  const criteria = criteriaResponse.criteria;
  const files = [
    ["json", "sample-data/community-center.json"],
    ["csv", "sample-data/event-signups.csv"],
    ["text", "sample-data/staff-notes.txt"],
  ];

  const rows = [];
  for (const [format, path] of files) {
    const content = await readFile(new URL(path, import.meta.url), "utf8");
    const imported = await call("import_donor_data", {
      content,
      file_format: format,
      source_name: path.split("/").at(-1),
    });
    const datasetId = imported.dataset_id;
    const [summary, duplicates] = await Promise.all([
      call("summarize_donor_dataset", { dataset_id: datasetId }),
      call("suggest_duplicate_donors", { dataset_id: datasetId, threshold: 0.65 }),
    ]);
    // Default: bounded sample of 25 model calls per source. --score-all opts
    // into one model evaluation per source row (282 calls for this fixture).
    let scoredResults;
    if (scoreAll) {
      scoredResults = [];
      for (let recordIndex = 0; recordIndex < imported.person_count; recordIndex += 1) {
        scoredResults.push(await call("score_donor", {
          dataset_id: datasetId,
          record_index: recordIndex,
          criteria,
          opportunity_context: "Review fit for a staff-led follow-up about the community learning fund.",
        }));
      }
    } else {
      const scored = await call("score_donor_dataset", {
        dataset_id: datasetId,
        criteria,
        max_records: 25,
        opportunity_context: "Review fit for a staff-led follow-up about the community learning fund.",
      });
      scoredResults = scored.results ?? [];
    }

    console.log(JSON.stringify({ source: path, import: imported, summary, duplicates,
      scoring_mode: scoreAll ? "all_rows" : "first_25_per_source",
      scored_rows: scoredResults.length }, null, 2));
    for (const result of scoredResults) {
      const profileResult = await call("get_donor_profile", {
        dataset_id: datasetId,
        record_index: result.record_index,
      });
      const profile = profileResult.profile ?? {};
      const criterionColumns = Object.fromEntries((result.criteria ?? []).flatMap(item => [
        [`criterion_${item.criterion_id}_outcome`, item.outcome],
        [`criterion_${item.criterion_id}_rationale`, item.rationale],
        [`criterion_${item.criterion_id}_evidence`, (item.evidence ?? []).join(" | ")],
      ]));
      rows.push({
        dataset_id: datasetId,
        record_index: result.record_index,
        ...profile,
        score: result.score,
        score_label: result.score_label,
        coverage: result.coverage,
        assessed_criteria: result.assessed_criteria,
        requested_criteria: result.requested_criteria,
        human_decision_required: result.human_decision_required,
        ...criterionColumns,
      });
    }
  }

  // A row-per-donor shape plus deterministic column order makes this suitable
  // for a UI table or CSV serializer. Missing values remain null/empty, never 0.
  const criterionColumns = criteria.flatMap(({ id }) => [
    `criterion_${id}_outcome`, `criterion_${id}_rationale`, `criterion_${id}_evidence`,
  ]);
  const columns = [...BASE_COLUMNS, ...criterionColumns];
  const tableRows = rows.map(row => Object.fromEntries(
    columns.map(column => [column, row[column] ?? null]),
  ));
  console.log(JSON.stringify({ columns, rows: tableRows }, null, 2));
  await client.close();
}

main().catch(async error => {
  console.error(error);
  await client.close().catch(() => {});
  process.exitCode = 1;
});
