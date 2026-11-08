"""The app starts EMPTY, and the committed caches are read only when a live call fails (D1).

Every record comes from uploading data/sample_inputs/; nothing is seeded at startup or reset.
"""
import json

import pytest
from fastapi.testclient import TestClient

from service import db, enrich_agent, icp_agent, social_context
from service.main import app

DATA_TABLES = ["donors", "gifts", "donor_scores", "duplicate_suggestions", "research_facts", "outreach_drafts",
               "prospects", "icp_profile", "org_profile", "org_context", "campaigns", "outbox", "events"]


def counts(path):
    conn = db.connect(path)
    try:
        have = {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type = 'table'")}
        every = [t for t in DATA_TABLES + ["tasks"] if t in have]          # tasks lands with another build
        return {t: conn.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0] for t in every}
    finally:
        conn.close()


def test_reset_db_leaves_zero_rows_everywhere(tmp_path):
    path = tmp_path / "donors.db"
    db.rebuild(path, with_seed=True)                       # a seeded db first, so reset has something to clear
    assert counts(path)["donors"] > 0

    db.reset_db(path)

    assert set(counts(path).values()) == {0}
    assert {"donors", "gifts", "org_context"} <= set(counts(path))


def test_default_rebuild_is_empty(tmp_path):
    assert counts(db.rebuild(tmp_path / "donors.db"))["donors"] == 0


def test_org_profile_has_staff_name(conn):
    assert "staff_name" in {r[1] for r in conn.execute("PRAGMA table_info(org_profile)")}
    db.create_schema(conn)                                 # guarded: a second run is a no-op


def test_app_startup_seeds_nothing(tmp_path, monkeypatch):
    path = tmp_path / "donors.db"
    monkeypatch.setenv("DONORS_DB", str(path))
    with TestClient(app) as client:                        # runs the startup handlers
        assert client.get("/donors").json() == []
    assert counts(path)["donors"] == 0 and counts(path)["gifts"] == 0


def test_enrich_uses_the_cache_only_when_the_live_run_fails(tmp_path, monkeypatch):
    cache = tmp_path / "research_cache.json"
    cache.write_text(json.dumps({"Example Foundation": [
        {"fact": "Funds youth programs.", "source_url": "https://example.org/a", "retrieved_at": "2026-11-01T00:00:00+00:00"}]}))
    monkeypatch.setattr(enrich_agent, "CACHE_JSON", cache)
    live = [enrich_agent.Fact(fact="Live fact.", source_url="https://example.org/live", retrieved_at="t")]
    monkeypatch.setattr(enrich_agent, "research_live", lambda *a: live)

    assert enrich_agent.enrich_donor("Example Foundation", donor_type="organization") == live      # live wins

    def down(*a):
        raise RuntimeError("search is down")

    monkeypatch.setattr(enrich_agent, "research_live", down)
    facts = enrich_agent.enrich_donor("Example Foundation", donor_type="organization")
    assert [f.fact for f in facts] == ["Funds youth programs."] and all(f.cached for f in facts)
    with pytest.raises(RuntimeError):                                    # nothing cached for this name: say so
        enrich_agent.enrich_donor("Unknown Org", donor_type="organization")
    with pytest.raises(RuntimeError):                                    # an explicit refresh never falls back
        enrich_agent.enrich_donor("Example Foundation", donor_type="organization", refresh=True)


def test_cached_facts_are_saved_with_the_flag(tmp_path, monkeypatch):
    path = tmp_path / "donors.db"
    monkeypatch.setenv("DONORS_DB", str(path))
    conn = db.connect(path)
    db.create_schema(conn)
    donor_id = db.insert_donor(conn, {"full_name": "Example Foundation", "donor_type": "organization"})
    conn.commit()
    conn.close()
    facts = [enrich_agent.Fact(fact="Cached fact.", source_url="https://example.org/a", retrieved_at="t", cached=True),
             enrich_agent.Fact(fact="Live fact.", source_url="https://example.org/b", retrieved_at="t")]

    assert enrich_agent.save_facts(donor_id, facts, "run1") == 2

    conn = db.connect(path)
    rows = {r["fact"]: r["cached"] for r in conn.execute("SELECT fact, cached FROM research_facts")}
    conn.close()
    assert rows == {"Cached fact.": 1, "Live fact.": 0}


def prospect(name):
    return {"name": name, "facts": [{"fact": "f", "url": "https://x/1", "quote": "f", "via": "web search"}] * 2,
            "fit_score": 50}


def test_icp_cache_is_a_failure_fallback_and_is_never_rewritten(tmp_path, monkeypatch):
    cache = tmp_path / "icp_cache.json"
    cache.write_text(json.dumps({"generated_at": "t", "icp": {"traits": []}, "prospects": [prospect("Cached Fund")]}))
    monkeypatch.setattr(icp_agent, "ICP_CACHE", cache)
    before = cache.read_text()

    monkeypatch.setattr(icp_agent, "search_prospects", lambda *a: [prospect("Live Fund")])
    assert [p["name"] for p in icp_agent.find_prospects({"traits": []}, set())] == ["Live Fund"]

    def down(*a):
        raise RuntimeError("search is down")

    monkeypatch.setattr(icp_agent, "search_prospects", down)
    got = icp_agent.find_prospects({"traits": []}, set())
    assert [p["name"] for p in got] == ["Cached Fund"]
    assert got[0]["cached"] is True and all(f["cached"] for f in got[0]["facts"])
    with pytest.raises(RuntimeError):
        icp_agent.find_prospects({"traits": []}, set(), refresh=True)

    monkeypatch.setattr(icp_agent, "search_prospects", lambda *a: [])      # the search found nothing at all
    assert icp_agent.find_prospects({"traits": []}, set())[0]["cached"] is True
    assert cache.read_text() == before


def test_social_cache_items_are_flagged_cached(monkeypatch):
    for k in ("X_BEARER_TOKEN", "IG_ACCESS_TOKEN", "IG_USER_ID", "LINKEDIN_ACCESS_TOKEN", "LINKEDIN_ORG_URN"):
        monkeypatch.delenv(k, raising=False)
    facts = social_context.get_social_facts(limit=5)
    assert facts and all(f["cached"] is True for f in facts)
