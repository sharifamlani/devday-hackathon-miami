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
                    facts=[ProspectFact(fact=f"Funds youth programs {i}.", url=f"https://{name[:3].lower()}/{i}")
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
             prospect("Peacock Foundation"),
             prospect("Peacock Foundation"),                 # duplicate
             prospect("Thin Co", facts=1),                   # fewer than 2 facts
             prospect("Dead Links Fund")]
    monkeypatch.setattr(icp_agent.Runner, "run_sync",
                        lambda agent, prompt: SimpleNamespace(final_output=SimpleNamespace(prospects=found)))
    monkeypatch.setattr(icp_agent, "url_loads", lambda url: not url.startswith("https://dea"))

    out = icp_agent.find_prospects(ICP, {"Amazon Inc"}, refresh=True)
    assert [p["name"] for p in out] == ["Peacock Foundation"]
    p = out[0]
    assert p["status"] == "new" and len(p["facts"]) == 2
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
