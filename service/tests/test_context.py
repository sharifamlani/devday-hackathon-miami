"""5C: the local context dataset (org_profile + org_context), its single writer, routes and snapshot key."""

import json
import sqlite3

import pytest

from service import db
from service.export_snapshot import build_snapshot
from service.tests.test_routes_data import client

URLS = {"name": "The Miami Foundation", "website": "https://miamifoundation.org", "x_url": None,
        "linkedin_url": "https://www.linkedin.com/company/the-miami-foundation/",
        "instagram_url": "https://www.instagram.com/miamifoundation/"}


def fact(source, day, text, url=None):
    return {"source": source, "url": url if url is not None else f"https://example.org/{source}/{day}",
            "posted_at": day, "fact": text, "quote": text.lower(), "priority": "Prosperity",
            "captured_at": "2026-11-07T00:00:00+00:00"}


def result(facts, sources, **profile):
    return {"profile": {**URLS, "priorities": ["Prosperity"], "voice": {"phrases": ["for good"]}, **profile},
            "facts": facts, "sources": sources}


def test_save_context_writes_profile_and_facts(conn):
    out = db.save_context(conn, result([fact("website", "2026-10-01", "A"), fact("linkedin", "2026-11-03", "B")],
                                       {"website": "ok", "linkedin": "cached", "instagram": "blocked", "x": "skipped"}))
    assert out["org_profile_id"] == 1 and len(out["context_ids"]) == 2
    assert out["replaced_sources"] == ["linkedin", "website"] and out["skipped_facts"] == 0
    p = conn.execute("SELECT * FROM org_profile").fetchone()
    assert p["linkedin_url"] == URLS["linkedin_url"] and json.loads(p["priorities"]) == ["Prosperity"]
    assert json.loads(p["source_status"])["instagram"] == "blocked"


def test_rerun_replaces_only_sources_read_ok_and_keeps_blocked_facts(conn):
    db.save_context(conn, result([fact("website", "2026-10-01", "old site"), fact("instagram", "2026-09-01", "old insta")],
                                 {"website": "ok", "instagram": "ok"}))
    db.save_context(conn, result([fact("website", "2026-11-01", "new site")],
                                 {"website": "ok", "instagram": "blocked"}))
    rows = {(r["source"], r["fact"]) for r in conn.execute("SELECT source, fact FROM org_context")}
    assert rows == {("website", "new site"), ("instagram", "old insta")}      # blocked: real old facts survive
    status = json.loads(conn.execute("SELECT source_status FROM org_profile").fetchone()[0])
    assert status == {"website": "ok", "instagram": "blocked"}
    assert conn.execute("SELECT COUNT(*) FROM org_profile").fetchone()[0] == 1   # one upserted row


def test_error_status_keeps_facts_and_profile_fields_persist(conn):
    db.save_context(conn, result([fact("x", "2026-10-01", "post")], {"x": "ok"}))
    db.save_context(conn, {"profile": {}, "facts": [], "sources": {"x": "error"}})
    assert conn.execute("SELECT COUNT(*) FROM org_context WHERE source = 'x'").fetchone()[0] == 1
    assert conn.execute("SELECT website FROM org_profile").fetchone()[0] == URLS["website"]


def test_facts_without_url_or_text_are_dropped_and_sources_checked(conn):
    out = db.save_context(conn, result([fact("website", "2026-10-01", "ok"), fact("website", "2026-10-02", "x", url=""),
                                        {**fact("website", "2026-10-03", ""), "fact": "  "}],
                                       {"website": "ok"}))
    assert len(out["context_ids"]) == 1 and out["skipped_facts"] == 2
    with pytest.raises(sqlite3.IntegrityError):
        conn.execute("INSERT INTO org_context (source, url, fact) VALUES ('tiktok', 'https://x', 'f')")
    with pytest.raises(sqlite3.IntegrityError):
        conn.execute("INSERT INTO org_context (source, url, fact) VALUES ('website', '', 'f')")


def test_duplicate_fact_in_one_result_is_stored_once(conn):
    f = fact("news", "2026-10-01", "same")
    out = db.save_context(conn, result([f, dict(f)], {"news": "ok"}))
    assert len(out["context_ids"]) == 1


def test_routes_and_snapshot_parity(db_file):
    c = client()
    assert c.get("/org-profile").status_code == 404
    assert c.get("/context").json() == []

    conn = db.connect(db_file)
    db.save_context(conn, result([fact("website", "2026-10-01", "Site"), fact("linkedin", "2026-11-03", "Post"),
                                  {**fact("news", "x", "Undated"), "posted_at": None}],
                                 {"website": "ok", "linkedin": "ok", "news": "ok", "instagram": "blocked"}))
    profile = c.get("/org-profile").json()
    assert profile["voice"] == {"phrases": ["for good"]} and profile["source_status"]["instagram"] == "blocked"
    facts = c.get("/context").json()
    assert [f["fact"] for f in facts] == ["Post", "Site", "Undated"]           # newest first, undated last
    assert [f["fact"] for f in c.get("/context", params={"source": "linkedin"}).json()] == ["Post"]
    assert c.get("/context", params={"source": "tiktok"}).status_code == 422

    snap = json.loads(json.dumps(build_snapshot(conn, rescore=False)))
    conn.close()
    assert snap["context"] == {"profile": profile, "facts": facts}
