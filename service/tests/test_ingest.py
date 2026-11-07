"""POST /ingest through stat-mcp's structured readers (CSV/JSON: no model call)."""
import json
from pathlib import Path

from fastapi.testclient import TestClient

from service import db
from service.main import app

CSV = (
    "donor_id,full_name,email,amount,gift_date,channel,fund\n"
    "D1,Ana Ruiz,ANA@example.org,250,2025-03-04,online,Designated\n"
    "D1,Ana Ruiz,ana@example.org,300,2026-03-02,online,Designated\n"
    "D2,Ben Cole,ben@example.org,100,spring 2025,check,\n"          # not ISO: review, never inserted
    "D3,Cara Diaz,cara@example.org,,,,\n"                         # no gift: a person, no fake gift
)


def counts(path) -> tuple[int, int]:
    conn = db.connect(path)
    try:
        return (conn.execute("SELECT COUNT(*) FROM donors").fetchone()[0],
                conn.execute("SELECT COUNT(*) FROM gifts").fetchone()[0])
    finally:
        conn.close()


def post(files, **params):
    return TestClient(app).post("/ingest", files=[("files", f) for f in files], params=params)


def test_ingest_writes_people_and_explicit_gifts(db_file):
    before = counts(db_file)
    r = post([("gifts.csv", CSV.encode(), "text/csv")])
    assert r.status_code == 200, r.text
    body = r.json()
    assert (body["donors"], body["gifts"]) == (3, 2)
    assert [x["reason"] for x in body["review_required"]] == ["gift date is not YYYY-MM-DD"]
    assert counts(db_file) == (before[0] + 3, before[1] + 2)

    conn = db.connect(db_file)
    try:
        ana = conn.execute("SELECT * FROM donors WHERE full_name = 'Ana Ruiz'").fetchone()
        assert ana["email"] == "ana@example.org" and json.loads(ana["emails_all"]) == ["ana@example.org"]
        assert ana["source_row"].startswith("gifts.csv#row:1")
        gifts = conn.execute("SELECT amount, gift_date, channel, fund_type FROM gifts WHERE donor_id = ? "
                             "ORDER BY gift_date", (ana["id"],)).fetchall()
        assert [tuple(g) for g in gifts] == [(250.0, "2025-03-04", "online", "Designated"),
                                            (300.0, "2026-03-02", "online", "Designated")]
        cara = conn.execute("SELECT id FROM donors WHERE full_name = 'Cara Diaz'").fetchone()
        assert conn.execute("SELECT COUNT(*) FROM gifts WHERE donor_id = ?", (cara["id"],)).fetchone()[0] == 0
        # scored as part of the same request
        assert conn.execute("SELECT COUNT(*) FROM donor_scores WHERE donor_id = ?", (ana["id"],)).fetchone()[0] == 1
    finally:
        conn.close()


def test_dry_run_writes_nothing(db_file):
    before = counts(db_file)
    r = post([("gifts.csv", CSV.encode(), "text/csv")], dry_run="true")
    assert r.status_code == 200
    assert r.json()["dry_run"] is True and r.json()["donors"] == 3
    assert counts(db_file) == before


def test_one_unreadable_file_refuses_the_whole_batch(db_file):
    before = counts(db_file)
    r = post([("gifts.csv", CSV.encode(), "text/csv"), ("broken.json", b"{not json", "application/json")])
    assert r.status_code == 422
    assert r.json()["detail"]["filename"] == "broken.json"
    assert counts(db_file) == before


def test_rejects_unsupported_type(db_file):
    r = post([("photo.png", b"\x89PNG", "image/png")])
    assert r.status_code == 422 and "unsupported" in r.json()["detail"]


def test_web_contract_fields_present(db_file):
    body = post([("gifts.json", json.dumps({"gifts": [
        {"donor_id": "X", "name": "Dee Park", "amount": 50, "gift_date": "2026-01-02"}]}).encode(),
        "application/json")]).json()
    for key in ("donors", "gifts", "duplicates", "message"):  # what web parseIngestResult reads
        assert key in body
    assert isinstance(body["duplicates"], int)


def test_signin_sheet_email_or_phone_column(db_file):
    """Real sample input: title row, blank row, then an 'Email or phone' header."""
    path = Path(__file__).resolve().parents[2] / "data" / "sample_inputs" / "event_signin_sheet_nov1.xlsx"
    body = post([(path.name, path.read_bytes(), "application/octet-stream")]).json()
    assert body["files"][0]["events"] > 0 and body["gifts"] == 0


def test_narrative_rows_with_unset_fields_map_cleanly(db_file, monkeypatch):
    """Extractor rows leave phone/email unset and may give only 'name'; neither may crash or drop the person."""
    from stat_mcp import agent
    from stat_mcp.schemas import ExtractedTransaction, TransactionExtraction

    async def fake_extract(text):
        return TransactionExtraction(transactions=[
            ExtractedTransaction(name="Rosa Mendez Vega", transaction_type="gift", contact_type="donor",
                                 amount=500, transaction_date="2026-06-01", person_group_key="p1"),
            ExtractedTransaction(name="Rosa Mendez Vega", transaction_type="gift", contact_type="donor",
                                 amount=750, transaction_date="2026-09-01", person_group_key="p1")])

    monkeypatch.setattr(agent, "extract_unstructured_transactions", fake_extract)
    body = post([("notes.txt", b"Rosa gave twice.", "text/plain")]).json()
    assert (body["donors"], body["gifts"]) == (1, 2), body
    conn = db.connect(db_file)
    try:
        row = conn.execute("SELECT first_name, last_name FROM donors WHERE full_name = 'Rosa Mendez Vega'").fetchone()
        assert tuple(row) == ("Rosa", "Mendez Vega")
    finally:
        conn.close()
