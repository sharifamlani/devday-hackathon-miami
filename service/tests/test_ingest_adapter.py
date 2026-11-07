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
FILES = json.loads((SAMPLES / "answer_key.json").read_text(encoding="utf-8"))["files"]


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


def _declined_extraction():
    P, G = ia.PersonOut, ia.GiftOut
    return {("a.md", 0): ia.Extraction(
        people=[P(key="1", full_name="Hye Park", donor_type="individual", contact_type="giver",
                  contact_type_reason="gave", source_location="row 1")],
        gifts=[G(person_key="1", amount="$40", date="2026-10-10", location="row 1"),
               G(person_key="1", amount="$40", date="2026-11-10", status="declined", location="row 2")])}


def test_declined_charge_stored_with_status_when_column_exists(tmp_path):
    conn = db.connect(tmp_path / "s.db")
    db.create_schema(conn)
    conn.execute("ALTER TABLE gifts ADD COLUMN status TEXT NOT NULL DEFAULT 'ok'")
    res = ia.ingest_texts({"a.md": "row 1: x"}, "auto", conn, extractions=_declined_extraction())
    assert res["gifts_added"] == 2
    assert [r[0] for r in conn.execute("SELECT status FROM gifts ORDER BY gift_date")] == ["ok", "declined"]


def test_declined_charge_skipped_when_column_absent(tmp_path):
    conn = db.connect(tmp_path / "n.db")
    res = ia.ingest_texts({"a.md": "row 1: x"}, "auto", conn, extractions=_declined_extraction())
    assert res["gifts_added"] == 1 and any("declined" in w for w in res["warnings"])


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


needs_3tab_inputs = pytest.mark.skipif(
    "people" not in json.loads((SAMPLES / "answer_key.json").read_text(encoding="utf-8")),
    reason="needs the 3-tab sample inputs and answer key (PR #44)")


@needs_key
@needs_3tab_inputs
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
    print("\nRESPONSE:", json.dumps({k: v for k, v in body.items() if k != "flagged_for_review"}))

    key = json.loads((SAMPLES / "answer_key.json").read_text(encoding="utf-8"))
    t = key["totals"]
    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    n_people = conn.execute("SELECT COUNT(*) FROM donors").fetchone()[0]
    has_status = "status" in {r[1] for r in conn.execute("PRAGMA table_info(gifts)")}
    ok = " WHERE status = 'ok'" if has_status else ""   # declined/failed charges are excluded from totals
    n_gifts, total = conn.execute("SELECT COUNT(*), COALESCE(SUM(amount),0) FROM gifts" + ok).fetchone()
    rows = [dict(x) for x in conn.execute("SELECT * FROM donors")]
    has_tab = True   # tabs graded from the response (the contact_type column may not exist yet)

    assigned = {a["donor_id"]: a["tab"] for a in body["assigned"]}

    def tab_of(d):
        return assigned[d["id"]]

    # match every key person to db rows by email or by a name as written
    def matches(p):
        em = {e.lower() for e in p.get("emails_all", [])}
        nm = {_ascii(x) for x in p.get("names_as_written", []) + [p["full_name"]]}
        return [d for d in rows if _ascii(d["full_name"]) in nm
                or (em and em & {e.lower() for e in json.loads(d["emails_all"] or "[]")})]

    canon = {d["donor_id"]: d for d in key["canonical_donors"]}
    people = [{**canon.get(p["person_id"], {}), **p} for p in key["people"]]
    found = [p for p in people if matches(p)]
    right = [p for p in found if any(tab_of(d) == p["tab"] for d in matches(p))] if has_tab else []
    per_tab = {tb: (sum(1 for p in right if p["tab"] == tb), sum(1 for p in found if p["tab"] == tb))
               for tb in ("giver", "neighbor", "community")}
    flagged_names = {_ascii(f["name"]) for f in body["flagged_for_review"]}
    amb = [p for p in key["people"] if p["ambiguous"]]
    amb_hit = [p["full_name"] for p in amb if _ascii(p["full_name"]) in flagged_names]
    park_failed = conn.execute("SELECT COUNT(*) FROM gifts g JOIN donors d ON d.id=g.donor_id "
                               "WHERE d.full_name LIKE 'Hye-jin%' AND g.gift_date='2026-11-10'" +
                               (" AND g.status = 'ok'" if has_status else "")).fetchone()[0]
    print(f"people in db {n_people} vs key {len(key['people'])} persons (canonical donors {t['canonical_donors']} "
          f"+ {t['duplicate_groups']} fuzzy dup groups left for dedupe); key persons found {len(found)}/{len(people)}; "
          f"gifts {n_gifts} vs {t['unique_gifts']}; total {total:,.0f} vs {t['total_amount']:,}; "
          f"tab accuracy {len(right)}/{len(found)} per tab {per_tab}; ambiguous flagged {amb_hit} of "
          f"{[p['full_name'] for p in amb]}; failed Nov-10 gift ingested: {park_failed}; seconds {body['seconds']}")
    assert len(found) / len(people) >= 0.9
    assert abs(n_gifts - t["unique_gifts"]) <= 0.02 * t["unique_gifts"]
    assert abs(total - t["total_amount"]) <= 0.02 * t["total_amount"]
    assert park_failed == 0
    if has_tab:
        assert len(right) / len(found) >= 0.95
    assert len(amb_hit) == len(amb)
    assert conn.execute("SELECT COUNT(*) FROM donor_scores").fetchone()[0] == n_people
    assert sum(body["by_tab"].values()) == n_people


