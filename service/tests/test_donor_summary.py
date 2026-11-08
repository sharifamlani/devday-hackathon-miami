""""About <donor>": the agent's running summary (service/donor_summary.py).

Acceptance S1-S4 and S-neg from the feature card, offline: SUMMARY_WRITER=rules stands in for the model, and one
test stands a fake in for the model to check the grounding guard. Fixture people are fictional."""

import json
import sqlite3

import pytest
from fastapi.testclient import TestClient

from service import config, db
from service import donor_summary as ds
from service.main import app
from service.tests.test_agent_tools import invoke, one, undo

ANNE = ("I had a great conversation with Rafael Quintero. He was very pleasant. He talked about his wife Anne, "
        "and they're going on vacation next month.")
FIVE_K = "Rafael said he'd like to volunteer at the 5K."


@pytest.fixture
def people(db_file, monkeypatch):
    monkeypatch.setenv("SUMMARY_WRITER", "rules")
    monkeypatch.setattr(config, "HAS_OPENAI_KEY", False)
    conn = sqlite3.connect(db_file)
    ids = {}
    for full, first in (("Rafael Quintero", "Rafael"), ("Dana Ortiz", "Dana"), ("Dana Ortega", "Dana")):
        ids[full] = conn.execute("INSERT INTO donors (full_name, first_name, donor_type) VALUES (?, ?, 'individual')",
                                 (full, first)).lastrowid
    conn.execute("INSERT INTO gifts (donor_id, amount, gift_date) VALUES (?, 250, '2026-06-01')", (ids["Rafael Quintero"],))
    conn.commit()
    conn.close()
    return ids


def summary_row(db_file, donor_id):
    return one(db_file, "SELECT * FROM donor_summaries WHERE donor_id = ?", donor_id)


def test_s1_the_chat_tool_writes_rafaels_summary_and_the_api_returns_it(people, db_file):
    rafael = people["Rafael Quintero"]
    with TestClient(app) as client:
        assert client.get(f"/donors/{rafael}").json()["summary"] is None            # empty to start
        out = invoke("update_donor_summary", name="Rafael Quintero", new_info=ANNE)
        assert out["person_id"] == rafael and out["undo_token"]
        from service.chat_agent import summarize
        assert summarize(out) == "Updated Rafael's summary"
        detail = client.get(f"/donors/{rafael}").json()
    assert "Anne" in detail["summary"] and "vacation" in detail["summary"]
    assert detail["summary_updated_at"]
    kinds = [s["kind"] for s in detail["summary_sources"]]
    assert kinds[0] == "chat" and "gift" in kinds                                     # newest first; giving pattern
    assert "Anne" in summary_row(db_file, rafael)["summary"]                           # the SQL row


def test_s2_a_second_update_keeps_both_facts_within_five_sentences(people, db_file):
    rafael = people["Rafael Quintero"]
    invoke("update_donor_summary", person_id=rafael, new_info=ANNE)
    invoke("update_donor_summary", person_id=rafael, new_info=FIVE_K)
    text = summary_row(db_file, rafael)["summary"]
    assert "Anne" in text and "5K" in text
    assert 1 <= len(ds.sentences(text)) <= ds.MAX_SENTENCES
    assert text.index("5K") < text.index("Anne")                                     # newest first
    sources = json.loads(summary_row(db_file, rafael)["sources"])
    assert [s["kind"] for s in sources].count("chat") == 2


def test_s3_saving_a_call_note_updates_the_donors_summary(people, db_file):
    rafael = people["Rafael Quintero"]
    note = {"title": "Call with Rafael", "destinations": [{"kind": "donor", "id": str(rafael), "label": "Rafael"}],
            "notes": "Rafael asked about the scholarship fund for his daughter Lucia."}
    with TestClient(app) as client:
        saved = client.post("/calls", json=note).json()
        detail = client.get(f"/donors/{rafael}").json()
    assert "Lucia" in detail["summary"]
    assert (detail["summary_sources"][0]["kind"], detail["summary_sources"][0]["ref"]) == ("call_note", saved["id"])
    with TestClient(app) as client:                                                 # the same note again: no rewrite
        client.post("/calls", json={**note, "id": saved["id"]})
    actions = one(db_file, "SELECT COUNT(*) AS n FROM agent_actions WHERE target = ?", f"summary:{rafael}")["n"]
    assert actions == 1


def test_s4_undo_restores_the_previous_text(people, db_file):
    rafael = people["Rafael Quintero"]
    invoke("update_donor_summary", person_id=rafael, new_info=ANNE)
    first = summary_row(db_file, rafael)["summary"]
    second = invoke("update_donor_summary", person_id=rafael, new_info=FIVE_K)
    assert summary_row(db_file, rafael)["summary"] != first
    assert undo(second["undo_token"])["undone"] is True
    assert summary_row(db_file, rafael)["summary"] == first
    first_token = one(db_file, "SELECT token FROM agent_actions WHERE target = ? AND undone_at IS NULL",
                      f"summary:{rafael}")["token"]
    undo(first_token)
    assert summary_row(db_file, rafael) is None                                        # back to no summary at all


