"""Readers for the full hackathon upload set: CSV, JSON, XLSX, DOCX, Markdown, and text."""

from __future__ import annotations

import json
import csv
import re
from dataclasses import dataclass
from decimal import Decimal
from io import BytesIO
from pathlib import PurePosixPath
from typing import Any
from uuid import NAMESPACE_URL, uuid4, uuid5

import pandas as pd
from docx import Document

from stat_mcp.schemas import ContactType, ImportedTransaction
from stat_mcp.transactions import is_iso_date, normalize_date

MAX_FILE_BYTES = 20_000_000
MAX_UNSTRUCTURED_TEXT_CHARS = 50_000
_AMOUNT_FIELDS = ("amount", "amt", "gift_amount", "donation_amount", "transaction_amount", "value_at_receipt")
_DATE_FIELDS = ("gift_date", "transaction_date", "donation_date", "date", "received", "received_date", "date_of_last_donation", "last_gift_date")


@dataclass
class ParsedUpload:
    format: str
    rows: list[dict[str, Any]]
    narrative: str
    warnings: list[str]


def _clean_key(value: object) -> str:
    return re.sub(r"[^a-z0-9]+", "_", str(value).strip().lower()).strip("_")


def detect_format(content: str) -> str:
    """Detect JSON, event-shaped CSV, or narrative text for legacy string callers."""

    stripped = content.lstrip()
    if stripped.startswith(("{", "[")):
        return "json"
    first_line = content.splitlines()[0] if content.splitlines() else ""
    try:
        dialect = csv.Sniffer().sniff(first_line, delimiters=",\t;")
        headers = {_clean_key(value) for value in next(csv.reader([first_line], dialect))}
    except csv.Error:
        return "text"
    known = {
        "id", "donor_id", "person_source_id", "contact_id", "name", "full_name",
        "donor_name", "first_name", "last_name", "email", "email_address", "phone",
        "phone_number", "amount", "gift_amount", "donation_amount", "transaction_amount",
        "gift_date", "transaction_date", "donation_date", "date", "contact_type",
        "transaction_type", "channel", "fund_type", "total_giving", "last_gift",
    }
    return "csv" if len(headers) > 1 and headers.intersection(known) else "text"


def _records_from_json(value: Any) -> list[dict[str, Any]]:
    if isinstance(value, dict):
        for key in ("transactions", "gifts", "records", "donors", "data"):
            if isinstance(value.get(key), list):
                value = value[key]
                break
        else:
            value = [value]
    if not isinstance(value, list) or any(not isinstance(row, dict) for row in value):
        raise ValueError("JSON must contain an object or a list of objects.")
    return value


def _header_row(values: list[object]) -> list[str] | None:
    headers = [_clean_key(value) if not _is_missing(value) else "" for value in values]
    names = {"name", "full_name", "donor", "donor_name", "donor_organization", "donor_or_organization", "person_name", "constituent_name"}
    amount_dates = set(_AMOUNT_FIELDS) | {"amt", "gift_total", "value_at_receipt"}
    contact = {"email", "email_address", "e_mail", "contact_email", "phone", "phone_number", "email_or_phone", "phone_or_email"}
    if any(item in names for item in headers) and (
        any(item in amount_dates for item in headers)
        or any(item in _DATE_FIELDS for item in headers)
        or any(item in contact for item in headers)
    ):
        return headers
    return None


def _headered_rows(rows: list[list[object]], source_prefix: str) -> list[dict[str, Any]]:
    result: list[dict[str, Any]] = []
    headers: list[str] | None = None
    for row_number, values in enumerate(rows, start=1):
        detected = _header_row(values)
        if detected:
            headers = detected
            continue
        if headers is None or all(_is_missing(value) for value in values):
            continue
        first_value = next((str(value).strip().casefold() for value in values if not _is_missing(value)), "")
        if re.match(r"^(sub)?total(s)?\b", first_value):
            continue
        record = {header: value for header, value in zip(headers, values) if header}
        if not any(not _is_missing(value) for value in record.values()):
            continue
        record["source_location"] = f"{source_prefix}:row:{row_number}"
        result.append(record)
    return result


