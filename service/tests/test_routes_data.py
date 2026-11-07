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
    assert len(donors) == 8
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
    assert len(c.get("/donors").json()) == 7
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
    assert body["scored"] == 8 and body["as_of"] == "2026-11-07"
    assert body["top"][0]["full_name"] == "Maria Delgado"
