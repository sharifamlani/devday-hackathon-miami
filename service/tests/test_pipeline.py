"""Pipeline wiring with stub enrich/outreach modules (no network, no model calls)."""

import json
import sys
import types
from datetime import date

import pytest

from service import db, pipeline

AS_OF = date(2026, 11, 8)


@pytest.fixture
def env(tmp_path, monkeypatch):
    monkeypatch.setenv("DONORS_DB", str(tmp_path / "donors.db"))
    monkeypatch.delenv("SCORE_AS_OF", raising=False)
    return tmp_path


@pytest.fixture
def stubs(monkeypatch):
    calls = {"enriched": [], "drafted": []}

    enrich = types.ModuleType("service.enrich_agent")
    enrich.read_cache = lambda: {"Amazon": [], "Frederick A. DeLuca Foundation": []}

    def enrich_donor(name, org_name=None, city=None, focus=None, refresh=False):
        calls["enriched"].append(name)
        return [{"fact": f"{name} funds Miami arts", "source_url": f"https://example.org/{len(name)}",
                 "retrieved_at": "2026-11-07T00:00:00+00:00"}]

    def save_facts(donor_id, facts, agent_run_id):
        conn = db.connect()
        with conn:
            conn.executemany(
                "INSERT INTO research_facts (donor_id, fact, source_url, retrieved_at, agent_run_id) VALUES (?, ?, ?, ?, ?)",
                [(donor_id, f["fact"], f["source_url"], f["retrieved_at"], agent_run_id) for f in facts])
        conn.close()
        return len(facts)

    enrich.enrich_donor, enrich.save_facts = enrich_donor, save_facts

    outreach = types.ModuleType("service.outreach_agent")

    def draft_outreach(donor, gifts, score_why, research_facts, org_facts, today=None):
        calls["drafted"].append((donor["full_name"], today, len(research_facts)))
        big = donor["is_star"] or donor["tier"] == "big"
        return types.SimpleNamespace(subject="Here's what we did", body="Body", call_script="Hi",
                                     facts_used=[{"fact": "f", "url": "https://miamifoundation.org/x"}],
                                     status="draft" if big else "ready")

    def save_draft(donor_id, draft):
        import sqlite3
        with sqlite3.connect(db.db_path()) as con:
            con.execute("INSERT INTO outreach_drafts (donor_id, subject, body, call_script, facts_used, status) "
                        "VALUES (?, ?, ?, ?, ?, ?)", (donor_id, draft.subject, draft.body, draft.call_script,
                                                      json.dumps(draft.facts_used), draft.status))
        return "db"

    outreach.draft_outreach, outreach.save_draft = draft_outreach, save_draft
    org_context = types.ModuleType("service.org_context")
    org_context.load_org_facts = lambda: [{"fact": "f", "url": "https://miamifoundation.org/x"}]

    for name, mod in [("service.enrich_agent", enrich), ("service.outreach_agent", outreach),
                      ("service.org_context", org_context)]:
        monkeypatch.setitem(sys.modules, name, mod)
    return calls


def test_pipeline_fills_facts_drafts_and_snapshot(env, stubs):
    out = env / "snapshot.json"
    report = pipeline.run_pipeline(AS_OF, top_n=3, out=out)
    assert [r["status"] for r in report] == ["ok"] * 4, report

    # Orgs only, cache only: the two cached orgs; no individual, no uncached org
    assert sorted(stubs["enriched"]) == ["Amazon", "Frederick A. DeLuca Foundation"]
    assert "individuals skipped by policy" in report[1]["detail"]

    snap = json.loads(out.read_text(encoding="utf-8"))
    top = snap["donors"][0]
    assert top["full_name"] == "Maria Delgado"
    stars = [d for d in snap["donors"] if d["is_star"]]
    assert len(stars) == 2
    for d in [top, *stars]:
        drafts = snap["donor_details"][str(d["id"])]["outreach_drafts"]
        assert len(drafts) == 1 and drafts[0]["facts_used"]
    for d in stars:
        assert snap["donor_details"][str(d["id"])]["outreach_drafts"][0]["status"] == "draft"
    deluca = next(d for d in snap["donors"] if d["full_name"] == "Frederick A. DeLuca Foundation")
    facts = snap["donor_details"][str(deluca["id"])]["research_facts"]
    assert facts and all(f["source_url"].startswith("https://") for f in facts)
    assert all(today == AS_OF for _, today, _ in stubs["drafted"])
    assert snap["meta"]["as_of"] == "2026-11-08"


def test_pipeline_is_idempotent_on_keep_db(env, stubs):
    out = env / "snapshot.json"
    pipeline.run_pipeline(AS_OF, out=out)
    pipeline.run_pipeline(AS_OF, keep_db=True, out=out)
    conn = db.connect()
    assert conn.execute("SELECT COUNT(*) FROM outreach_drafts").fetchone()[0] == 5      # top 3 + 2 stars
    assert conn.execute("SELECT COUNT(*) FROM research_facts").fetchone()[0] == 2
    conn.close()


def test_missing_stage_is_named_and_rest_still_runs(env, monkeypatch):
    monkeypatch.setitem(sys.modules, "service.enrich_agent", None)
    monkeypatch.setitem(sys.modules, "service.outreach_agent", None)
    out = env / "snapshot.json"
    report = {r["stage"]: r for r in pipeline.run_pipeline(AS_OF, out=out)}
    assert report["enrich"]["status"] == "missing" and "PR #5" in report["enrich"]["detail"]
    assert report["outreach"]["status"] == "missing" and "PR #7" in report["outreach"]["detail"]
    assert report["export"]["status"] == "ok" and out.exists()