def _markdown_tables(text: str) -> tuple[list[dict[str, str]], str]:
    lines = text.splitlines()
    rows: list[dict[str, str]] = []
    history_notes: list[str] = []
    table_lines: set[int] = set()
    index = 0
    while index + 1 < len(lines):
        if "|" not in lines[index] or not re.search(r"\|?\s*:?-{3,}", lines[index + 1]):
            index += 1
            continue
        headers = [cell.strip() for cell in lines[index].strip().strip("|").split("|")]
        table_lines.update({index, index + 1})
        index += 2
        while index < len(lines) and "|" in lines[index]:
            values = [cell.strip() for cell in lines[index].strip().strip("|").split("|")]
            if len(values) == len(headers):
                record = {
                        **dict(zip(headers, values, strict=True)),
                        "source_location": f"line:{index + 1}",
                    }
                rows.append(record)
                normalized = {_clean_key(key): value for key, value in record.items()}
                history = _value(normalized, "giving_history", "gift_history", "donation_history")
                if history:
                    person = _value(normalized, "name", "donor_name", "full_name", "email", "email_address") or "unknown person"
                    history_notes.append(f"line:{index + 1}: giving history for {person}: {history}")
            table_lines.add(index)
            index += 1
        index += 1
    narrative = "\n".join(
        f"line:{line_no}: {line}"
        for line_no, line in enumerate(lines, start=1)
        if line_no - 1 not in table_lines
    )
    narrative = "\n".join([narrative, *history_notes]).strip()
    return rows, narrative


def _docx_content(payload: bytes) -> tuple[list[dict[str, Any]], str]:
    document = Document(BytesIO(payload))
    narrative = "\n".join(
        f"paragraph:{index}: {paragraph.text}"
        for index, paragraph in enumerate(document.paragraphs, start=1)
        if paragraph.text.strip()
    )
    rows: list[dict[str, Any]] = []
    for table_index, table in enumerate(document.tables, start=1):
        if not table.rows:
            continue
        table_rows = [[cell.text.strip() for cell in row.cells] for row in table.rows]
        labels = {_clean_key(row[0]) for row in table_rows if row and row[0]}
        is_key_value_form = len(table_rows[0]) == 2 and len(table_rows) >= 3 and (
            bool(labels & {"name", "full_name", "donor", "donor_name"})
            and bool(labels & {"email", "email_address", "e_mail"})
        )
        if is_key_value_form:
            aliases = {
                "e_mail": "email", "contact_email": "email", "phone_number": "phone",
                "donor_type": "contact_type", "donation_amount": "amount",
                "giving_interests": "stated_interests",
            }
            record = {aliases.get(_clean_key(key), _clean_key(key)): value for key, value in table_rows if key.strip()}
            known = {"name", "full_name", "donor", "donor_name", "organization", "org_name", "email", "e_mail", "phone", "phone_number", "contact_type", "gift_amount", "amount", "donation_amount", "gift_date", "date_of_last_donation", "contact_preference", "interests", "giving_interests", "stated_interests", "notes", "relationship_owner", "city", "state", "fund_type", "gift_history", "giving_history"}
            extras = [f"{key}: {value}" for key, value in table_rows if _clean_key(key) not in known and value.strip()]
            if extras:
                record["notes"] = "; ".join(extras)[:4000]
            record["source_location"] = f"table:{table_index}:form"
            rows.append(record)
            history = _value(record, "giving_history", "gift_history", "donation_history")
            if history:
                person = _value(record, "name", "full_name", "email") or "unknown person"
                narrative += f"\ntable:{table_index}: giving history for {person}: {history}"
            continue
        headers = _header_row(table_rows[0])
        if headers is None:
            headers = [_clean_key(cell) for cell in table_rows[0]]
        if "value_at_receipt" in headers and "source" in headers:
            headers[headers.index("source")] = "organization"
        headers = ["channel" if item == "type" else item for item in headers]
        for row_index, values in enumerate(table_rows[1:], start=2):
            if len(values) == len(headers):
                rows.append({**dict(zip(headers, values, strict=True)), "source_location": f"table:{table_index}:row:{row_index}"})
    return rows, narrative


