import json

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from service import db, dedupe, score
from service import routes_data
from service.tests.conftest import AS_OF


def snapshot(conn, donor_id):
    return {
        "donor": dict(conn.execute("SELECT * FROM donors WHERE id = ?", (donor_id,)).fetchone()),
        "gifts": [tuple(r) for r in conn.execute("SELECT * FROM gifts WHERE donor_id = ? ORDER BY id", (donor_id,))],
    }


def seeded_pair(conn):
    db.seed(conn)
    score.run(conn, AS_OF)
    dedupe.run(conn)
    return conn.execute("SELECT * FROM duplicate_suggestions").fetchone()


def test_merge_then_undo_restores_everything(conn):
    s = seeded_pair(conn)
    a, b = s["donor_a_id"], s["donor_b_id"]
    for d in (a, b):
        conn.execute("INSERT INTO research_facts (donor_id, fact, source_url) VALUES (?, 'f', 'https://x')", (d,))
        conn.execute("INSERT INTO outreach_drafts (donor_id, body) VALUES (?, 'hi')", (d,))
    # A third pending suggestion involving b that the merge supersedes.
    other = conn.execute("INSERT INTO donors (full_name, donor_type) VALUES ('Zed Other', 'individual')").lastrowid
    extra = conn.execute("INSERT INTO duplicate_suggestions (donor_a_id, donor_b_id, reasons, confidence) "
                         "VALUES (?, ?, '[]', 0.7)", (b, other)).lastrowid
    conn.commit()
    before = {d: snapshot(conn, d) for d in (a, b)}
    facts = {d: [r[0] for r in conn.execute("SELECT id FROM research_facts WHERE donor_id = ?", (d,))] for d in (a, b)}
    drafts = {d: [r[0] for r in conn.execute("SELECT id FROM outreach_drafts WHERE donor_id = ?", (d,))] for d in (a, b)}
    score_b = dict(conn.execute("SELECT * FROM donor_scores WHERE donor_id = ?", (b,)).fetchone())

    res = dedupe.merge(conn, s["id"], keep_id=a, approved_by="staff")
    assert res["merge_id"]
    assert conn.execute("SELECT status FROM duplicate_suggestions WHERE id = ?", (extra,)).fetchone()[0] == "superseded"
    log = conn.execute("SELECT * FROM merge_log WHERE id = ?", (res["merge_id"],)).fetchone()
    assert log["approved_by"] == "staff" and log["undone_at"] is None
    assert json.loads(log["superseded"]) == [extra]

    out = dedupe.undo_merge(conn, res["merge_id"])
    assert out == {"kept_id": a, "restored_id": b}
    after = {d: snapshot(conn, d) for d in (a, b)}
    assert after == before
    assert dict(conn.execute("SELECT * FROM donor_scores WHERE donor_id = ?", (b,)).fetchone()) == score_b
    for d in (a, b):
        assert [r[0] for r in conn.execute("SELECT id FROM research_facts WHERE donor_id = ?", (d,))] == facts[d]
        assert [r[0] for r in conn.execute("SELECT id FROM outreach_drafts WHERE donor_id = ?", (d,))] == drafts[d]
    statuses = {r[0]: r[1] for r in conn.execute("SELECT id, status FROM duplicate_suggestions")}
    assert statuses[s["id"]] == "pending" and statuses[extra] == "pending"
    assert conn.execute("SELECT resolved_at FROM duplicate_suggestions WHERE id = ?", (s["id"],)).fetchone()[0] is None
    assert conn.execute("SELECT undone_at FROM merge_log WHERE id = ?", (res["merge_id"],)).fetchone()[0]


def test_undo_twice_and_unknown(conn):
    s = seeded_pair(conn)
    mid = dedupe.merge(conn, s["id"])["merge_id"]
    dedupe.undo_merge(conn, mid)
    with pytest.raises(ValueError):
        dedupe.undo_merge(conn, mid)
    with pytest.raises(LookupError):
        dedupe.undo_merge(conn, 9999)


