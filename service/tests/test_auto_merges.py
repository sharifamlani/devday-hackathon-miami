"""Automatic (exact-identity) merges at upload are flagged for staff: keep clears the flag, split restores
each source person with exactly its own gifts. Gift totals never change (Sharif's hard rule)."""

import json
from decimal import Decimal

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from service import db, ingest_adapter as ia
from service.routes_data import router


def _ev(first, last="", email="", amount=None, date=None, loc="row:1", phone=""):
    from stat_mcp.schemas import ImportedTransaction

    return ImportedTransaction(first_name=first, last_name=last, email_address=email, phone_number=phone,
                               transaction_type="gift" if amount is not None else "profile",
                               amount=Decimal(str(amount)) if amount is not None else None,
                               transaction_date=date, source_location=loc, contact_type="contact")


def events():
    return {
        "gifts.xlsx": [
            _ev("Maria", "Delgado", "maria.delgado@example.com", 300, "2024-11-21", "row:2"),
            _ev("Priya", "Raman", "priya@example.com", 120, "2025-05-01", "row:3"),
            _ev("Ann", "Lee", "ann@example.com", 50, "2025-03-04", "row:4"),
            _ev("Ann", "Lee", "Ann@Example.com", 75, "2025-06-04", "row:5"),       # same record again: no flag
        ],
        "notes.docx": [
            _ev("María", "Delgado-Ruiz", "Maria.Delgado@Example.com", 250, "2025-11-20", "para:4"),  # same email
            _ev("Priya", "Raman", "", 60, "2025-09-01", "para:7"),                # same name, no email: no flag
            _ev("Robert", "Nguyen", "rob@example.com", 40, "2025-02-02", "para:9"),
        ],
        "online.xlsx": [
            _ev("Bob", "Nguyen", "rob@example.com", 35, "2025-03-03", "row:4"),    # different name, same email
        ],
    }


@pytest.fixture
def setup(tmp_path, monkeypatch):
    path = tmp_path / "donors.db"
    monkeypatch.setenv("DONORS_DB", str(path))
    conn = db.connect(path)
    db.create_schema(conn)
    res = ia.ingest_events(events(), "giver", conn, judgments={})
    conn.close()
    app = FastAPI()
    app.include_router(router)
    return path, TestClient(app), res


def person(client, name):
    return next(p for p in client.get("/people").json()["people"] if p["full_name"] == name)


def totals(path):
    conn = db.connect(path)
    n, s = conn.execute("SELECT COUNT(*), SUM(amount) FROM gifts WHERE status = 'ok'").fetchone()
    conn.close()
    return n, s


def test_exact_identity_merges_are_recorded_and_flagged(setup):
    path, c, _ = setup
    maria, priya, ann = person(c, "Maria Delgado"), person(c, "Priya Raman"), person(c, "Ann Lee")
    assert (maria["auto_merged"], maria["merged_from"]) == (True, 2)
    assert (priya["auto_merged"], priya["merged_from"]) == (False, 0)        # one person, one row lacked an email
    assert (ann["auto_merged"], ann["merged_from"]) == (False, 0)             # one record seen twice
    assert c.get(f"/donors/{maria['id']}").json()["auto_merged"] is True       # person payload too
    conn = db.connect(path)
    rules = dict(conn.execute("SELECT d.full_name, a.rule FROM auto_merges a JOIN donors d ON d.id = a.donor_id"))
    conn.close()
    assert rules == {"Maria Delgado": "same email", "Robert Nguyen": "same email"}


def test_merges_route_lists_sources_with_files_rows_and_gift_counts(setup):
    _, c, _ = setup
    maria = person(c, "Maria Delgado")
    body = c.get(f"/people/{maria['id']}/merges").json()
    assert body["auto_merged"] is True and body["merged_from"] == 2
    (m,) = body["merges"]
    by_name = {s["name"]: s for s in m["sources"]}
    assert by_name["Maria Delgado"]["survivor"] is True
    assert by_name["María Delgado-Ruiz"]["files"] == ["notes.docx"]
    assert by_name["María Delgado-Ruiz"]["locations"] == ["notes.docx: para:4"]
    assert by_name["María Delgado-Ruiz"]["gift_count"] == 1 and by_name["Maria Delgado"]["gift_count"] == 1
    assert c.get("/people/9999/merges").status_code == 404


def test_keep_clears_the_flag_and_changes_no_totals(setup):
    path, c, _ = setup
    before = totals(path)
    maria = person(c, "Maria Delgado")
    r = c.post(f"/people/{maria['id']}/merges/review", json={"action": "keep", "reviewed_by": "Ana"})
    assert r.status_code == 200 and r.json()["person"]["auto_merged"] is False and r.json()["restored"] == []
    assert person(c, "Maria Delgado")["auto_merged"] is False
    assert totals(path) == before
    m = c.get(f"/people/{maria['id']}/merges").json()["merges"][0]
    assert (m["review_action"], m["reviewed_by"]) == ("keep", "Ana")
    assert c.post(f"/people/{maria['id']}/merges/review", json={"action": "keep"}).status_code == 409


def test_split_restores_each_person_with_exactly_their_gifts(setup):
    path, c, _ = setup
    before = totals(path)
    people_before = len(c.get("/people").json()["people"])
    maria = person(c, "Maria Delgado")
    r = c.post(f"/people/{maria['id']}/merges/review", json={"action": "split"})
    assert r.status_code == 200
    body = r.json()
    (restored,) = body["restored"]
    assert restored["full_name"] == "María Delgado-Ruiz" and restored["contact_type"] == "giver"
    assert [(g["amount"], g["gift_date"]) for g in restored["gifts"]] == [(250.0, "2025-11-20")]
    assert [(g["amount"], g["gift_date"]) for g in body["person"]["gifts"]] == [(300.0, "2024-11-21")]
    assert body["person"]["auto_merged"] is False
    assert totals(path) == before                                            # nothing lost, nothing doubled
    assert len(c.get("/people").json()["people"]) == people_before + 1
    # Back as a pending card for staff (same email), never merged again on its own
    pending = c.get("/duplicates").json()
    assert any({p["donor_a_id"], p["donor_b_id"]} == {maria["id"], restored["id"]} for p in pending)
    m = c.get(f"/people/{maria['id']}/merges").json()["merges"][0]
    assert m["review_action"] == "split" and m["split_ids"] == [restored["id"]]


def test_split_gives_each_restored_person_their_own_email_and_gifts(setup):
    path, c, _ = setup
    before = totals(path)
    rob = person(c, "Robert Nguyen")
    restored = c.post(f"/people/{rob['id']}/merges/review", json={"action": "split"}).json()["restored"]
    assert [(r["full_name"], r["email"], [g["amount"] for g in r["gifts"]]) for r in restored] ==         [("Bob Nguyen", "rob@example.com", [35.0])]
    assert [g["amount"] for g in c.get(f"/donors/{rob['id']}").json()["gifts"]] == [40.0]
    assert totals(path) == before


def test_review_rejects_bad_action_and_unknown_person(setup):
    _, c, _ = setup
    maria = person(c, "Maria Delgado")
    assert c.post(f"/people/{maria['id']}/merges/review", json={"action": "merge"}).status_code == 422
    assert c.post("/people/9999/merges/review", json={"action": "keep"}).status_code == 404


def test_dry_run_records_no_auto_merge(tmp_path):
    conn = db.connect(tmp_path / "dry.db")
    db.create_schema(conn)
    ia.ingest_events(events(), "giver", conn, judgments={}, dry_run=True)
    assert conn.execute("SELECT COUNT(*) FROM auto_merges").fetchone()[0] == 0
    conn.close()
