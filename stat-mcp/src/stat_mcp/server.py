"""FastMCP server exposing donor import, duplicate review, and scoring helpers."""

from __future__ import annotations

import base64
import binascii
import os
from uuid import uuid4

from dotenv import load_dotenv
from fastmcp import FastMCP
from starlette.requests import Request
from starlette.responses import JSONResponse

from stat_mcp.analysis import aggregate_assessments, duplicate_candidates, summarize_giving
from stat_mcp.agent import (
    evaluate_donor_criteria as run_donor_evaluation,
)
from stat_mcp.criteria import SUGGESTED_CRITERIA, SUGGESTED_FIELDS
from stat_mcp.file_ingest import MAX_FILE_BYTES, detect_format, extract_file_transactions
from stat_mcp.schemas import (
    CriterionDefinition,
    DonorAssessment,
    ImportedTransaction,
    UploadedDataset,
    safe_profile,
)
from stat_mcp.transactions import project_people

load_dotenv()

mcp = FastMCP("stat-mcp")
DATASETS: dict[str, UploadedDataset] = {}


def _get_dataset(dataset_id: str) -> UploadedDataset:
    try:
        return DATASETS[dataset_id]
    except KeyError as exc:
        raise ValueError("Dataset not found. Import it again; demo datasets are process-local.") from exc


@mcp.custom_route("/tools", methods=["GET"])
async def tools_overview(_request: Request) -> JSONResponse:
    """Return a plain HTTP catalog; MCP clients can also use the native tools/list method."""

    tools = await mcp.list_tools()
    return JSONResponse(
        {
            "server": "stat-mcp",
            "mcp_endpoint": "/mcp",
            "count": len(tools),
            "tools": [
                {"name": tool.name, "description": tool.description or ""} for tool in tools
            ],
        }
    )


@mcp.tool
async def import_donor_data(
    content: str = "",
    file_format: str = "auto",
    source_name: str = "upload",
    content_base64: str | None = None,
) -> dict[str, object]:
    """Import one file as source events; donor/person records are derived from those events.

    Binary files must be base64-encoded in ``content_base64``. Plain-text callers remain supported.
    """

    if content_base64 is not None:
        try:
            payload = base64.b64decode(content_base64, validate=True)
        except (binascii.Error, ValueError) as exc:
            raise ValueError("content_base64 must be valid base64.") from exc
        if len(payload) > MAX_FILE_BYTES:
            raise ValueError("Files are limited to 20 MB each.")
        filename = source_name
    else:
        if not content.strip():
            raise ValueError("The uploaded file is empty.")
        requested_format = file_format.lower().strip()
        resolved_format = detect_format(content) if requested_format == "auto" else requested_format
        extension = {
            "txt": ".txt", "text": ".txt", "plain_text": ".txt", "markdown": ".md",
            "md": ".md", "csv": ".csv", "json": ".json", "xlsx": ".xlsx", "docx": ".docx",
        }.get(resolved_format)
        if extension is None:
            raise ValueError("Supported formats are CSV, JSON, XLSX, DOCX, Markdown, and text.")
        filename = source_name if "." in source_name.rsplit("/", 1)[-1] else f"{source_name}{extension}"
        payload = content.encode("utf-8")
    resolved_format, transactions, warnings = await extract_file_transactions(filename, payload)
    return _store_transaction_dataset(source_name, resolved_format, transactions, warnings)


@mcp.tool
async def import_donor_files(files: list[dict[str, str]]) -> dict[str, object]:
    """Import a batch of files; each file item has ``name`` and base64-encoded ``content``."""

    if not files or len(files) > 20:
        raise ValueError("Provide between 1 and 20 files per import.")
    transactions: list[ImportedTransaction] = []
    warnings: list[str] = []
    formats = []
    source_names = []
    total_bytes = 0
    for item in files:
        name = item.get("name", "")
        encoded = item.get("content", "")
        if not name or not encoded:
            raise ValueError("Each file requires a name and base64 content.")
        try:
            payload = base64.b64decode(encoded, validate=True)
        except (binascii.Error, ValueError) as exc:
            raise ValueError(f"{name}: content must be valid base64.") from exc
        if len(payload) > MAX_FILE_BYTES:
            raise ValueError(f"{name}: files are limited to 20 MB each.")
        total_bytes += len(payload)
        if total_bytes > 50_000_000:
            raise ValueError("Combined file size is limited to 50 MB per batch.")
        file_format, file_transactions, file_warnings = await extract_file_transactions(name, payload)
        formats.append(file_format)
        source_names.append(name)
        transactions.extend(file_transactions)
        warnings.extend(f"{name}: {warning}" for warning in file_warnings)
    return _store_transaction_dataset(
        source_name=", ".join(source_names),
        source_format=formats[0] if len(set(formats)) == 1 else "mixed",
        transactions=transactions,
        warnings=warnings,
    )


