import json

from service import db, enrich_agent
from service.enrich_agent import Fact, save_facts

FACTS = [
    Fact(fact="Funds youth programs in Miami-Dade.", source_url="https://example.org/a", retrieved_at="2026-11-07T00:00:00+00:00"),
    Fact(fact="Board lists a Miami office.", source_url="https://example.org/b", retrieved_at="2026-11-07T00:00:00+00:00"),
]


def test_save_facts_db_is_idempotent(tmp_path, monkeypatch):
    path = tmp_path / "donors.db"
    monkeypatch.setenv("DONORS_DB", str(path))
    conn = db.connect(path)
    db.create_schema(conn)
    donor_id = db.insert_donor(conn, {"full_name": "Example Foundation", "donor_type": "organization"})
    conn.commit()
    conn.close()

    assert save_facts(donor_id, FACTS, "run1") == 2
    assert save_facts(donor_id, FACTS, "run2") == 0        # same facts again: nothing new
    assert save_facts(donor_id, FACTS[:1] + FACTS[:1], "run3") == 0

    conn = db.connect(path)
    rows = conn.execute("SELECT fact, agent_run_id FROM research_facts WHERE donor_id = ?", (donor_id,)).fetchall()
    conn.close()
    assert len(rows) == 2 and {r["agent_run_id"] for r in rows} == {"run1"}


def test_save_facts_json_fallback_is_idempotent(tmp_path, monkeypatch):
    monkeypatch.setenv("DONORS_DB", str(tmp_path / "missing.db"))
    out = tmp_path / "research_facts.json"
    monkeypatch.setattr(enrich_agent, "FACTS_JSON", out)

    assert save_facts(7, FACTS, "run1") == 2
    assert save_facts(7, FACTS, "run2") == 0
    assert save_facts(8, FACTS[:1], "run3") == 1           # another donor may share a fact
    assert len(json.loads(out.read_text(encoding="utf-8"))) == 3
