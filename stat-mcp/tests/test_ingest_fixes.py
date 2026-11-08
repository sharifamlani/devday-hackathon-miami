"""One regression test per ingest bug fixed on fix/stat-mcp-ingest-bugs. No model calls."""

import asyncio
from decimal import Decimal
from io import BytesIO

import openpyxl
from docx import Document

from stat_mcp import agent
from stat_mcp.file_ingest import extract_file_transactions, parse_upload, rows_to_transactions
from stat_mcp.schemas import ExtractedTransaction, TransactionExtraction
from stat_mcp.transactions import normalize_date


def test_structured_amounts_parse_as_gifts():
    """Bug 1: Decimal was never imported, so every structured amount became 'invalid amount'."""
    events, warnings = rows_to_transactions(
        [{"name": "Ana Ruiz", "amount": "$1,250.00", "gift_date": "2025-03-04"}], "gifts.csv")
    assert events[0].transaction_type == "gift"
    assert events[0].amount == Decimal("1250.00")
    assert not any("invalid amount" in w for w in warnings)


def test_narrative_rows_with_unset_fields_and_name_only(monkeypatch):
    """Bug 2: None phone/email crashed validation; a name-only person was dropped."""

    async def fake_extract(text):
        return TransactionExtraction(transactions=[ExtractedTransaction(
            name="Rosa Mendez Vega", transaction_type="gift", contact_type="donor",
            amount=Decimal("500"), transaction_date="2026-06-01")])

    monkeypatch.setattr(agent, "extract_unstructured_transactions", fake_extract)
    _, events, _ = asyncio.run(extract_file_transactions("notes.txt", b"Rosa gave $500 on June 1."))
    assert (events[0].first_name, events[0].last_name) == ("Rosa", "Mendez Vega")
    assert (events[0].phone_number, events[0].email_address) == ("", "")


def test_email_or_phone_header_is_detected_and_routed():
    """Bug 3: an 'Email or phone' header (under a title row) was not recognized, so 0 rows were read."""
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.append(["COMMUNITY OPEN HOUSE - sign in please!!"])
    ws.append([])
    ws.append(["#", "Name", "Email or phone", "ZIP"])
    ws.append([1, "Svetlana Petrova", "svetlana@example.org", "33160"])
    ws.append([2, "Darnell Washington", "(305) 555-0180", "33147"])
    buf = BytesIO()
    wb.save(buf)

    parsed = parse_upload("signin.xlsx", buf.getvalue())
    events, _ = rows_to_transactions(parsed.rows, "signin.xlsx")
    assert [(e.email_address, e.phone_number) for e in events] == [
        ("svetlana@example.org", ""), ("", "(305) 555-0180")]


def test_non_iso_dates_normalize():
    """Bug 4: only ISO dates were accepted; US and month-name dates went to review."""
    assert normalize_date("11/17/2022") == "2022-11-17"
    assert normalize_date("Dec 19 2023") == "2023-12-19"
    assert normalize_date("March 3, 2024") == "2024-03-03"
    assert normalize_date("25/12/2024") == "2024-12-25"  # first part can only be a day
    assert normalize_date("Q3 2026") == "Q3 2026"        # unparseable text is preserved, not guessed


def test_donor_column_is_the_name():
    """Bug 5: a 'Donor' table header was detected but not mapped to a name."""
    doc = Document()
    table = doc.add_table(rows=2, cols=4)
    for cell, text in zip(table.rows[0].cells, ["Donor", "Check #", "Amount", "Date"]):
        cell.text = text
    for cell, text in zip(table.rows[1].cells, ["Carmen Ibarra", "4454", "$5,000.00", "07/02/2026"]):
        cell.text = text
    buf = BytesIO()
    doc.save(buf)

    parsed = parse_upload("checks.docx", buf.getvalue())
    events, _ = rows_to_transactions(parsed.rows, "checks.docx")
    assert events[0].full_name == "Carmen Ibarra"
    assert (events[0].amount, events[0].transaction_date) == (Decimal("5000.00"), "2026-07-02")