def parse_upload(filename: str, payload: bytes) -> ParsedUpload:
    """Read one complete file into structured rows and/or narrative text."""

    if not payload:
        raise ValueError("The uploaded file is empty.")
    if len(payload) > MAX_FILE_BYTES:
        raise ValueError("Files are limited to 20 MB each.")
    suffix = PurePosixPath(filename.replace("\\", "/")).suffix.lower()
    warnings: list[str] = []
    if suffix == ".csv":
        frame = pd.read_csv(BytesIO(payload), sep=None, engine="python", dtype=object)
        return ParsedUpload("csv", frame.where(pd.notna, None).to_dict("records"), "", warnings)
    if suffix == ".xlsx":
        sheets = pd.read_excel(BytesIO(payload), sheet_name=None, header=None, dtype=object)
        rows = []
        for sheet_name, frame in sheets.items():
            source_rows = frame.where(pd.notna, None).values.tolist()
            for row in _headered_rows(source_rows, f"sheet:{sheet_name}"):
                rows.append(row)
        if not rows:
            warnings.append("Workbook contained no data rows.")
        return ParsedUpload("xlsx", rows, "", warnings)
    if suffix == ".json":
        value = json.loads(payload.decode("utf-8-sig"))
        return ParsedUpload("json", _records_from_json(value), "", warnings)
    if suffix == ".docx":
        rows, narrative = _docx_content(payload)
        return ParsedUpload("docx", rows, narrative, warnings)
    if suffix in {".md", ".markdown"}:
        text = payload.decode("utf-8-sig")
        rows, narrative = _markdown_tables(text)
        return ParsedUpload("markdown", rows, narrative, warnings)
    if suffix in {".txt", ""}:
        text = payload.decode("utf-8-sig")
        numbered = "\n".join(f"line:{line_no}: {line}" for line_no, line in enumerate(text.splitlines(), start=1))
        return ParsedUpload("text", [], numbered, warnings)
    raise ValueError("Supported files are .csv, .json, .xlsx, .docx, .md, .markdown, and .txt.")


def _is_missing(value: object) -> bool:
    if value is None:
        return True
    try:
        if pd.isna(value):
            return True
    except (TypeError, ValueError):
        pass
    return str(value).strip().casefold() in {"", "na", "n/a", "none", "null", "unknown", "nan"}


def _value(row: dict[str, Any], *names: str) -> Any:
    for name in names:
        value = row.get(name)
        if not _is_missing(value):
            return value
    return None


def _text(row: dict[str, Any], *names: str, limit: int) -> str | None:
    value = _value(row, *names)
    return str(value).strip()[:limit] if value is not None else None


