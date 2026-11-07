"""POST /ingest through stat-mcp's structured readers (CSV/JSON: no model call)."""
import json

from fastapi.testclient import TestClient

from service import db
from service.main import app

CSV = (
    "donor_id,full_name,email,amount,gift_date,channel,fund\n"
    "D1,Ana Ruiz,ANA@example.org,250,2025-03-04,online,Designated\n"
    "D1,Ana Ruiz,ana@example.org,300,2026-03-02,online,Designated\n"
    "D2,Ben Cole,ben@example.org,100,03/05/2025,check,\n"          # not ISO: review, never inserted
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
