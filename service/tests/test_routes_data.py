from fastapi import FastAPI
from fastapi.testclient import TestClient

from service.routes_data import router


def client():
    app = FastAPI()
    app.include_router(router)
    return TestClient(app)


def test_donors_sorted_by_score_with_score_fields(db_file):
    r = client().get("/donors")
    assert r.status_code == 200
    donors = r.json()
    assert len(donors) == 12
    assert donors[0]["full_name"] == "Maria Delgado"
    assert [d["score"] for d in donors] == sorted((d["score"] for d in donors), reverse=True)
    top = donors[0]
    assert {"score", "tier", "is_star", "status", "why", "emails_all"} <= top.keys()
    assert top["why"]["pattern"]["month_name"] == "November"
    assert any(d["is_star"] is True for d in donors)


def test_donor_detail_has_gifts_research_and_drafts(db_file):
    c = client()
    top = c.get("/donors").json()[0]
    d = c.get(f"/donors/{top['id']}").json()
    assert len(d["gifts"]) == 4 and d["gifts"][0]["gift_date"] == "2025-11-20"
    assert d["research_facts"] == [] and d["outreach_drafts"] == []
    assert d["why"]["status"] == "lapsing"
    assert c.get("/donors/9999").status_code == 404


def test_duplicates_merge_flow(db_file):
    c = client()
    dupes = c.get("/duplicates").json()
    assert len(dupes) == 1
    s = dupes[0]
    assert s["donor_a"]["full_name"] == "Maria Delgado" and s["donor_b"]["full_name"] == "María Delgado-Ruiz"
    assert s["reasons"][0].startswith("same email")

    r = c.post(f"/duplicates/{s['id']}/merge", json={})
    assert r.status_code == 200
    body = r.json()
    assert body["kept_donor_id"] == s["donor_a_id"]
    assert len(body["donor"]["gifts"]) == 5
    assert c.get("/duplicates").json() == []
    assert len(c.get("/donors").json()) == 11
    assert c.post(f"/duplicates/{s['id']}/merge", json={}).status_code == 409
    assert c.post("/duplicates/9999/merge", json={}).status_code == 404


def test_merge_with_explicit_keep_id(db_file):
    c = client()
    s = c.get("/duplicates").json()[0]
    r = c.post(f"/duplicates/{s['id']}/merge", json={"keep_id": s["donor_b_id"]})
    assert r.status_code == 200 and r.json()["kept_donor_id"] == s["donor_b_id"]


def test_dismiss(db_file):
    c = client()
    s = c.get("/duplicates").json()[0]
    assert c.post(f"/duplicates/{s['id']}/dismiss").json()["status"] == "dismissed"
    assert c.get("/duplicates").json() == []
    assert c.post("/score/run").json()["pending_duplicates"] == 0     # a dismissal sticks


def test_score_run(db_file):
    r = client().post("/score/run", params={"as_of": "2026-11-07"})
    assert r.status_code == 200
    body = r.json()
    assert body["scored"] == 12 and body["as_of"] == "2026-11-07"
    assert body["top"][0]["full_name"] == "Maria Delgado"


def test_draft_columns_round_trip_through_detail(db_file):
    import json as _json
    from service import db as _db
    conn = _db.connect(db_file)
    donor_id = conn.execute("SELECT id FROM donors WHERE full_name = 'Maria Delgado'").fetchone()[0]
    facts = [{"fact": "Record Give Miami Day, ~$43.8M", "url": "https://miamifoundation.org/news/x"}]
    conn.execute(
        "INSERT INTO outreach_drafts (donor_id, subject, body, call_script, facts_used, status) "
        "VALUES (?, 'Thank you', 'Body', 'Hi Maria...', ?, 'ready')", (donor_id, _json.dumps(facts)))
    conn.commit()
    conn.close()
    draft = client().get(f"/donors/{donor_id}").json()["outreach_drafts"][0]
    assert (draft["subject"], draft["call_script"], draft["status"]) == ("Thank you", "Hi Maria...", "ready")
    assert draft["facts_used"] == facts


