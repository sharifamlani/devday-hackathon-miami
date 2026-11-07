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
    calls = {"enriched": [], "drafted": [], "prospect_drafts": [], "excluded": set(), "context_urls": None}

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

    def draft_prospect(prospect, profile, org_facts, today=None):
        calls["prospect_drafts"].append((prospect["name"], today, len(profile["traits"])))
        return types.SimpleNamespace(subject=f"Introducing The Miami Foundation to {prospect['name']}",
                                     body="Intro", call_script="Hi",
                                     facts_used=[{"fact": "f", "url": "https://miamifoundation.org/x"}],
                                     status="draft")

    outreach.draft_outreach, outreach.save_draft, outreach.draft_prospect = draft_outreach, save_draft, draft_prospect

    icp = types.ModuleType("service.icp_agent")
    icp.build_profile = lambda refresh=False: {
        "traits": [{"trait": "sector", "value": "foundation", "evidence": []},
                   {"trait": "cause", "value": "arts", "evidence": []}],
        "stats": {"org_donors": 5}, "evidence": [{"trait": "cause", "donor": "Frederick A. DeLuca Foundation",
                                                  "fact": "funds arts", "url": "https://example.org/a"}]}

    def find_prospects(profile, exclude_names, refresh=False):
        calls["excluded"] = set(exclude_names)
        return [
            {"name": "Coral Reef Arts Fund", "org_type": "foundation", "city": "Miami", "fit_score": 88,
             "matched_traits": ["sector", "cause"], "priority": "Prosperity",
             "facts": [{"fact": "Funds arts", "url": "https://example.org/1"}, {"fact": "Miami", "url": "https://example.org/2"}]},
            {"name": "Everglades Futures Co", "org_type": "company", "city": "Doral", "fit_score": 61,
             "matched_traits": ["sector"], "priority": "Climate & Resilience",
             "facts": [{"fact": "Climate", "url": "https://example.org/3"}, {"fact": "Doral", "url": "https://example.org/4"}]},
            {"name": "AMAZON", "org_type": "company", "city": "Miami", "fit_score": 99,       # a current donor
             "matched_traits": ["sector"], "priority": "Civic", "facts": []},
        ]

    icp.find_prospects = find_prospects
    org_context = types.ModuleType("service.org_context")
    org_context.load_org_facts = lambda: [{"fact": "f", "url": "https://miamifoundation.org/x"}]

    def build_context(urls, refresh=False):
        calls["context_urls"] = urls
        return {"profile": {**urls, "priorities": ["Prosperity", "Climate & Resilience"], "voice": {"phrases": ["Miami"]}},
                "facts": [{"source": "website", "url": "https://miamifoundation.org/news/a", "posted_at": "2026-10-01",
                           "fact": "Record Give Miami Day", "quote": "record", "priority": "Prosperity"},
                          {"source": "linkedin", "url": "https://www.linkedin.com/posts/b", "posted_at": "2026-11-03",
                           "fact": "New climate fund", "quote": "climate", "priority": "Climate & Resilience"},
                          {"source": "linkedin", "url": "", "fact": "no source"}],
                "sources": {"website": "ok", "linkedin": "cached", "instagram": "blocked", "x": "skipped"}}

    org_context.build_context = build_context

    for name, mod in [("service.enrich_agent", enrich), ("service.outreach_agent", outreach),
                      ("service.org_context", org_context), ("service.icp_agent", icp)]:
        monkeypatch.setitem(sys.modules, name, mod)
    return calls


