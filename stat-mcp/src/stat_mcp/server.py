"""FastMCP server exposing donor import, duplicate review, and scoring helpers."""

from __future__ import annotations

import os
from uuid import uuid4

from dotenv import load_dotenv
from fastmcp import FastMCP
from starlette.requests import Request
from starlette.responses import JSONResponse

from stat_mcp.analysis import aggregate_assessments, duplicate_candidates, summarize_giving
from stat_mcp.agent import (
    evaluate_donor_criteria as run_donor_evaluation,
    extract_unstructured_donors,
)
from stat_mcp.criteria import SUGGESTED_CRITERIA, SUGGESTED_FIELDS
from stat_mcp.ingest import (
    MAX_UNSTRUCTURED_TEXT_CHARS,
    MAX_UPLOAD_BYTES,
    canonicalize_extracted_rows,
    detect_format,
    parse_donor_records,
)
from stat_mcp.schemas import CriterionDefinition, DonorAssessment, UploadedDataset, safe_profile

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
    content: str,
    file_format: str = "auto",
    source_name: str = "upload",
) -> dict[str, object]:
    """Extract or parse donor data, normalize required fields, and save a temporary dataset."""

    if not content.strip():
        raise ValueError("The uploaded file is empty.")
    if len(content.encode("utf-8")) > MAX_UPLOAD_BYTES:
        raise ValueError("The starter accepts uploads up to 2 MB. Split larger exports into smaller files.")
    requested_format = file_format.lower().strip()
    resolved_format = detect_format(content) if requested_format == "auto" else requested_format
    if resolved_format in {"txt", "plain_text"}:
        resolved_format = "text"
    if resolved_format == "text":
        if len(content) > MAX_UNSTRUCTURED_TEXT_CHARS:
            raise ValueError("Unstructured text is limited to 50,000 characters per extraction.")
        extraction = await extract_unstructured_donors(content)
        records, warnings = canonicalize_extracted_rows(
            [donor.model_dump(exclude_none=False) for donor in extraction.donors]
        )
    elif resolved_format in {"csv", "json"}:
        records, warnings = parse_donor_records(content, resolved_format)
    else:
        raise ValueError("file_format must be auto, csv, json, or text.")
    dataset_id = str(uuid4())
    dataset = UploadedDataset(
        dataset_id=dataset_id,
        source_name=source_name[:200],
        source_format=resolved_format,
        records=records,
        warnings=warnings,
    )
    DATASETS[dataset_id] = dataset
    return {
        "dataset_id": dataset_id,
        "source_name": dataset.source_name,
        "source_format": dataset.source_format,
        "valid_rows": len(records),
        "warnings": warnings,
        "available_fields": sorted(
            {
                key
                for record in records
                for key, value in safe_profile(record).items()
                if value is not None and value != ""
            }
        ),
        "required_fields": [
            "first_name",
            "last_name",
            "email_address",
            "donation_amount",
            "phone_number",
            "date_of_last_donation",
            "id",
        ],
        "missing_value_policy": "empty strings for text; null for donation_amount; UUID generated for missing id",
        "storage": "in_memory_until_server_restart",
    }


@mcp.tool
def summarize_donor_dataset(dataset_id: str) -> dict[str, object]:
    """Summarize imported rows and reported gifts without exposing full records."""

    dataset = _get_dataset(dataset_id)
    gift_summary = summarize_giving(dataset.records)
    return {
        "dataset_id": dataset_id,
        "source_name": dataset.source_name,
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
    """Run the MCP service using Streamable HTTP (default local endpoint /mcp)."""

    host = os.getenv("STAT_MCP_HOST", "127.0.0.1")
    port = int(os.getenv("STAT_MCP_PORT", "8000"))
    mcp.run(transport="http", host=host, port=port)


if __name__ == "__main__":
    main()