def rows_to_transactions(rows: list[dict[str, Any]], source_name: str) -> tuple[list[ImportedTransaction], list[str]]:
    """Normalize source rows as events; a gift requires an explicit amount, never a lifetime total."""

    transactions: list[ImportedTransaction] = []
    warnings: list[str] = []
    for row_number, raw in enumerate(rows, start=1):
        row = {_clean_key(key): value for key, value in raw.items()}
        full_name = _value(row, "full_name", "name", "donor_name", "person_name", "constituent_name")
        first = _text(row, "first_name", limit=100) or ""
        last = _text(row, "last_name", limit=100) or ""
        if full_name and not first and not last:
            pieces = str(full_name).split(maxsplit=1)
            first, last = pieces[0], pieces[1] if len(pieces) > 1 else ""
        amount_value = _value(row, *_AMOUNT_FIELDS)
        amount: Decimal | None = None
        if amount_value is not None:
            try:
                amount = Decimal(str(amount_value).replace("$", "").replace(",", "").strip()).quantize(Decimal("0.01"))
                if amount < 0:
                    raise ValueError
            except Exception:
                warnings.append(f"Source row {row_number}: invalid amount retained as an unknown event.")
                amount = None
        date_value = _value(row, *_DATE_FIELDS)
        event_type = str(_value(row, "transaction_type", "event_type") or ("gift" if amount is not None else "profile")).strip().lower()
        if event_type not in {"gift", "profile", "contact", "benefit"}:
            warnings.append(f"Source row {row_number}: unknown event type '{event_type}', retained as profile.")
            event_type = "profile"
        raw_contact_type = str(_value(row, "contact_type") or ("donor" if event_type == "gift" else "contact")).strip().lower()
        try:
            contact_type = ContactType(raw_contact_type)
        except ValueError:
            warnings.append(f"Source row {row_number}: invalid contact_type; defaulted to contact.")
            contact_type = ContactType.CONTACT
        source_location = _text(row, "source_location", "source_row", limit=300) or f"row:{row_number}"
        source_id = _text(row, "person_source_id", "donor_id", "contact_id", "id", limit=100)
        source_transaction_id = _text(row, "source_transaction_id", "transaction_id", "gift_id", "payment_id", limit=100)
        transaction_date = normalize_date(date_value)
        email = _text(row, "email_address", "email", "e_mail", "contact_email", limit=320) or ""
        phone = _text(row, "phone_number", "phone", limit=40) or ""
        either = _text(row, "email_or_phone", "phone_or_email", limit=320)
        if either and not email and "@" in either:
            email = either
        elif either and not phone and "@" not in either:
            phone = either[:40]
        if event_type == "gift" and (amount is None or not is_iso_date(transaction_date)):
            warnings.append(
                f"Source row {row_number}: gift amount is missing or date is not ISO; review before inserting into the SQLite gifts table."
            )
        transactions.append(
            ImportedTransaction(
                person_source_id=source_id,
                source_transaction_id=source_transaction_id,
                person_group_key=source_id or str(uuid4()),
                contact_type=contact_type,
                first_name=first[:100],
                last_name=last[:100],
                organization=_text(row, "organization", "org_name", "company", "donor_organization", "donor_or_organization", limit=200),
                email_address=email,
                phone_number=phone,
                transaction_type=event_type,
                amount=amount,
                transaction_date=transaction_date,
                channel=_text(row, "channel", "payment_method", "event_name", "type", limit=200),
                fund_type=_text(row, "fund_type", "fund", "fund_designation", limit=200),
                notes=_text(row, "notes", "engagement_notes", "description", "memo", "comments", "giving_history", "gift_history", limit=4000),
                source_name=source_name[:200],
                source_location=str(source_location)[:300],
            )
        )
    return transactions, warnings


async def extract_file_transactions(
    filename: str, payload: bytes
) -> tuple[str, list[ImportedTransaction], list[str]]:
    """Library entry point for an application adapter; never starts the MCP server."""

    parsed = parse_upload(filename, payload)
    transactions, warnings = rows_to_transactions(parsed.rows, filename)
    warnings.extend(parsed.warnings)
    if parsed.narrative.strip():
        if len(parsed.narrative) > MAX_UNSTRUCTURED_TEXT_CHARS:
            raise ValueError(
                f"{filename}: extracted narrative exceeds 50,000 characters; split the file before import."
            )
        from stat_mcp.agent import extract_unstructured_transactions

        extracted = await extract_unstructured_transactions(parsed.narrative)
        for index, item in enumerate(extracted.transactions, start=1):
            if item.transaction_type == "gift" and (item.amount is None or not is_iso_date(item.transaction_date)):
                warnings.append(
                    f"Extracted narrative event {index}: gift amount is missing or date is not ISO; review before inserting into SQLite."
                )
        for item in extracted.transactions:
            # Unset extractor fields fall back to ImportedTransaction defaults ("" for names/email/phone)
            fields = item.model_dump(exclude_none=True)
            name = fields.pop("name", None)
            if name and not fields.get("first_name") and not fields.get("last_name"):
                first, _, last = name.strip().partition(" ")
                fields.update(first_name=first[:100], last_name=last.strip()[:100])
            transactions.append(ImportedTransaction(**fields, source_name=filename[:200]))
        if parsed.rows:
            warnings.append(
                "This document contained both narrative and tables; review for repeated events before database import."
            )
    if not transactions:
        raise ValueError("No people or transaction events were found in the uploaded file.")
    scope_id = str(uuid4())
    for transaction in transactions:
        local_key = transaction.person_group_key or transaction.person_source_id or transaction.transaction_id
        transaction.person_group_key = str(uuid5(NAMESPACE_URL, f"{scope_id}:{local_key}"))
    return parsed.format, transactions, warnings