def test_pipeline_fills_facts_drafts_and_snapshot(env, stubs):
    out = env / "snapshot.json"
    report = pipeline.run_pipeline(AS_OF, top_n=3, out=out)
    assert [r["stage"] for r in report] == ["rebuild", "context", "enrich", "icp", "outreach", "export"]
    assert [r["status"] for r in report] == ["ok"] * 6, report
    stage = {r["stage"]: r for r in report}

    # Orgs only, cache only: the two cached orgs; no individual, no uncached org
    assert sorted(stubs["enriched"]) == ["Amazon", "Frederick A. DeLuca Foundation"]
    assert "individuals skipped by policy" in stage["enrich"]["detail"]

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

    # Context stage: config URLs in, facts newest first, the URL-less fact dropped, blocked shown as blocked
    assert stubs["context_urls"]["website"] == "https://miamifoundation.org"
    assert stubs["context_urls"]["x_url"] is None and "_comment" not in stubs["context_urls"]
    ctx = snap["context"]
    assert [f["source"] for f in ctx["facts"]] == ["linkedin", "website"]
    assert ctx["profile"]["source_status"]["instagram"] == "blocked"
    assert "1 facts without a URL dropped" in stage["context"]["detail"]

    # ICP stage: profile, prospects best-fit first, current donors excluded, a 'draft' per prospect
    assert "Amazon" in stubs["excluded"]
    assert len(snap["icp"]["traits"]) == 2 and snap["icp"]["stats"] == {"org_donors": 5}
    assert [p["name"] for p in snap["prospects"]] == ["Coral Reef Arts Fund", "Everglades Futures Co"]
    for p in snap["prospects"]:
        assert p["status"] == "drafted"
        drafts = snap["prospect_details"][str(p["id"])]["outreach_drafts"]
        assert len(drafts) == 1 and drafts[0]["status"] == "draft" and drafts[0]["donor_id"] is None
    assert all(today == AS_OF for _, today, _ in stubs["prospect_drafts"])


def test_pipeline_is_idempotent_on_keep_db(env, stubs):
    out = env / "snapshot.json"
    pipeline.run_pipeline(AS_OF, out=out)
    pipeline.run_pipeline(AS_OF, keep_db=True, out=out)
    conn = db.connect()
    assert conn.execute("SELECT COUNT(*) FROM outreach_drafts WHERE donor_id IS NOT NULL").fetchone()[0] == 5  # top 3 + 2 stars
    assert conn.execute("SELECT COUNT(*) FROM outreach_drafts WHERE prospect_id IS NOT NULL").fetchone()[0] == 2
    assert conn.execute("SELECT COUNT(*) FROM prospects").fetchone()[0] == 2
    assert conn.execute("SELECT COUNT(*) FROM icp_profile").fetchone()[0] == 2   # one per run; GET /icp serves the latest

    assert conn.execute("SELECT COUNT(*) FROM research_facts").fetchone()[0] == 2
    conn.close()


def test_missing_stage_is_named_and_rest_still_runs(env, monkeypatch):
    monkeypatch.setitem(sys.modules, "service.enrich_agent", None)
    monkeypatch.setitem(sys.modules, "service.outreach_agent", None)
    monkeypatch.setitem(sys.modules, "service.context_agent", None)
    monkeypatch.setitem(sys.modules, "service.org_context", None)
    out = env / "snapshot.json"
    report = {r["stage"]: r for r in pipeline.run_pipeline(AS_OF, out=out)}
    assert report["enrich"]["status"] == "missing" and "PR #5" in report["enrich"]["detail"]
    assert report["outreach"]["status"] == "missing" and "PR #7" in report["outreach"]["detail"]
    assert report["icp"]["status"] == "missing" and "42" in report["icp"]["detail"]
    assert report["context"]["status"] == "missing" and "build_context" in report["context"]["detail"]
    assert report["export"]["status"] == "ok" and out.exists()


def test_icp_stage_saves_prospects_even_before_draft_prospect_lands(env, stubs):
    del sys.modules["service.outreach_agent"].draft_prospect
    report = {r["stage"]: r for r in pipeline.run_pipeline(AS_OF, out=env / "snapshot.json")}
    assert report["icp"]["status"] == "ok"
    assert "first-touch drafts skipped: needs outreach_agent.draft_prospect (86)" in report["icp"]["detail"]
    conn = db.connect()
    assert conn.execute("SELECT COUNT(*) FROM prospects WHERE status = 'new'").fetchone()[0] == 2
    assert conn.execute("SELECT COUNT(*) FROM outreach_drafts WHERE prospect_id IS NOT NULL").fetchone()[0] == 0
    conn.close()
