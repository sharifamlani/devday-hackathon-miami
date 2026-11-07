"""Canonicalize structured donor data and detect common upload formats."""

from __future__ import annotations

import csv
import json
import re
from decimal import Decimal, InvalidOperation
from io import StringIO
from typing import Any
from uuid import uuid4

import pandas as pd
from pydantic import ValidationError

from stat_mcp.schemas import DonorRecord

MAX_UPLOAD_BYTES = 2_000_000
MAX_UNSTRUCTURED_TEXT_CHARS = 50_000
SUPPORTED_FIELDS = set(DonorRecord.model_fields)
FIELD_ALIASES = {
    "donor_id": "id",
    "record_id": "id",
    "name": "full_name",
    "donor": "full_name",
    "donor_name": "full_name",
    "full_name": "full_name",
    "constituent_name": "full_name",
    "email": "email_address",
    "phone": "phone_number",
    "contact_preferences": "contact_preference",
    "gift_total": "donation_amount",
    "total_giving": "donation_amount",
    "lifetime_giving": "donation_amount",
    "last_gift_date": "date_of_last_donation",
    "last_donation_date": "date_of_last_donation",
    "last_gift": "date_of_last_donation",
    "company": "organization",
    "employer_name": "employer",
    "interests": "stated_interests",
    "notes": "engagement_notes",
    "owner": "relationship_owner",
    "source_system": "source",
    "number_of_gifts": "gift_count",
}


def detect_format(content: str) -> str:
    """Recognize JSON and donor-shaped CSV headers; use text extraction otherwise."""

    first = content.lstrip()[:1]
    if first and first in "[{":
        return "json"
    first_line = content.splitlines()[0] if content.splitlines() else ""
    try:
        dialect = csv.Sniffer().sniff(first_line, delimiters=",\t;")
        headers = next(csv.reader([first_line], dialect))
    except csv.Error:
        return "text"
    known = SUPPORTED_FIELDS | set(FIELD_ALIASES)
    normalized_headers = {
        re.sub(r"[^a-z0-9]+", "_", item.strip().lower()).strip("_") for item in headers
    }
    return "csv" if len(headers) > 1 and normalized_headers.intersection(known) else "text"


def _missing(value: Any) -> bool:
    if value is None:
        return True
    return isinstance(value, str) and value.strip().casefold() in {
        "",
        "na",
        "n/a",
        "none",
        "null",
        "unknown",
        "not provided",
        "not available",
    }


def _canonical_row(row: dict[str, Any]) -> dict[str, Any]:
    normalized: dict[str, Any] = {}
    full_name: str | None = None
    for key, value in row.items():
        key_name = re.sub(r"[^a-z0-9]+", "_", str(key).strip().lower()).strip("_")
        key_name = FIELD_ALIASES.get(key_name, key_name)
        if key_name == "full_name":
            full_name = None if _missing(value) else str(value).strip()
        elif key_name in SUPPORTED_FIELDS:
            normalized[key_name] = None if _missing(value) else value

    if full_name and (_missing(normalized.get("first_name")) or _missing(normalized.get("last_name"))):
        parts = full_name.split(maxsplit=1)
        if _missing(normalized.get("first_name")):
            normalized["first_name"] = parts[0]
        if _missing(normalized.get("last_name")):
            normalized["last_name"] = parts[1] if len(parts) > 1 else ""

    string_limits = {
        "first_name": 100,
        "last_name": 100,
        "email_address": 320,
        "phone_number": 40,
        "date_of_last_donation": 40,
        "contact_preference": 200,
        "organization": 200,
        "employer": 200,
        "giving_history": 4000,
        "engagement_notes": 4000,
        "stated_interests": 2000,
        "relationship_owner": 200,
        "source": 200,
    }
    required_text_fields = {
        "first_name", "last_name", "email_address", "phone_number", "date_of_last_donation"
    }
    for field, limit in string_limits.items():
        value = normalized.get(field)
        normalized[field] = (
            "" if _missing(value) and field in required_text_fields
            else None if _missing(value)
            else str(value).strip()[:limit]
        )
    if _missing(normalized.get("id")) or len(str(normalized.get("id"))) > 100:
        normalized["id"] = str(uuid4())
    else:
        normalized["id"] = str(normalized["id"])

    amount = normalized.get("donation_amount")
    if not _missing(amount):
        try:
            amount_text = str(amount).replace("$", "").replace(",", "").strip()
            amount_decimal = Decimal(amount_text).quantize(Decimal("0.01"))
            normalized["donation_amount"] = (
                amount_decimal
                if amount_decimal >= 0 and len(amount_decimal.as_tuple().digits) <= 14
                else None
            )
        except InvalidOperation:
            normalized["donation_amount"] = None
    else:
        normalized["donation_amount"] = None
    if not _missing(normalized.get("gift_count")):
        try:
            count_decimal = Decimal(str(normalized["gift_count"]))
            normalized["gift_count"] = (
                int(count_decimal)
                if count_decimal >= 0 and count_decimal % 1 == 0
                else None
            )
        except (InvalidOperation, ValueError):
            normalized["gift_count"] = None
    return normalized


def _validate_rows(rows: list[dict[str, Any]]) -> tuple[list[DonorRecord], list[str]]:
    records: list[DonorRecord] = []
    warnings: list[str] = []
    for index, row in enumerate(rows, start=1):
        try:
            records.append(DonorRecord.model_validate(_canonical_row(row)))
        except ValidationError as exc:
            warnings.append(f"Row {index} had an invalid optional value; a blank record was emitted.")
            # Required output fields are blankable, so preserve a minimal record rather than drop it.
            records.append(DonorRecord(id=str(uuid4())))
    if not records:
        raise ValueError("No donor records were found in the upload.")
    return records, warnings


def parse_donor_records(content: str, file_format: str) -> tuple[list[DonorRecord], list[str]]:
    """Parse CSV/JSON, with pandas used for tabular input and Pydantic for each output row."""

    if not content.strip():
        raise ValueError("The uploaded file is empty.")
    if len(content.encode("utf-8")) > MAX_UPLOAD_BYTES:
        raise ValueError("The starter accepts uploads up to 2 MB. Split larger exports into smaller files.")
    format_name = detect_format(content) if file_format.lower().strip() == "auto" else file_format.lower().strip()
    if format_name == "csv":
        rows = (
            pd.read_csv(StringIO(content), sep=None, engine="python", dtype=str)
            .where(pd.notna, None)
            .to_dict("records")
        )
    elif format_name == "json":
        value = json.loads(content)
        if isinstance(value, dict):
            value = value.get("donors", value.get("records", [value]))
        if not isinstance(value, list) or any(not isinstance(row, dict) for row in value):
            raise ValueError("JSON must be an object, a list of donor objects, or {\"donors\": [...]}.")
        rows = value
    else:
        raise ValueError("Only CSV and JSON are parsed without AI; unstructured text uses the extractor.")
    return _validate_rows(rows)


def canonicalize_extracted_rows(rows: list[dict[str, Any]]) -> tuple[list[DonorRecord], list[str]]:
    """Normalize structured LLM extraction output and guarantee IDs plus required keys."""

    return _validate_rows(rows)