def test_s_neg_an_unknown_name_writes_nothing_and_asks_who(people, db_file):
    out = invoke("update_donor_summary", name="Zelda Nobody", new_info="She loves jazz.")
    assert "couldn't find anyone named Zelda Nobody" in out["error"] and "undo_token" not in out
    assert one(db_file, "SELECT COUNT(*) AS n FROM donor_summaries")["n"] == 0


def test_s_neg_an_ambiguous_name_asks_which_one(people, db_file):
    out = invoke("update_donor_summary", name="Dana", new_info="She's moving to Tampa.")
    assert out["error"].startswith("which one did you mean") and "Dana Ortiz" in out["error"] and "Dana Ortega" in out["error"]
    assert one(db_file, "SELECT COUNT(*) AS n FROM donor_summaries")["n"] == 0


def test_a_model_paragraph_that_invents_a_name_is_rejected_for_the_rule(people, monkeypatch):
    monkeypatch.setattr(ds, "model_available", lambda: True)
    monkeypatch.setattr(ds, "model_rewrite", lambda *a: "Rafael is married to Anne. They are visiting Barcelona soon.")
    text, writer = ds.rewrite("Rafael Quintero", "", ANNE, "1 gift")
    assert writer == "rules" and "Barcelona" not in text
    monkeypatch.setattr(ds, "model_rewrite", lambda *a: "Rafael is married to Anne. They plan a vacation next month.")
    assert ds.rewrite("Rafael Quintero", "", ANNE, "1 gift") == (
        "Rafael is married to Anne. They plan a vacation next month.", "model")


def test_public_mode_and_the_snapshot_never_show_the_summary(people, monkeypatch):
    rafael = people["Rafael Quintero"]
    invoke("update_donor_summary", person_id=rafael, new_info=ANNE)
    from service.export_snapshot import snapshot_donor
    conn = db.connect()
    try:
        snap = snapshot_donor(rafael, conn)
    finally:
        conn.close()
    assert snap["summary"] is None and snap["summary_sources"] == []
    monkeypatch.setattr(config, "PUBLIC_MODE", True)       # the route itself (the middleware also gates origins)
    from service.routes_data import get_donor
    conn = db.connect()
    try:
        detail = get_donor(rafael, conn)
    finally:
        conn.close()
    assert detail["summary"] is None and detail["summary_sources"] == []


def test_the_tool_is_a_write_refused_in_the_public_preview():
    from service import chat_agent as ca
    assert "update_donor_summary" in {t.name for t in ca.TOOLS}
    assert "update_donor_summary" not in ca.READ_ONLY_TOOLS


def test_the_writer_uses_the_luna_model_from_openai_model_fast(monkeypatch):
    monkeypatch.setenv("OPENAI_MODEL_FAST", "gpt-6-luna")
    monkeypatch.setenv("OPENAI_MODEL_DEFAULT", "gpt-6.1-sol")
    monkeypatch.setenv("OPENAI_API_KEY", "sk-test")
    assert ds.summary_model().model == "gpt-6-luna"
    monkeypatch.delenv("SUMMARY_WRITER")
    assert ds.model_available() is True                        # gated on OPENAI_MODEL_FAST, not DEFAULT


def accented(db_file) -> dict:
    conn = sqlite3.connect(db_file)
    try:
        ids = {}
        for name, first in (("Joséphine Abara-Lutz", "Joséphine"), ("Renée Okafor", "Renée"), ("Renee Okafor-Bell", "Renee")):
            ids[name] = conn.execute("INSERT INTO donors (full_name, first_name, donor_type, contact_type) "
                                     "VALUES (?, ?, 'individual', 'giver')", (name, first)).lastrowid
        conn.commit()
    finally:
        conn.close()
    return ids


def test_names_match_without_accents_and_with_part_of_a_hyphenated_surname(db_file):
    """82: 'add a note to Maria Delgado' missed María Delgado-Ruiz: the lookup wasn't accent-insensitive."""
    ids = accented(db_file)
    conn = db.connect()
    try:
        assert ds.resolve(conn, name="Josephine Abara")["id"] == ids["Joséphine Abara-Lutz"]
        assert ds.resolve(conn, name="JOSÉPHINE abara-lutz")["id"] == ids["Joséphine Abara-Lutz"]
        assert ds.resolve(conn, name="Renee Okafor")["id"] == ids["Renée Okafor"]   # an exact name beats a partial one
        with pytest.raises(ds.WriteError, match="which one"):     # ambiguity is still asked, never guessed
            ds.resolve(conn, name="okafor")
    finally:
        conn.close()


def test_find_people_by_name_ignores_accents(db_file):
    ids = accented(db_file)
    found = [p["id"] for p in invoke("find_people", name="josephine abara", limit=50)["people"]]
    assert ids["Joséphine Abara-Lutz"] in found
