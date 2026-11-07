"""Phase 5B: icp_profile + prospects tables, writers, the donor XOR prospect draft check, routes, snapshot."""

import json
import sqlite3

import pytest

from service import db
from service.export_snapshot import build_snapshot
from service.tests.test_routes_data import client

PROFILE = {"traits": [{"trait": "cause", "value": "arts", "evidence": [{"donor": "D", "fact": "f", "url": "https://x"}]}],
           "stats": {"org_donors": 5, "median_annual_gift": 50000},
           "evidence": [{"trait": "cause", "donor": "D", "fact": "f", "url": "https://x"}]}
PROSPECTS = [
    {"name": "Coral Reef Arts Fund", "org_type": "foundation", "city": "Miami", "fit_score": 88,
     "matched_traits": ["cause"], "priority": "Prosperity",
     "facts": [{"fact": "Funds arts", "url": "https://example.org/1"}]},
    {"name": "Everglades Futures Co", "org_type": "company", "city": "Doral", "fit_score": 61,
     "matched_traits": [], "priority": "Climate & Resilience", "facts": []},
    {"name": "amazon.", "org_type": "company", "city": "Miami", "fit_score": 99, "matched_traits": [], "facts": []},
]


def seeded(conn):
    db.seed(conn)
    return conn


def test_writers_store_profile_and_exclude_current_donors(conn):
    seeded(conn)
    out = db.save_icp_run(conn, {"generated_at": "x", "icp": PROFILE, "prospects": PROSPECTS})
    assert len(out["prospect_ids"]) == 2                       # "amazon." matches donor Amazon
    row = conn.execute("SELECT * FROM icp_profile WHERE id = ?", (out["icp_id"],)).fetchone()
    assert json.loads(row["stats"]) == PROFILE["stats"]
    names = [r[0] for r in conn.execute("SELECT name FROM prospects ORDER BY id")]
    assert names == ["Coral Reef Arts Fund", "Everglades Futures Co"]


def test_save_prospects_upserts_and_keeps_status(conn):
    seeded(conn)
    (pid, _) = db.save_prospects(conn, PROSPECTS[:2])
    conn.execute("UPDATE prospects SET status = 'dismissed' WHERE id = ?", (pid,))
    again = db.save_prospects(conn, [{**PROSPECTS[0], "fit_score": 70}])
    assert again == [pid]
    row = conn.execute("SELECT status, fit_score FROM prospects WHERE id = ?", (pid,)).fetchone()
    assert (row["status"], row["fit_score"]) == ("dismissed", 70)
    assert conn.execute("SELECT COUNT(*) FROM prospects").fetchone()[0] == 2


def test_draft_belongs_to_exactly_one_donor_or_prospect(conn):
    seeded(conn)
    (pid,) = db.save_prospects(conn, PROSPECTS[:1])
    conn.execute("INSERT INTO outreach_drafts (donor_id, body) VALUES (1, 'donor draft')")
    conn.execute("INSERT INTO outreach_drafts (prospect_id, body) VALUES (?, 'prospect draft')", (pid,))
    with pytest.raises(sqlite3.IntegrityError):
        conn.execute("INSERT INTO outreach_drafts (body) VALUES ('orphan')")
    with pytest.raises(sqlite3.IntegrityError):
        conn.execute("INSERT INTO outreach_drafts (donor_id, prospect_id, body) VALUES (1, ?, 'both')", (pid,))


def test_prospect_drafts_are_always_human_sent(conn):
    seeded(conn)
    (pid,) = db.save_prospects(conn, PROSPECTS[:1])
    with pytest.raises(sqlite3.IntegrityError):
        conn.execute("INSERT INTO outreach_drafts (prospect_id, body, status) VALUES (?, 'x', 'ready')", (pid,))
    draft = conn.execute("INSERT INTO outreach_drafts (prospect_id, body) VALUES (?, 'x')", (pid,)).lastrowid
    with pytest.raises(sqlite3.IntegrityError):
        conn.execute("UPDATE outreach_drafts SET status = 'sent' WHERE id = ?", (draft,))
    conn.execute("UPDATE outreach_drafts SET status = 'sent', approved_by = 'Ana' WHERE id = ?", (draft,))


