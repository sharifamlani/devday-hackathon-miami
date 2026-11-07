import json
import time
from types import SimpleNamespace

from service import db, icp_agent
from service.icp_agent import Prospect, ProspectFact

ICP = {
    "traits": [
        {"trait": "sector", "value": "Foundations", "evidence": [{"donor": "A", "fact": "x", "url": "https://a"}]},
        {"trait": "causes", "value": "Youth", "evidence": [{"donor": "A", "fact": "x", "url": "https://a"}]},
        {"trait": "geography", "value": "Miami-Dade", "evidence": [{"donor": "B", "fact": "y", "url": "https://b"}]},
        {"trait": "foundation_priorities", "value": "Youth", "evidence": [{"donor": "B", "fact": "y", "url": "https://b"}]},
    ],
    "stats": {"org_donors": 3, "priority: Empower Youth & Families": 3, "priority: Generate Prosperity": 1,
              "priority: Eliminate Inequities": 1},
    "evidence": [],
}


def prospect(name, city="Miami", priority="Empower Youth & Families", facts=2, traits=("sector", "causes")):
    return Prospect(name=name, org_type="foundation", city=city, matched_traits=list(traits), priority=priority,
                    facts=[ProspectFact(fact="Funds youth programs in Miami-Dade.", url=f"https://{name[:3].lower()}/{i}",
                                        quote="The Foundation funds youth programs in Miami-Dade")
                           for i in range(facts)])


def test_icp_stats_from_seeded_db(db_file):
    conn = db.connect()
    stats = icp_agent.icp_stats(conn)
    conn.close()
    names = [d["name"] for d in stats["donors"]]
    assert "Amazon" in names and "Maria Delgado" not in names          # organizations only
    assert stats["org_donors"] == len(names)
    band = stats["lifetime_band"]
    assert band["min"] <= band["median"] <= band["max"]
    assert set(stats["priority_counts"]) == set(icp_agent.PRIORITIES)
    flat = icp_agent.flat_stats(stats)
    assert all(isinstance(v, (int, float)) for v in flat.values()) and flat["org_donors"] == len(names)
    facts = icp_agent.org_facts(db.connect())
    assert facts and all(isinstance(f["donor_id"], int) for f in facts)


def test_fit_score_is_deterministic_and_ranks_geography():
    miami = {"name": "M", "city": "Miami", "priority": "Empower Youth & Families", "matched_traits": ["sector"],
             "facts": [{"fact": "Funds youth and family programs.", "url": "u"}]}
    boca = {**miami, "city": "Boca Raton"}
    tampa = {**miami, "city": "Tampa"}
    scores = [icp_agent.fit_score(p, ICP) for p in (miami, boca, tampa)]
    assert scores == sorted(scores, reverse=True) and len(set(scores)) == 3
    assert icp_agent.fit_score(miami, ICP) == icp_agent.fit_score(dict(miami), ICP)
    assert 0 <= scores[-1] <= scores[0] <= 100


def test_find_prospects_excludes_donors_and_thin_or_dead_sources(tmp_path, monkeypatch):
    monkeypatch.setattr(icp_agent, "ICP_CACHE", tmp_path / "icp_cache.json")
    found = [prospect("Amazon, Inc."),                       # current donor (punctuation-insensitive)
             prospect("Peacock Foundation", facts=3),        # fact 3 cites a page that doesn't state it
             prospect("Peacock Foundation"),                 # duplicate
             prospect("Thin Co", facts=1),                   # fewer than 2 facts
             prospect("Dead Links Fund")]
    monkeypatch.setattr(icp_agent.Runner, "run_sync",
                        lambda agent, prompt: SimpleNamespace(final_output=SimpleNamespace(prospects=found)))
    # Every live page states "funds youth programs in miami-dade" except the dead one and one page that
    # loads but doesn't state its fact (the homepage problem)
    page = "about us: the foundation funds youth programs in miami-dade and broward every year."
    monkeypatch.setattr(icp_agent, "page_text", lambda url: None if url.startswith("https://dea")
                        else "mission only" if url == "https://pea/2" else page)

    out = icp_agent.find_prospects(ICP, {"Amazon Inc"}, refresh=True)
    assert [p["name"] for p in out] == ["Peacock Foundation"]
    p = out[0]
    assert p["status"] == "new" and [f["url"] for f in p["facts"]] == ["https://pea/0", "https://pea/1"]
    assert all(f["via"] == "web search" and f["retrieved_at"] and f["quote"] for f in p["facts"])
    assert p["fit_score"] == sum(p["fit_breakdown"].values())