def test_only_newest_merge_into_a_donor_can_be_undone(conn):
    s1 = seeded_pair(conn)
    keep = s1["donor_a_id"]
    third = conn.execute("INSERT INTO donors (full_name, donor_type) VALUES ('Third Dup', 'individual')").lastrowid
    s2 = conn.execute("INSERT INTO duplicate_suggestions (donor_a_id, donor_b_id, reasons, confidence) "
                      "VALUES (?, ?, '[]', 0.7)", (keep, third)).lastrowid
    conn.commit()
    m1 = dedupe.merge(conn, s1["id"], keep_id=keep)["merge_id"]
    m2 = dedupe.merge(conn, s2, keep_id=keep)["merge_id"]
    listed = dedupe.merges_for(conn, keep)
    assert [m["id"] for m in listed] == [m2, m1]
    assert [m["can_undo"] for m in listed] == [True, False]
    with pytest.raises(ValueError):
        dedupe.undo_merge(conn, m1)
    dedupe.undo_merge(conn, m2)
    dedupe.undo_merge(conn, m1)


def test_cannot_undo_when_kept_donor_was_later_merged_away(conn):
    s1 = seeded_pair(conn)
    a, b = s1["donor_a_id"], s1["donor_b_id"]
    m1 = dedupe.merge(conn, s1["id"], keep_id=a)["merge_id"]
    c = conn.execute("INSERT INTO donors (full_name, donor_type) VALUES ('Cee', 'individual')").lastrowid
    s2 = conn.execute("INSERT INTO duplicate_suggestions (donor_a_id, donor_b_id, reasons, confidence) "
                      "VALUES (?, ?, '[]', 0.7)", (a, c)).lastrowid
    conn.commit()
    dedupe.merge(conn, s2, keep_id=c)          # a is now dropped
    with pytest.raises(ValueError):
        dedupe.undo_merge(conn, m1)


def test_undo_refused_if_merged_id_exists_again(conn):
    s = seeded_pair(conn)
    mid = dedupe.merge(conn, s["id"])["merge_id"]
    gone = conn.execute("SELECT merged_id FROM merge_log WHERE id = ?", (mid,)).fetchone()[0]
    conn.execute("INSERT INTO donors (id, full_name, donor_type) VALUES (?, 'Squatter', 'individual')", (gone,))
    conn.commit()
    with pytest.raises(ValueError):
        dedupe.undo_merge(conn, mid)


@pytest.fixture
def client(db_file):
    app = FastAPI()
    app.include_router(routes_data.router)
    return TestClient(app)


def test_routes_merge_log_and_undo(client):
    client.post("/score/run")
    s = client.get("/duplicates").json()[0]
    r = client.post(f"/duplicates/{s['id']}/merge", json={"approved_by": "Dana"})
    assert r.status_code == 200
    merge_id, kept = r.json()["merge_id"], r.json()["kept_donor_id"]
    merges = client.get(f"/donors/{kept}").json()["merges"]
    assert len(merges) == 1 and merges[0]["can_undo"] is True and merges[0]["approved_by"] == "Dana"
    assert merges[0]["undone_at"] is None and merges[0]["gifts_moved"] >= 1

    u = client.post(f"/merges/{merge_id}/undo")
    assert u.status_code == 200
    body = u.json()
    assert body["kept_id"] == kept and body["donor"]["id"] == kept and body["restored"]["id"] == body["restored_id"]
    after = client.get(f"/donors/{kept}").json()["merges"]
    assert after[0]["undone_at"] and after[0]["can_undo"] is False
    assert client.get(f"/donors/{body['restored_id']}").json()["merges"] == []
    assert client.post(f"/merges/{merge_id}/undo").status_code == 409
    assert client.get("/duplicates").json()[0]["id"] == s["id"]


def test_route_undo_unknown_merge_is_404(client):
    assert client.post("/merges/9999/undo").status_code == 404
