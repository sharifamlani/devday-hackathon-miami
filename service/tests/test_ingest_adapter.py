"""Ingest adapter tests: converters (offline), the router (offline, injected extraction), and the
end-to-end run on data/sample_inputs/ graded against answer_key.json (needs OPENAI_API_KEY)."""

import io
import json
import os
import re
import sqlite3
import unicodedata
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from service import config, db, ingest_adapter as ia, ingest_router

SAMPLES = Path(__file__).resolve().parents[2] / "data" / "sample_inputs"
FILES = ["give_miami_day_export_2022-2025.xlsx", "board_retreat_notes.md", "check_deposit_log_q3_2026.docx",
         "donor_intake_forms_2026.docx", "stock_and_daf_grants.docx"]


# ------------------------------------------------------------------ converters

def test_xlsx_every_sheet_with_headers():
    import openpyxl

    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "A"
    ws.append(["Donor", "Amount", "Date"])
    ws.append(["Ann Lee", "$50", "3/4/2024"])
    ws2 = wb.create_sheet("B")
    ws2.append(["Name", "Gift", "When"])
    ws2.append(["Bo Ray", 75, "2025-01-02"])
    buf = io.BytesIO()
    wb.save(buf)
    text = ia.xlsx_to_text(buf.getvalue())
    assert "SHEET 'A'" in text and "SHEET 'B'" in text
    assert "row 2: Donor=Ann Lee | Amount=$50 | Date=3/4/2024" in text
    assert "Name=Bo Ray" in text


def test_docx_paragraphs_and_tables():
    import docx

    d = docx.Document()
    d.add_heading("Checks", 1)
    d.add_paragraph("Received by the front desk.")
    t = d.add_table(rows=2, cols=3)
    for j, h in enumerate(["Payer", "Amount", "Date"]):
        t.cell(0, j).text = h
    for j, v in enumerate(["Cy Wu", "$100", "7/1/2026"]):
        t.cell(1, j).text = v
    buf = io.BytesIO()
    d.save(buf)
    text = ia.docx_to_text(buf.getvalue())
    assert "## Checks" in text and "Received by the front desk." in text
    assert "table 1 row 1: Payer=Cy Wu | Amount=$100 | Date=7/1/2026" in text


def test_text_passthrough_and_unsupported():
    assert ia.convert_file("n.md", b"hello\n\nworld") == "line 1: hello\nline 3: world"
    assert ia.convert_file("d.json", b'{"a": 1}') == '{"a": 1}'
    assert ia.convert_file("d.csv", b"a,b\n1,2").startswith("row 1: a,b")
    with pytest.raises(ValueError):
        ia.convert_file("x.exe", b"")


def test_normalizers():
    assert ia.norm_email(" Maria.Delgado@Example.COM ") == "maria.delgado@example.com"
    assert ia.norm_email("not an email") is None
    assert ia.norm_phone("(305) 555-0101") == "305-555-0101"
    assert ia.norm_phone("1 305 555 0101") == "305-555-0101"
    assert ia.norm_amount("$1,250.50") == 1250.5 and ia.norm_amount("pledge") is None
    assert ia.norm_date("11/17/2022") == "2022-11-17" and ia.norm_date("Nov 17, 2022") == "2022-11-17"
    assert ia.norm_date("sometime") is None


def test_tab_rules():
    assert ia.decide_tab("auto", True, "neighbor", "") == ("giver", None)
    assert ia.decide_tab("auto", False, "community", "")[0] == "community"
    assert ia.decide_tab("auto", False, "neighbor", "")[0] == "neighbor"
    tab, review = ia.decide_tab("auto", False, "giver", "pledge")
    assert tab == "neighbor" and review
    assert ia.decide_tab("community", True, "giver", "") == ("community", None)


# ------------------------------------------------------------------ router + db, no network

def _fake_extraction():
    P, G = ia.PersonOut, ia.GiftOut
    return {("a.md", 0): ia.Extraction(
        people=[
            P(key="1", full_name="Ann Lee", donor_type="individual", emails=["Ann@Example.com"], phone="(305) 555-0101",
              contact_type="giver", contact_type_reason="gave", source_location="line 1"),
            P(key="2", full_name="Ann Lee", donor_type="individual", emails=["ann@example.com"],
              contact_type="giver", contact_type_reason="gave", source_location="line 2"),
            P(key="3", full_name="Dee Ortiz", donor_type="individual", contact_type="community",
              contact_type_reason="intake form", has_dog=True, interests=["gardening"], source_location="line 3"),
            P(key="4", full_name="Eli Fox", donor_type="individual", contact_type="giver",
              contact_type_reason="pledged", source_location="line 4"),
        ],
        gifts=[
            G(person_key="1", amount="$100", date="3/4/2024", location="line 1"),
            G(person_key="2", amount="$100", date="2024-03-04", location="line 1"),   # exact repeat of same row
            G(person_key="1", amount="$50", date="2025-03-04", location="line 5"),
            G(person_key="9", amount="$5", date="2025-03-04", location="line 6"),     # unknown person -> warning
        ])}