def test_cached_run_is_fast_and_shaped(tmp_path, monkeypatch):
    cache = tmp_path / "icp_cache.json"
    cache.write_text(json.dumps({"generated_at": "t", "icp": ICP, "prospects": []}), encoding="utf-8")
    monkeypatch.setattr(icp_agent, "ICP_CACHE", cache)
    start = time.perf_counter()
    run = icp_agent.run_icp()
    assert time.perf_counter() - start < 1
    assert set(run) == {"generated_at", "icp", "prospects"}
    assert icp_agent.build_profile() == ICP


CONTEXT = [
    {"fact": "Funded South Dade youth scholarships.", "url": "https://mf/1", "posted_at": "2026-10-01",
     "priority": "Empower Youth & Families", "weight": 1.0},
    {"fact": "Hurricane resilience grants.", "url": "https://mf/2", "posted_at": "2026-03-01",
     "priority": "Build Climate & Disaster Resilience", "weight": 0.3},
]


def test_org_context_falls_back_to_json_then_empty(conn, tmp_path, monkeypatch):
    facts = tmp_path / "org_facts.json"
    facts.write_text(json.dumps({"facts": [
        {"date": "2026-01-05", "fact": "Old climate work.", "url": "https://mf/a", "priority": "Build Climate & Disaster Resilience"},
        {"date": "2026-10-20", "fact": "New youth work.", "url": "https://mf/b", "priority": "Empower Youth & Families"}]}),
        encoding="utf-8")
    monkeypatch.setattr(icp_agent, "ORG_FACTS_JSON", facts)
    rows = icp_agent.load_org_context(conn)             # no org_context table yet → JSON fallback
    assert [r["url"] for r in rows] == ["https://mf/b", "https://mf/a"]
    monkeypatch.setattr(icp_agent, "ORG_FACTS_JSON", tmp_path / "missing.json")
    assert icp_agent.load_org_context(conn) == []


def test_recency_weight_prefers_newer_work():
    as_of = icp_agent.datetime(2026, 11, 8)
    weights = [icp_agent.recency_weight(d, as_of) for d in ("2026-10-01", "2026-06-01", "2026-01-01", "2024-01-01", None)]
    assert weights == [1.0, 0.6, 0.3, 0.1, 0.1]


def test_context_adds_recent_focus_and_matched_context():
    youth = {"name": "Y", "city": "Miami", "priority": "Empower Youth & Families", "matched_traits": ["sector"],
             "facts": [{"fact": "Funds youth programs.", "url": "u"}]}
    climate = {**youth, "priority": "Build Climate & Disaster Resilience",
               "facts": [{"fact": "Funds hurricane recovery.", "url": "u"}]}
    with_ctx = {**ICP, "recent_context": CONTEXT}
    assert "recent_focus" not in icp_agent.fit_breakdown(youth, ICP)          # donors-only fallback
    assert icp_agent.fit_breakdown(youth, with_ctx)["recent_focus"] > icp_agent.fit_breakdown(climate, with_ctx)["recent_focus"]
    assert icp_agent.matched_context(youth, with_ctx) == [
        {"fact": "Funded South Dade youth scholarships.", "url": "https://mf/1", "posted_at": "2026-10-01"}]
    assert icp_agent.matched_context(youth, ICP) == []


def test_quote_must_appear_on_the_page():
    text = icp_agent.normalize_text("Grants support “youth and family programs” across Miami–Dade County.")
    assert icp_agent.quote_on_page('support "youth and family programs" across Miami-Dade', text)
    assert not icp_agent.quote_on_page("support adult education programs across Miami-Dade", text)
    assert not icp_agent.quote_on_page("youth and family", text)             # too short to prove anything
    assert not icp_agent.quote_on_page("support youth and family programs across", None)


def test_numbers_in_a_fact_must_be_on_the_page():
    text = icp_agent.normalize_text("In 2025 our attorneys gave 3,582 pro bono hours to Miami nonprofits.")
    assert icp_agent.numbers_on_page("Gave 3,582 pro bono hours in 2025.", text)
    assert not icp_agent.numbers_on_page("Gave 5,000 pro bono hours in 2025.", text)
    assert icp_agent.fact_on_page("Gave 3,582 hours in 2025.", "our attorneys gave 3,582 pro bono hours to Miami", text)