def _store_transaction_dataset(
    source_name: str,
    source_format: str,
    transactions: list[ImportedTransaction],
    warnings: list[str],
) -> dict[str, object]:
    if not transactions:
        raise ValueError("No people or transaction events were found in the uploaded files.")
    records = project_people(transactions)
    dataset_id = str(uuid4())
    dataset = UploadedDataset(
        dataset_id=dataset_id,
        source_name=source_name[:200],
        source_format=source_format,
        records=records,
        transactions=transactions,
        warnings=warnings,
    )
    DATASETS[dataset_id] = dataset
    return {
        "dataset_id": dataset_id,
        "source_name": dataset.source_name,
        "source_format": dataset.source_format,
        "valid_rows": len(transactions),
        "transaction_count": len(transactions),
        "gift_count": sum(1 for row in transactions if row.transaction_type == "gift"),
        "person_count": len(records),
        "warnings": warnings,
        "available_fields": sorted(
            {
                key
                for record in records
                for key, value in safe_profile(record).items()
                if value is not None and value != ""
            }
        ),
        "event_fields": [
            "transaction_id", "source_transaction_id", "person_source_id", "person_group_key",
            "contact_type", "transaction_type",
            "amount", "transaction_date", "source_name", "source_location",
        ],
        "missing_value_policy": "unknown amounts and dates remain null; no gift is inferred",
        "person_projection": "people are grouped from source identity; amounts sum explicit gift events",
        "storage": "in_memory_until_server_restart",
    }


@mcp.tool
def get_donor_transactions(dataset_id: str, offset: int = 0, limit: int = 50) -> dict[str, object]:
    """Return source events, one row per explicit gift or non-gift profile event."""

    dataset = _get_dataset(dataset_id)
    if offset < 0:
        raise ValueError("offset must be zero or greater.")
    if not 1 <= limit <= 200:
        raise ValueError("limit must be between 1 and 200.")
    page = dataset.transactions[offset : offset + limit]
    return {
        "dataset_id": dataset_id,
        "offset": offset,
        "limit": limit,
        "total": len(dataset.transactions),
        "transactions": [item.model_dump(mode="json") for item in page],
    }


@mcp.tool
def summarize_donor_dataset(dataset_id: str) -> dict[str, object]:
    """Summarize imported rows and reported gifts without exposing full records."""

    dataset = _get_dataset(dataset_id)
    gift_summary = summarize_giving(dataset.transactions)
    return {
        "dataset_id": dataset_id,
        "source_name": dataset.source_name,
        "transaction_count": len(dataset.transactions),
        "record_count": len(dataset.records),
        "fields": sorted(
            {
                key
                for record in dataset.records
                for key, value in safe_profile(record).items()
                if value is not None and value != ""
            }
        ),
        **gift_summary,
        "warnings": dataset.warnings,
        "note": "Missing gifts in this import do not establish a failed payment or lapsed donor.",
    }


@mcp.tool
def suggest_duplicate_donors(dataset_id: str, threshold: float = 0.65) -> dict[str, object]:
    """Return ranked duplicate candidates for staff review; never merge automatically."""

    dataset = _get_dataset(dataset_id)
    pairs = duplicate_candidates(dataset.records, threshold)
    return {
        "dataset_id": dataset_id,
        "candidate_count": len(pairs),
        "candidates": pairs,
        "decision": "human_review_required",
        "warning": "A shared email/phone can belong to a household; verify before merging.",
    }


@mcp.tool
def get_donor_profile(dataset_id: str, record_index: int) -> dict[str, object]:
    """Return an allowlisted profile row for a single donor scoring request."""

    dataset = _get_dataset(dataset_id)
    if not 0 <= record_index < len(dataset.records):
        raise ValueError(f"record_index must be between 0 and {len(dataset.records) - 1}")
    record = dataset.records[record_index]
    profile = safe_profile(record)
    return {"dataset_id": dataset_id, "record_index": record_index, "profile": profile}


@mcp.tool
def get_donor_records(dataset_id: str, offset: int = 0, limit: int = 20) -> dict[str, object]:
    """Return a page of normalized donor records for the authorized UI/backend."""

    dataset = _get_dataset(dataset_id)
    if offset < 0:
        raise ValueError("offset must be zero or greater.")
    if not 1 <= limit <= 50:
        raise ValueError("limit must be between 1 and 50.")
    end = min(offset + limit, len(dataset.records))
    return {
        "dataset_id": dataset_id,
        "offset": offset,
        "limit": limit,
        "total_records": len(dataset.records),
        "next_offset": end if end < len(dataset.records) else None,
        "records": [safe_profile(record) for record in dataset.records[offset:end]],
        "contains_personal_data": True,
    }