def test_ingest_texts_writes_db(tmp_path):
    conn = db.connect(tmp_path / "t.db")
    res = ia.ingest_texts({"a.md": "line 1: x"}, "auto", conn, extractions=_fake_extraction())
    assert res["people_added"] == 3 and res["gifts_added"] == 2
    assert res["by_tab"] == {"giver": 1, "neighbor": 1, "community": 1}
    assert [f["name"] for f in res["flagged_for_review"]] == ["Eli Fox"]
    assert len(res["warnings"]) == 1
    ann = conn.execute("SELECT * FROM donors WHERE full_name='Ann Lee'").fetchone()
    assert ann["email"] == "ann@example.com" and ann["phone"] == "305-555-0101" and ann["first_name"] == "Ann"
    cols = {r[1] for r in conn.execute("PRAGMA table_info(donors)")}
    if "contact_type" in cols:
        assert conn.execute("SELECT contact_type FROM donors WHERE full_name='Dee Ortiz'").fetchone()[0] == "community"
    assert conn.execute("SELECT COUNT(*) FROM donor_scores").fetchone()[0] == 3


def test_router_rejects_bad_target_and_reads_files(tmp_path, monkeypatch):
    monkeypatch.setenv("DONORS_DB", str(tmp_path / "r.db"))
    async def boom(*a, **k):
        raise RuntimeError("no network in this test")

    monkeypatch.setattr(ia, "_extract_chunk", boom)
    app = FastAPI()
    app.include_router(ingest_router.router)
    c = TestClient(app)
    assert c.post("/ingest", files=[("files", ("a.md", b"hi", "text/plain"))], data={"target": "bogus"}).status_code == 422
    r = c.post("/ingest", files=[("files", ("a.md", b"line", "text/plain")), ("files", ("b.exe", b"x", "x/y"))])
    assert r.status_code == 200
    body = r.json()
    assert body["people_added"] == 0
    assert any("b.exe" in w for w in body["warnings"]) and any("extraction failed" in w for w in body["warnings"])


# ------------------------------------------------------------------ end to end vs the answer key

def _ascii(s: str) -> str:
    return re.sub(r"[^a-z0-9 ]", "", unicodedata.normalize("NFKD", s or "").encode("ascii", "ignore").decode().lower())


needs_key = pytest.mark.skipif(not os.getenv("OPENAI_API_KEY"), reason="needs OPENAI_API_KEY")


@needs_key
def test_end_to_end_sample_inputs(tmp_path, monkeypatch):
    path = tmp_path / "e2e.db"
    monkeypatch.setenv("DONORS_DB", str(path))
    app = FastAPI()
    app.include_router(ingest_router.router)
    c = TestClient(app)
    files = [("files", (n, (SAMPLES / n).read_bytes(), "application/octet-stream")) for n in FILES]
    r = c.post("/ingest", files=files, data={"target": "auto"})
    assert r.status_code == 200, r.text
    body = r.json()
    print("\nRESPONSE:", json.dumps({k: v for k, v in body.items() if k != "flagged_for_review"}), "flagged:", len(body["flagged_for_review"]))

    key = json.loads((SAMPLES / "answer_key.json").read_text(encoding="utf-8"))
    t = key["totals"]
    conn = sqlite3.connect(path)
    n_people = conn.execute("SELECT COUNT(*) FROM donors").fetchone()[0]
    n_gifts, total = conn.execute("SELECT COUNT(*), COALESCE(SUM(amount),0) FROM gifts").fetchone()

    # every canonical donor found (by any email or by name tokens)
    rows = conn.execute("SELECT full_name, email, emails_all FROM donors").fetchall()
    emails = {e.lower() for _, em, al in rows for e in ([em] if em else []) + json.loads(al or "[]")}
    names = [_ascii(n) for n, _, _ in rows]
    found = 0
    for d in key["canonical_donors"]:
        hit = any(e.lower() in emails for e in d["emails_all"]) or any(
            _ascii(w) in names for w in d["names_as_written"] + [d["full_name"]])
        found += hit
    coverage = found / len(key["canonical_donors"])
    print(f"donors in db {n_people} vs key {t['canonical_donors']} (+{t['duplicate_groups']} fuzzy dup groups left for dedupe); "
          f"canonical coverage {found}/{len(key['canonical_donors'])}; gifts {n_gifts} vs {t['unique_gifts']}; "
          f"total {total:,.0f} vs {t['total_amount']:,}; seconds {body['seconds']}")
    # fuzzy duplicates are left for the dedupe step, so the donor count may exceed the canonical count
    assert t["canonical_donors"] <= n_people <= t["canonical_donors"] + 2 * t["duplicate_groups"]
    assert coverage >= 0.9
    assert abs(n_gifts - t["unique_gifts"]) <= 0.02 * t["unique_gifts"]
    assert abs(total - t["total_amount"]) <= 0.02 * t["total_amount"]
    # the answer key carries no tab labels, so tab accuracy is not graded; the split is printed above
    assert conn.execute("SELECT COUNT(*) FROM donor_scores").fetchone()[0] == n_people
    assert sum(body["by_tab"].values()) == n_people
