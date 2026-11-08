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
    path, c, result = setup
    assert result["duplicates_removed"] == 2  # two exact-identity source records consolidated, not pending suggestions
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
    result = ia.ingest_events(events(), "giver", conn, judgments={}, dry_run=True)
    assert result["duplicates_removed"] == 0
    assert conn.execute("SELECT COUNT(*) FROM auto_merges").fetchone()[0] == 0
    conn.close()


def test_split_all_then_approve_all_returns_to_the_unsplit_count(setup, monkeypatch, tmp_path):
    """QA on #125: splitting every auto-merge and then approving every pending card must land on the same
    people count as approving the cards without splitting. A merge used to supersede other cards naming the
    merged-away person, stranding the third member of a chain (Marrow Lane Print ~ Bernard ~ Marrow Lane Print Co.)."""
    path, c, _ = setup

    def approve_all():
        while True:
            cards = c.get("/duplicates").json()
            if not cards:
                return
            assert c.post(f"/duplicates/{cards[0]['id']}/merge", json={"approved_by": "qa"}).status_code == 200

    snapshot = tmp_path / "before.db"
    db.connect(path).backup(db.connect(snapshot))
    approve_all()
    baseline = len(c.get("/people").json()["people"])

    monkeypatch.setenv("DONORS_DB", str(snapshot))                      # same upload, now split everything
    for p in [p for p in c.get("/people").json()["people"] if p["auto_merged"]]:
        assert c.post(f"/people/{p['id']}/merges/review", json={"action": "split"}).status_code == 200
    approve_all()
    assert len(c.get("/people").json()["people"]) == baseline


def test_a_merge_chain_reaches_its_third_member(tmp_path, monkeypatch):
    """The real case QA hit after a split: "Marrow Lane Print" (restored, typed as a person) matches only Bernard
    (same email); Bernard matches Marrow Lane Print Co. only through its mailbox. Approving the first card keeps
    "Marrow Lane Print" (more gifts) and drops Bernard, which used to supersede Bernard's card and strand the Co."""
    path = tmp_path / "chain.db"
    monkeypatch.setenv("DONORS_DB", str(path))
    conn = db.connect(path)
    db.create_schema(conn)
    db.insert_donor(conn, {"full_name": "Marrow Lane Print", "donor_type": "individual",
                           "email": "billing.marrowlane@example.org", "source_row": "row 1",
                           "gifts": [(100, "2025-01-05", "check"), (100, "2025-06-05", "check")]})
    db.insert_donor(conn, {"full_name": "Bernard Okoye", "donor_type": "individual", "org_name": "Marrow Lane Print Co.",
                           "email": "billing.marrowlane@example.org", "source_row": "row 2",
                           "gifts": [(50, "2025-03-05", "check")]})
    db.insert_donor(conn, {"full_name": "Marrow Lane Print Co.", "donor_type": "organization",
                           "org_name": "Marrow Lane Print Co.", "source_row": "row 3"})
    conn.commit()
    from service import dedupe
    dedupe.run(conn)
    pairs = {tuple(sorted((r[0], r[1]))) for r in conn.execute(
        "SELECT a.full_name, b.full_name FROM duplicate_suggestions s JOIN donors a ON a.id = s.donor_a_id "
        "JOIN donors b ON b.id = s.donor_b_id WHERE s.status = 'pending'")}
    conn.close()
    assert ("Marrow Lane Print", "Marrow Lane Print Co.") not in pairs and len(pairs) == 2   # a true chain
    app = FastAPI()
    app.include_router(router)
    c = TestClient(app)
    while (cards := c.get("/duplicates").json()):
        assert c.post(f"/duplicates/{cards[0]['id']}/merge", json={"approved_by": "qa"}).status_code == 200
    assert len(c.get("/people").json()["people"]) == 1                    # all three are one donor


def test_snapshot_carries_the_sources_for_open_auto_merges(setup):
    from service.export_snapshot import build_snapshot

    path, c, _ = setup
    maria = person(c, "Maria Delgado")
    conn = db.connect(path)
    snap = json.loads(json.dumps(build_snapshot(conn, rescore=False)))
    conn.close()
    entry = snap["auto_merges"][str(maria["id"])]
    live = c.get(f"/people/{maria['id']}/merges").json()
    assert [s["name"] for s in entry["merges"][0]["sources"]] == [s["name"] for s in live["merges"][0]["sources"]]
    assert [s["email"] for s in entry["merges"][0]["sources"]] ==         [s["email"] for s in live["merges"][0]["sources"]]          # in full: fictional sample data (Sharif, Nov 8)
    assert all(s["gift_ids"] == [] for s in entry["merges"][0]["sources"])
    assert [s["gift_count"] for s in entry["merges"][0]["sources"]] == [s["gift_count"] for s in live["merges"][0]["sources"]]
    assert set(snap["auto_merges"]) == {str(p["id"]) for p in c.get("/people").json()["people"] if p["auto_merged"]}

    c.post(f"/people/{maria['id']}/merges/review", json={"action": "keep"})                   # reviewed: gone
    conn = db.connect(path)
    assert str(maria["id"]) not in build_snapshot(conn, rescore=False)["auto_merges"]
    conn.close()
