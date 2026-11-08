"""A giver's next step (their next open task) everywhere it shows: GET /donors (Givers rows), GET /donors/{id}
(the profile header), GET /people, and the chat agent's find_people, on both its paths. The public snapshot
never carries a Donors-tab private task. Tools are invoked as the agent invokes them (no model)."""

import json

from fastapi import FastAPI
from fastapi.testclient import TestClient

from service import chat_agent as ca, db, tasks
from service.tests.conftest import AS_OF
from service.tests.test_agent_tools import invoke


def giver_ids(db_file):
    conn = db.connect(db_file)
    try:
        return [r[0] for r in conn.execute("SELECT id FROM donors WHERE contact_type = 'giver' ORDER BY id LIMIT 2")]
    finally:
        conn.close()


def add_task(db_file, **fields):
    conn = db.connect(db_file)
    try:
        return tasks.create_task(conn, **fields)[0]
    finally:
        conn.close()


def data_client():
    from service.routes_data import router
    app = FastAPI()
    app.include_router(router)
    return TestClient(app)


def test_givers_rows_and_profile_carry_next_step_future_and_overdue(db_file):
    """S2 through the API: a task due later reads ' · Nov 12'; an older open one wins as ' · overdue'."""
    gina = giver_ids(db_file)[0]
    add_task(db_file, kind="call", title="Call about the gala table", person_id=gina, due="2026-11-12")
    c = data_client()
    row = next(d for d in c.get("/donors").json() if d["id"] == gina)
    assert row["next_step"] == "Call about the gala table · Nov 12"
    assert c.get(f"/donors/{gina}").json()["next_step"] == "Call about the gala table · Nov 12"
    add_task(db_file, kind="email", title="Send the tax receipt", person_id=gina, due="2026-11-01")
    assert c.get(f"/donors/{gina}").json()["next_step"] == "Send the tax receipt · overdue"


def test_find_people_returns_next_step_on_both_paths(db_file, monkeypatch):
    """S4: the agent sees the same next_step as GET /people, through list_people and through the SQL fallback."""
    gina = giver_ids(db_file)[0]
    add_task(db_file, kind="call", title="Call Gina", person_id=gina, due=AS_OF.isoformat())
    by_list = {p["id"]: p for p in invoke("find_people", limit=50)["people"]}
    assert by_list[gina]["next_step"] == "Call Gina"
    monkeypatch.setattr(ca, "tab_people", lambda tab: None)                   # an older build: the SQL path
    by_sql = {p["id"]: p for p in invoke("find_people", limit=50)["people"]}
    assert by_sql[gina]["next_step"] == "Call Gina"
    live = {p["id"]: p["next_step"] for p in data_client().get("/people", params={"type": "giver"}).json()["people"]}
    assert live[gina] == by_list[gina]["next_step"] == by_sql[gina]["next_step"]


def test_the_snapshot_donors_and_details_never_show_a_private_task(db_file):
    from service.export_snapshot import build_snapshot

    gina = giver_ids(db_file)[0]
    conn = db.connect(db_file)
    db.create_schema(conn)
    tasks.crm_create(conn, {"contact_id": gina, "type": "call", "text": "Private follow-up",
                            "due_date": AS_OF.isoformat()})
    assert data_client().get(f"/donors/{gina}").json()["next_step"] == "Private follow-up"   # staff see it live
    snap = build_snapshot(conn, rescore=False)
    conn.close()
    assert "Private follow-up" not in json.dumps(snap)
    row = next(d for d in snap["donors"] if d["id"] == gina)
    assert row["next_step"] != "Private follow-up"
    assert snap["donor_details"][str(gina)]["next_step"] == row["next_step"]