def test_seed_has_real_orgs_and_two_stars(db_file):
    donors = client().get("/donors").json()
    by_name = {d["full_name"]: d for d in donors}
    for org in ["Amazon", "John S. and James L. Knight Foundation", "Frederick A. DeLuca Foundation",
                "McDermott Will & Schulte"]:
        assert by_name[org]["donor_type"] == "organization" and by_name[org]["source_row"] == "SAMPLE"
    stars = {d["full_name"] for d in donors if d["is_star"]}
    assert stars == {"Frederick A. DeLuca Foundation", "Biscayne Harbor Family Foundation"}


def test_is_sample_on_list_detail_and_snapshot(db_file, tmp_path):
    from service import db as _db
    from service.export_snapshot import build_snapshot
    conn = _db.connect(db_file)
    real_id = _db.insert_donor(conn, {"full_name": "Ingested Donor", "donor_type": "individual",
                                      "source_row": "row 7: Ingested Donor,ingested@example.com"})
    conn.commit()
    c = client()
    donors = c.get("/donors").json()
    by_id = {d["id"]: d for d in donors}
    assert by_id[real_id]["is_sample"] is False
    assert all(d["is_sample"] is True for d in donors if d["id"] != real_id)
    assert c.get("/donors/1").json()["is_sample"] is True
    assert c.get(f"/donors/{real_id}").json()["is_sample"] is False
    snap = build_snapshot(conn, rescore=False)
    conn.close()
    assert snap["donors"] == donors
    assert snap["donor_details"][str(real_id)]["is_sample"] is False


def test_merged_sample_donor_stays_sample(db_file):
    c = client()
    s = c.get("/duplicates").json()[0]
    assert c.post(f"/duplicates/{s['id']}/merge", json={}).json()["donor"]["is_sample"] is True


def test_approve_star_draft_then_sent_is_allowed(db_file):
    import sqlite3 as _sqlite3
    import pytest as _pytest
    from service import db as _db
    conn = _db.connect(db_file)
    star_id = conn.execute("SELECT donor_id FROM donor_scores WHERE is_star = 1").fetchone()[0]
    draft_id = conn.execute("INSERT INTO outreach_drafts (donor_id, subject, body, status) VALUES (?, 'S', 'Old', 'draft')",
                            (star_id,)).lastrowid
    conn.commit()
    with _pytest.raises(_sqlite3.IntegrityError):                      # not approved yet: trigger refuses
        conn.execute("UPDATE outreach_drafts SET status = 'sent' WHERE id = ?", (draft_id,))
    conn.rollback()

    c = client()
    assert c.post(f"/drafts/{draft_id}/approve", json={"approved_by": "  "}).status_code == 422
    r = c.post(f"/drafts/{draft_id}/approve", json={"approved_by": "Ana (Philanthropy)", "body": "Edited"})
    assert r.status_code == 200
    d = r.json()
    assert (d["status"], d["approved_by"], d["body"]) == ("approved", "Ana (Philanthropy)", "Edited")
    assert d["approved_at"] and d["facts_used"] == []
    assert c.get(f"/donors/{star_id}").json()["outreach_drafts"][0]["status"] == "approved"

    conn.execute("UPDATE outreach_drafts SET status = 'sent' WHERE id = ?", (draft_id,))   # now allowed
    conn.commit()
    conn.close()
    assert c.post(f"/drafts/{draft_id}/approve", json={"approved_by": "Ana"}).status_code == 409
    assert c.post("/drafts/9999/approve", json={"approved_by": "Ana"}).status_code == 404


def test_approve_keeps_body_when_omitted(db_file):
    from service import db as _db
    conn = _db.connect(db_file)
    draft_id = conn.execute("INSERT INTO outreach_drafts (donor_id, body, status) VALUES (1, 'Keep me', 'ready')").lastrowid
    conn.commit()
    conn.close()
    d = client().post(f"/drafts/{draft_id}/approve", json={"approved_by": "Ana"}).json()
    assert d["body"] == "Keep me" and d["status"] == "approved"
