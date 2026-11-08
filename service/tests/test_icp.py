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
    async def fake_run(agent, prompt):
        return SimpleNamespace(final_output=SimpleNamespace(prospects=found))
    monkeypatch.setattr(icp_agent.Runner, "run", fake_run)
    # Every live page states "funds youth programs in miami-dade" except the dead one and one page that
    # loads but doesn't state its fact (the homepage problem)
    page = "about us: the foundation funds youth programs in miami-dade and broward every year."
    text_for = lambda url: None if url.startswith("https://dea") else "mission only" if url == "https://pea/2" else page
    monkeypatch.setattr(icp_agent, "fetch_pages", lambda urls, budget: {u: text_for(u) for u in urls})

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
    run = icp_agent.run_icp(use_cache=True)             # the precompute pipeline's explicit cache read
    assert time.perf_counter() - start < 1
    assert set(run) == {"generated_at", "icp", "prospects", "cached"} and run["cached"] is True
    assert icp_agent.build_profile(use_cache=True) == {**ICP, "cached": True}


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


def test_a_search_past_its_deadline_is_dropped(monkeypatch):
    import asyncio
    async def slow(agent, prompt):
        await asyncio.sleep(5)
    async def fast(agent, prompt):
        return SimpleNamespace(final_output=SimpleNamespace(prospects=["P"]))
    monkeypatch.setattr(icp_agent, "SEARCH_TIMEOUT_S", 0.2)
    calls = iter([slow, fast])
    monkeypatch.setattr(icp_agent.Runner, "run", lambda agent, prompt: next(calls)(agent, prompt))
    start = time.perf_counter()
    assert asyncio.run(icp_agent.run_searches(["a", "b"])) == ["P"]
    assert time.perf_counter() - start < 2


def test_reverify_keeps_only_facts_still_on_their_pages_and_merge_dedupes(monkeypatch):
    fact = {"fact": "Funds youth programs in Miami-Dade.", "quote": "The Foundation funds youth programs in Miami-Dade",
            "via": "web search", "retrieved_at": "t"}
    old = [
        {"name": "Kept Fund", "city": "Miami", "priority": "Empower Youth & Families", "matched_traits": ["sector"],
         "facts": [{**fact, "url": "https://k/1"}, {**fact, "url": "https://k/2"}], "status": "new"},
        {"name": "No Quote Co", "city": "Miami", "priority": "Empower Youth & Families", "matched_traits": [],
         "facts": [{"fact": "x", "url": "https://n/1"}, {"fact": "y", "url": "https://n/2"}], "status": "new"},
        {"name": "Amazon", "city": "Miami", "priority": "Empower Youth & Families", "matched_traits": [],
         "facts": [{**fact, "url": "https://k/1"}, {**fact, "url": "https://k/2"}], "status": "new"},
    ]
    monkeypatch.setattr(icp_agent, "fetch_pages",
                        lambda urls, budget: {u: "the foundation funds youth programs in miami-dade." for u in urls})
    kept = icp_agent.reverify(old, ICP, {"Amazon"})
    assert [p["name"] for p in kept] == ["Kept Fund"] and kept[0]["fit_score"] > 0
    new = [{**kept[0], "fit_score": 10}, {"name": "Fresh", "fit_score": 50}]
    assert [p["name"] for p in icp_agent.merge_prospects(new, kept)] == ["Fresh", "Kept Fund"]


def test_browser_render_sees_only_visible_text_and_needs_200(tmp_path):
    """Real Chromium against a local server: hidden table cells (Taft's case) and a 403 page don't count."""
    import functools, http.server, threading
    (tmp_path / "grants.html").write_text(
        "<html><body><p>We fund youth programs across Miami-Dade County every year.</p>"
        "<table style='display:none'><tr><td>Arc Broward</td><td>$450,000</td></tr></table></body></html>",
        encoding="utf-8")

    class Handler(http.server.SimpleHTTPRequestHandler):
        def do_GET(self):
            if self.path == "/blocked":
                self.send_error(403, "Access Denied")
            else:
                super().do_GET()
        def log_message(self, *args):
            pass

    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), functools.partial(Handler, directory=str(tmp_path)))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    base = f"http://127.0.0.1:{server.server_port}"
    try:
        pages = icp_agent.fetch_pages([f"{base}/grants.html", f"{base}/blocked"], 60)
    finally:
        server.shutdown()
    text = pages[f"{base}/grants.html"]
    assert "youth programs across miami-dade" in text and "450,000" not in text and "arc broward" not in text
    assert pages[f"{base}/blocked"] is None
    assert not icp_agent.fact_on_page("Taft gave Arc Broward $450,000.", "Arc Broward $450,000 employment transition", text)


def test_stats_count_only_giver_orgs_and_ok_gifts(conn):
    # 8b's PR #60 added these columns to the schema; add them only on an older schema.
    for table, col, ddl in [("donors", "contact_type", "TEXT NOT NULL DEFAULT 'giver'"),
                            ("gifts", "status", "TEXT NOT NULL DEFAULT 'ok'")]:
        if col not in {r[1] for r in conn.execute(f"PRAGMA table_info({table})")}:
            conn.execute(f"ALTER TABLE {table} ADD COLUMN {col} {ddl}")
    giver = db.insert_donor(conn, {"full_name": "Giver Fund", "donor_type": "organization",
                                   "gifts": [(1000, "2025-05-01", "check"), (1000, "2026-05-01", "check")]})
    db.insert_donor(conn, {"full_name": "Neighbor Org", "donor_type": "organization"})
    conn.execute("UPDATE donors SET contact_type = 'neighbor' WHERE full_name = 'Neighbor Org'")
    conn.execute("INSERT INTO gifts (donor_id, amount, gift_date, status) VALUES (?, 5000, '2026-06-01', 'declined')", (giver,))
    conn.commit()
    stats = icp_agent.icp_stats(conn)
    assert [d["name"] for d in stats["donors"]] == ["Giver Fund"]
    assert stats["donors"][0]["lifetime"] == 2000 and stats["donors"][0]["gifts"] == 2