@mcp.tool
def get_suggested_donor_fields() -> list[dict[str, str]]:
    """Return suggested donor fields and sensitivity guidance for the UI/agent."""

    return SUGGESTED_FIELDS


@mcp.tool
def get_suggested_scoring_criteria() -> dict[str, object]:
    """Return example criteria; the nonprofit should choose and edit its rubric."""

    return {
        "criteria": SUGGESTED_CRITERIA,
        "outcomes": ["pass", "fail", "insufficient_evidence"],
        "aggregation": "equal_weight_mean_of_pass_fail_assessments",
        "meaning": "rubric fit / staff pursuit-priority aid; not a giving probability",
        "human_review_required": True,
    }


async def _score_record(
    dataset: UploadedDataset,
    dataset_id: str,
    record_index: int,
    criteria: list[CriterionDefinition],
    opportunity_context: str | None = None,
) -> dict[str, object]:
    record = dataset.records[record_index]
    donor_id = record.id
    # Contact fields and arbitrary imported columns never enter the model prompt.
    allowed_evidence = {
        "donor_id",
        "organization",
        "giving_history",
        "donation_amount",
        "gift_count",
        "date_of_last_donation",
        "engagement_notes",
        "stated_interests",
        "relationship_owner",
        "contact_preference",
        "source",
    }
    profile = {key: value for key, value in safe_profile(record).items() if key in allowed_evidence}
    profile["donor_id"] = donor_id
    profile["contact_channel_available"] = bool(record.email_address or record.phone_number)
    evaluation = await run_donor_evaluation(
        profile,
        [item.model_dump() for item in criteria],
        opportunity_context=opportunity_context,
    )
    result = aggregate_assessments(
        donor_id,
        [DonorAssessment(donor_id=donor_id, assessments=evaluation.assessments)],
        [item.id for item in criteria],
    )
    return {"record_index": record_index, **result}


@mcp.tool
async def score_donor(
    dataset_id: str,
    record_index: int,
    criteria: list[CriterionDefinition] | None = None,
    opportunity_context: str | None = None,
) -> dict[str, object]:
    """Use an Agents SDK LLM call to assess one donor against each selected criterion."""

    dataset = _get_dataset(dataset_id)
    if not 0 <= record_index < len(dataset.records):
        raise ValueError(f"record_index must be between 0 and {len(dataset.records) - 1}")
    selected = criteria or [CriterionDefinition.model_validate(item) for item in SUGGESTED_CRITERIA]
    if len(selected) > 12:
        raise ValueError("Select no more than 12 criteria per donor.")
    if opportunity_context and len(opportunity_context) > 1000:
        raise ValueError("opportunity_context must be 1,000 characters or fewer.")
    return await _score_record(dataset, dataset_id, record_index, selected, opportunity_context)


@mcp.tool
async def score_donor_dataset(
    dataset_id: str,
    criteria: list[CriterionDefinition] | None = None,
    max_records: int = 10,
    opportunity_context: str | None = None,
) -> dict[str, object]:
    """Score a small dataset with one model evaluation per donor; bounded to control cost."""

    dataset = _get_dataset(dataset_id)
    if not 1 <= max_records <= 25:
        raise ValueError("max_records must be between 1 and 25 per request.")
    selected = criteria or [CriterionDefinition.model_validate(item) for item in SUGGESTED_CRITERIA]
    if len(selected) > 12:
        raise ValueError("Select no more than 12 criteria per donor.")
    if opportunity_context and len(opportunity_context) > 1000:
        raise ValueError("opportunity_context must be 1,000 characters or fewer.")
    limit = min(len(dataset.records), max_records)
    scored = []
    for record_index in range(limit):
        scored.append(await _score_record(dataset, dataset_id, record_index, selected, opportunity_context))
    return {
        "dataset_id": dataset_id,
        "scored_records": len(scored),
        "total_records": len(dataset.records),
        "truncated": len(scored) < len(dataset.records),
        "model_calls": len(scored),
        "results": scored,
        "note": "Each result is a rubric-fit aid, not a probability of giving; staff review every result.",
    }


@mcp.tool
def aggregate_donor_criterion_scores(
    donor_id: str,
    requested_criteria: list[str],
    assessments: list[dict[str, object]],
) -> dict[str, object]:
    """Average per-criterion results; pass/fail only, with explicit evidence coverage."""

    parsed = [DonorAssessment.model_validate(item) for item in assessments]
    return aggregate_assessments(donor_id, parsed, requested_criteria)


def main() -> None:
    """Run the MCP service using Streamable HTTP on port 8010 by default."""

    host = os.getenv("STAT_MCP_HOST", "127.0.0.1")
    port = int(os.getenv("STAT_MCP_PORT", "8010"))
    mcp.run(transport="http", host=host, port=port)


if __name__ == "__main__":
    main()