def test_status_and_fit_score_checks(conn):
    with pytest.raises(sqlite3.IntegrityError):
        conn.execute("INSERT INTO prospects (name, status) VALUES ('X', 'contacted')")
    with pytest.raises(sqlite3.IntegrityError):
        conn.execute("INSERT INTO prospects (name, fit_score) VALUES ('Y', 140)")


def test_old_db_migrates_in_place(tmp_path):
    """A donors.db created before 5B (donor_id NOT NULL, no prospect_id) upgrades on create_schema."""
    path = tmp_path / "old.db"
    old = sqlite3.connect(path)
    old.executescript("""
        CREATE TABLE donors (id INTEGER PRIMARY KEY, full_name TEXT NOT NULL);
        CREATE TABLE outreach_drafts (id INTEGER PRIMARY KEY, donor_id INTEGER NOT NULL REFERENCES donors(id),
            channel TEXT, subject TEXT, body TEXT NOT NULL, call_script TEXT, facts_used TEXT,
            status TEXT NOT NULL DEFAULT 'draft', approved_by TEXT, approved_at TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now')));
        CREATE TRIGGER old_trigger BEFORE INSERT ON outreach_drafts BEGIN SELECT 1; END;
        INSERT INTO donors VALUES (1, 'Maria');
        INSERT INTO outreach_drafts (donor_id, subject, body, status) VALUES (1, 'Hi', 'Body', 'ready');
    """)
    old.commit()
    old.close()

    conn = db.connect(path)
    db.create_schema(conn)
    cols = [r[1] for r in conn.execute("PRAGMA table_info(outreach_drafts)")]
    assert "prospect_id" in cols
    row = conn.execute("SELECT donor_id, subject, body, status FROM outreach_drafts").fetchone()
    assert tuple(row) == (1, "Hi", "Body", "ready")
    triggers = {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type = 'trigger'")}
    assert {"star_needs_human_insert", "prospect_needs_human_insert"} <= triggers and "old_trigger" not in triggers
    assert db.migrate_outreach_drafts(conn) is False             # idempotent
    conn.close()


def test_routes_icp_prospects_dismiss_and_snapshot_parity(db_file):
    c = client()
    assert c.get("/icp").status_code == 404
    assert c.get("/prospects").json() == []

    conn = db.connect(db_file)
    ids = db.save_icp_run(conn, {"icp": PROFILE, "prospects": PROSPECTS})["prospect_ids"]
    conn.execute("INSERT INTO outreach_drafts (prospect_id, subject, body, facts_used) VALUES (?, 'Intro', 'B', ?)",
                 (ids[0], json.dumps([{"fact": "f", "url": "https://x"}])))
    conn.commit()

    icp = c.get("/icp").json()
    assert icp["traits"] == PROFILE["traits"] and icp["evidence"] == PROFILE["evidence"]
    prospects = c.get("/prospects").json()
    assert [p["fit_score"] for p in prospects] == [88, 61]
    assert prospects[0]["facts"][0]["url"] == "https://example.org/1"
    detail = c.get(f"/prospects/{ids[0]}").json()
    assert detail["outreach_drafts"][0]["facts_used"] == [{"fact": "f", "url": "https://x"}]
    assert detail["outreach_drafts"][0]["donor_id"] is None
    assert c.get("/prospects/9999").status_code == 404

    snap = json.loads(json.dumps(build_snapshot(conn, rescore=False)))
    assert snap["icp"] == icp
    assert snap["prospects"] == prospects
    assert snap["prospect_details"][str(ids[0])] == detail

    assert c.post(f"/prospects/{ids[1]}/dismiss").json()["status"] == "dismissed"
    assert [p["id"] for p in c.get("/prospects").json()] == [ids[0]]
    assert len(c.get("/prospects", params={"include_dismissed": True}).json()) == 2
    assert c.post("/prospects/9999/dismiss").status_code == 404
    assert list(build_snapshot(conn, rescore=False)["prospect_details"]) == [str(ids[0])]
    conn.close()

    # A donor's drafts never pick up prospect drafts, and the donor detail still works
    assert all(d["prospect_id"] is None for d in c.get("/donors/1").json()["outreach_drafts"])
