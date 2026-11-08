"""B10 agent tools (plan.md §21.9 smoke 12): each write tool changes its row, Undo restores it, and sends,
merges and deletes don't run without a person's approval.

Tools are invoked exactly as the agent invokes them (on_invoke_tool with JSON arguments). The approval
round trip needs a model and is skipped without OPENAI_API_KEY."""

import asyncio
import json
import os
import sqlite3

import pytest

from agents.tool_context import ToolContext

from service import config  # noqa: F401  (loads .env, so the live tests see the key)
from service import chat_agent as ca
from service import db

TOOLS = {t.name: t for t in ca.TOOLS}


def invoke(tool_name: str, /, **args) -> dict:
    tool = TOOLS[tool_name]
    payload = json.dumps(args)
    ctx = ToolContext(context=ca.ChatContext(tab="givers", approved_by="Test approver"), tool_name=tool_name,
                      tool_call_id=f"test-{tool_name}", tool_arguments=payload)
    out = asyncio.run(tool.on_invoke_tool(ctx, payload))
    return out if isinstance(out, dict) else json.loads(out)


def one(db_file, sql: str, *args):
    conn = sqlite3.connect(db_file)
    conn.row_factory = sqlite3.Row
    try:
        return conn.execute(sql, args).fetchone()
    finally:
        conn.close()


def undo(token: str) -> dict:
    return invoke("undo", undo_token=token)


def test_sends_merges_and_deletes_are_approval_gated_and_nothing_else():
    assert ca.APPROVAL_TOOLS == {"send", "merge_duplicate", "delete_task", "delete_calendar_item"}
    reads = {"find_people", "get_person", "get_alerts", "get_events", "get_calendar", "get_tasks",
             "get_call_notes", "search_context"}
    writes = {"update_person", "add_interest", "remove_interest", "accept_enrichment", "merge_duplicate",
              "dismiss_duplicate", "add_calendar_item", "move_calendar_item", "delete_calendar_item", "rsvp_event",
              "create_task", "update_task", "complete_task", "delete_task", "apply_after_call_actions",
              "draft_email", "draft_sms", "send", "undo"}
    assert reads | writes <= set(TOOLS)


def test_create_task_writes_a_row_and_undo_removes_it(db_file):
    out = invoke("create_task", kind="call", title="Thank Maria for her gift", person_id=1, due="2026-11-10")
    row = one(db_file, "SELECT * FROM tasks WHERE id = ?", out["id"])
    assert row["title"] == "Thank Maria for her gift" and row["due"] == "2026-11-10" and row["source"] == "agent"
    assert one(db_file, "SELECT actor FROM agent_actions WHERE token = ?", out["undo_token"])["actor"] == "agent"

    assert undo(out["undo_token"])["undone"] is True
    assert one(db_file, "SELECT * FROM tasks WHERE id = ?", out["id"]) is None


def test_update_and_complete_task_then_undo_restores(db_file):
    task = invoke("create_task", kind="email", title="Draft welcome note")
    upd = invoke("update_task", task_id=task["id"], title="Send welcome note", due="2026-11-12")
    assert one(db_file, "SELECT title, due FROM tasks WHERE id = ?", task["id"])["title"] == "Send welcome note"
    done = invoke("complete_task", task_id=task["id"])
    assert one(db_file, "SELECT done FROM tasks WHERE id = ?", task["id"])["done"] == 1

    undo(done["undo_token"])
    assert one(db_file, "SELECT done FROM tasks WHERE id = ?", task["id"])["done"] == 0
    undo(upd["undo_token"])
    row = one(db_file, "SELECT title, due FROM tasks WHERE id = ?", task["id"])
    assert (row["title"], row["due"]) == ("Draft welcome note", None)


def test_calendar_items_add_move_delete_and_undo(db_file):
    item = invoke("add_calendar_item", title="Board meeting", date="2026-11-12", time="15:00")
    cal = invoke("get_calendar", from_date="2026-11-01", to_date="2026-11-30")["items"]
    assert any(i["title"] == "Board meeting" and i["date"] == "2026-11-12" for i in cal)

    moved = invoke("move_calendar_item", ref=f"task:{item['id']}", date="2026-11-13")
    assert one(db_file, "SELECT due FROM tasks WHERE id = ?", item["id"])["due"] == "2026-11-13"
    undo(moved["undo_token"])
    assert one(db_file, "SELECT due FROM tasks WHERE id = ?", item["id"])["due"] == "2026-11-12"

    gone = invoke("delete_calendar_item", ref=f"task:{item['id']}")     # the card's approval is tested live below
    assert one(db_file, "SELECT deleted_at FROM tasks WHERE id = ?", item["id"])["deleted_at"]
    undo(gone["undo_token"])
    assert one(db_file, "SELECT deleted_at FROM tasks WHERE id = ?", item["id"])["deleted_at"] is None


def test_delete_task_and_undo(db_file):
    task = invoke("create_task", kind="other", title="Order name badges")
    gone = invoke("delete_task", task_id=task["id"])
    assert one(db_file, "SELECT deleted_at FROM tasks WHERE id = ?", task["id"])["deleted_at"]
    undo(gone["undo_token"])
    assert one(db_file, "SELECT deleted_at FROM tasks WHERE id = ?", task["id"])["deleted_at"] is None


def test_update_person_changes_fields_and_undo_restores(db_file):
    before = one(db_file, "SELECT email, city FROM donors WHERE id = 1")
    out = invoke("update_person", person_id=1, email="maria.new@example.com", city="Coral Gables")
    row = one(db_file, "SELECT email, city FROM donors WHERE id = 1")
    assert (row["email"], row["city"]) == ("maria.new@example.com", "Coral Gables")

    undo(out["undo_token"])
    row = one(db_file, "SELECT email, city FROM donors WHERE id = 1")
    assert (row["email"], row["city"]) == (before["email"], before["city"])


def test_update_person_refuses_unknown_people_and_empty_changes(db_file):
    assert "not found" in invoke("update_person", person_id=999, email="x@example.com")["error"]
    assert invoke("update_person", person_id=1)["error"] == "nothing to change"


def test_dismiss_duplicate_and_undo(db_file):
    sid = one(db_file, "SELECT id FROM duplicate_suggestions WHERE status = 'pending'")["id"]
    out = invoke("dismiss_duplicate", suggestion_id=sid)
    assert one(db_file, "SELECT status FROM duplicate_suggestions WHERE id = ?", sid)["status"] == "dismissed"
    undo(out["undo_token"])
    assert one(db_file, "SELECT status FROM duplicate_suggestions WHERE id = ?", sid)["status"] == "pending"


def test_merge_duplicate_and_undo_restores_both_people(db_file):
    s = one(db_file, "SELECT * FROM duplicate_suggestions WHERE status = 'pending'")
    count = one(db_file, "SELECT COUNT(*) AS n FROM donors")["n"]
    out = invoke("merge_duplicate", suggestion_id=s["id"])
    assert one(db_file, "SELECT COUNT(*) AS n FROM donors")["n"] == count - 1

    undo(out["undo_token"])
    assert one(db_file, "SELECT COUNT(*) AS n FROM donors")["n"] == count
    for side in ("donor_a_id", "donor_b_id"):
        assert one(db_file, "SELECT id FROM donors WHERE id = ?", s[side]) is not None


def test_undo_twice_and_unknown_tokens_are_refused(db_file):
    task = invoke("create_task", kind="other", title="Temp")
    undo(task["undo_token"])
    assert "already undone" in undo(task["undo_token"])["error"]
    assert undo("nope")["error"] == "unknown undo token"


def test_writes_not_on_this_build_say_so(db_file):
    import importlib.util
    if importlib.util.find_spec("service.interests") is None:                # until 42's PR #88 lands
        assert "not available yet" in invoke("add_interest", person_id=1, tag="arts_culture")["error"]
    # B6 (#90) switched these on: event_audience.rsvp exists and after_call_agent.apply_actions is there


def test_rsvp_and_after_call_tools_are_live(db_file):
    from service import db as _db
    c = _db.connect(db_file)
    eid = c.execute("INSERT INTO events (title, starts_at, source_url) VALUES ('Beach Cleanup (SAMPLE)', '2026-11-21', "
                    "'https://example.org/beach')").lastrowid
    c.execute("INSERT INTO event_audience (event_id, person_id, reason) VALUES (?, 1, 'test')", (eid,))
    c.commit(); c.close()
    got = invoke("rsvp_event", event_id=eid, person_id=1, rsvp="yes")
    assert got.get("rsvp") == "yes" and got.get("undo_token")
    undo(got["undo_token"])
    assert "no call note" in invoke("apply_after_call_actions", call_note_id="c1", action_ids=["a"])["error"]


def test_reads_return_rows(db_file):
    assert invoke("get_person", person_id=1)["full_name"] == "Maria Delgado"
    assert invoke("get_person", person_id=999)["error"]
    invoke("create_task", kind="call", title="Call James", person_id=3, due="2026-11-09")
    assert any(t["title"] == "Call James" for t in invoke("get_tasks", person_id=3)["tasks"])
    assert invoke("get_call_notes", person_id=1)["call_notes"] == []
    assert "results" in invoke("search_context", query="Give Miami Day")


needs_key = pytest.mark.skipif(not os.getenv("OPENAI_API_KEY"), reason="the approval round trip runs the model")


@needs_key
@pytest.mark.parametrize("approve", [False, True])
def test_live_delete_pauses_for_approval_and_only_runs_when_approved(db_file, approve):
    task = invoke("create_task", kind="other", title="Old flyer reprint")

    paused = ca.run_chat(f"Delete task {task['id']} (Old flyer reprint).", "givers")

    assert paused["run_id"] and [a["tool"] for a in paused["approvals"]] == ["delete_task"]
    assert one(db_file, "SELECT deleted_at FROM tasks WHERE id = ?", task["id"])["deleted_at"] is None

    call_id = paused["approvals"][0]["call_id"]
    done = ca.resume_chat(paused["run_id"], {call_id: approve}, "Test approver")
    deleted = one(db_file, "SELECT deleted_at FROM tasks WHERE id = ?", task["id"])["deleted_at"]
    assert bool(deleted) is approve and not done["approvals"]


def test_add_and_remove_interest_with_undo(db_file):
    interests = pytest.importorskip("service.interests")        # 42's PR #88
    added = invoke("add_interest", person_id=1, tag="arts_culture")
    assert added["undo_token"].startswith("int_")
    tags = lambda: {i["tag"] for i in interests.list_interests(db.connect(db_file), 1)}
    assert "arts_culture" in tags()
    undo(added["undo_token"])
    assert "arts" not in tags()

    invoke("add_interest", person_id=1, tag="arts_culture")
    removed = invoke("remove_interest", person_id=1, tag="arts_culture")
    assert "arts" not in tags()
    undo(removed["undo_token"])
    assert "arts_culture" in tags()


def test_post_undo_route_reverts_any_write_not_just_tasks(db_file):
    from fastapi.testclient import TestClient
    from service.main import app
    c = TestClient(app)
    edit = invoke("update_person", person_id=1, city="Coral Gables")
    task = invoke("create_task", kind="call", title="Call Maria")

    assert c.post(f"/undo/{edit['undo_token']}").json()["undone"] is True
    assert one(db_file, "SELECT city FROM donors WHERE id = 1")["city"] != "Coral Gables"
    assert c.post(f"/undo/{task['undo_token']}").json()["undone"] is True
    assert c.post(f"/undo/{task['undo_token']}").status_code == 409            # already undone (tasks.undo)
    assert c.post("/undo/nope").status_code == 404


def test_delete_steps_say_deleted_and_the_prompt_allows_send_via_approval():
    from agents.items import ToolCallItem, ToolCallOutputItem
    from openai.types.responses import ResponseFunctionToolCall
    call = ResponseFunctionToolCall(type="function_call", call_id="c1", name="delete_task", arguments='{"task_id": 4}')
    from agents import Agent
    who = Agent(name="t")
    items = [ToolCallItem(agent=who, raw_item=call),
             ToolCallOutputItem(agent=who, raw_item={"call_id": "c1", "type": "function_call_output", "output": ""},
                                output={"id": 4, "kind": "other", "title": "Order badges", "undo_token": "t"})]
    assert ca.steps_from(items)[0]["summary"] == "deleted: Order badges"
    assert "You cannot send" not in ca.INSTRUCTIONS and "call send" in ca.INSTRUCTIONS


def test_get_and_apply_after_call_actions(db_file, monkeypatch, tmp_path):
    aca = pytest.importorskip("service.after_call_agent")          # 86's B6 (PR #90)
    monkeypatch.setenv("AFTER_CALL_DRAFTER", "rules")
    monkeypatch.setattr(aca, "PROPOSALS_FILE", tmp_path / "proposals.json")
    aca._PROPOSALS.clear()
    conn = sqlite3.connect(db_file)
    script = [("you", "Staff", "Hi Maria, thanks for taking my call."),
              ("them", "Maria", "I still want to keep giving $50 a month."),
              ("you", "Staff", "Wonderful, thank you so much.")]
    conn.execute("INSERT INTO call_notes (id, title, created_at, transcript, destinations) VALUES (?, ?, ?, ?, ?)",
                 ("note-b10", "Call with Maria", "2026-11-08T10:00:00",
                  json.dumps([{"speaker": s, "name": n, "text": t, "at": i} for i, (s, n, t) in enumerate(script)]),
                  json.dumps([{"kind": "donor", "id": 1, "label": "Maria Delgado"}])))
    conn.commit()
    conn.close()

    proposed = invoke("get_after_call_actions", call_note_id="note-b10")
    pledge = next(a for a in proposed["actions"] if a["type"] == "record_pledge")
    assert one(db_file, "SELECT COUNT(*) AS n FROM pledges")["n"] == 0                   # proposing writes nothing
    invoke("apply_after_call_actions", call_note_id="note-b10", action_ids=[pledge["id"]])
    assert one(db_file, "SELECT COUNT(*) AS n FROM pledges WHERE person_id = 1")["n"] == 1
    assert "error" in invoke("get_after_call_actions", call_note_id="no-such-note")


def test_rsvp_event_and_undo(db_file):
    conn = sqlite3.connect(db_file)
    if "rsvp" not in {r[1] for r in conn.execute("PRAGMA table_info(event_audience)")}:
        conn.close()
        pytest.skip("event_audience.rsvp arrives with 86's B6 (PR #90)")
    event = conn.execute("INSERT INTO events (title, starts_at, source_url) VALUES "
                         "('Beach Cleanup (SAMPLE)', '2026-11-21', 'https://example.org/beach')").lastrowid
    conn.execute("INSERT INTO event_audience (event_id, person_id, reason) VALUES (?, 1, 'test')", (event,))
    conn.commit()
    conn.close()

    out = invoke("rsvp_event", event_id=event, person_id=1, rsvp="yes")
    assert one(db_file, "SELECT rsvp FROM event_audience WHERE event_id = ? AND person_id = 1", event)["rsvp"] == "yes"
    undo(out["undo_token"])
    assert one(db_file, "SELECT rsvp FROM event_audience WHERE event_id = ? AND person_id = 1", event)["rsvp"] is None


def test_add_contact_appears_in_people_and_undo_removes_it(db_file):
    from fastapi.testclient import TestClient
    from service.main import app
    c = TestClient(app)
    out = invoke("add_contact", full_name="Rosa Example", email="rosa@example.org", contact_type="neighbor")

    pid = out["person_id"]
    row = one(db_file, "SELECT donor_type, contact_type, source_row FROM donors WHERE id = ?", pid)
    assert (row["donor_type"], row["contact_type"], row["source_row"]) == ("individual", "neighbor", "AGENT")
    assert one(db_file, "SELECT COUNT(*) AS n FROM gifts WHERE donor_id = ?", pid)["n"] == 0
    assert pid in {p["id"] for p in c.get("/people", params={"type": "neighbor"}).json()["people"]}

    assert c.post(f"/undo/{out['undo_token']}").json()["undone"] is True
    assert one(db_file, "SELECT id FROM donors WHERE id = ?", pid) is None


def test_add_contact_organization_is_an_org_for_enrich(db_file):
    from service.enrich_agent import skip_reason
    out = invoke("add_contact", full_name="John S. and James L. Knight Foundation", donor_type="organization")
    row = one(db_file, "SELECT donor_type, org_name, first_name FROM donors WHERE id = ?", out["person_id"])
    assert (row["donor_type"], row["org_name"], row["first_name"]) == \
        ("organization", "John S. and James L. Knight Foundation", None)
    assert skip_reason(row["org_name"], row["donor_type"]) is None                  # Enrich may research it


def test_add_contact_undo_refused_once_something_uses_it(db_file):
    out = invoke("add_contact", full_name="Busy Example", contact_type="giver")
    invoke("create_task", kind="call", title="Call Busy Example", person_id=out["person_id"])
    assert "already used" in undo(out["undo_token"])["error"]
    assert one(db_file, "SELECT id FROM donors WHERE id = ?", out["person_id"]) is not None


def test_add_contact_refuses_a_blank_name(db_file):
    assert invoke("add_contact", full_name="  ")["error"] == "a contact needs a name"


def test_add_contact_defaults_to_giver_and_expands_a_unique_short_name(db_file):
    plain = invoke("add_contact", full_name="Sam Example")
    assert one(db_file, "SELECT contact_type FROM donors WHERE id = ?", plain["person_id"])["contact_type"] == "giver"

    knight = invoke("add_contact", full_name="Knight Foundation", donor_type="organization")
    assert knight["full_name"] == "John S. and James L. Knight Foundation"         # exact name: cached tags match
    assert "which one did you mean" in invoke("add_contact", full_name="Foundation",
                                              donor_type="organization")["error"]


def test_rsvp_step_reads_like_a_sentence():
    assert ca.summarize({"event_id": 3, "person_id": 7, "rsvp": "yes", "full_name": "Rosa Delgado",
                         "event_title": "Beach Cleanup", "starts_at": "2026-11-21", "undo_token": "t"}) == \
        "RSVP: Rosa Delgado → Beach Cleanup (Sat Nov 21), attending"
    assert ca.summarize({"event_id": 3, "person_id": 7, "rsvp": "no"}) == "RSVP: person 7 → event 3, not attending"


def lapsed_and_tagged(db_file) -> tuple[int, int]:
    """Two givers: one whose last gift is 3 days old, one 60 days old with interests on file and from Enrich."""
    conn = sqlite3.connect(db_file)
    try:
        recent, lapsed = [r[0] for r in conn.execute(
            "SELECT id FROM donors WHERE contact_type = 'giver' ORDER BY id LIMIT 2")]
        conn.execute("DELETE FROM gifts WHERE donor_id IN (?, ?)", (recent, lapsed))
        conn.execute("INSERT INTO gifts (donor_id, amount, gift_date, channel) VALUES (?, 50, '2026-11-05', 'online')",
                     (recent,))
        conn.execute("INSERT INTO gifts (donor_id, amount, gift_date, channel) VALUES (?, 50, '2026-09-09', 'online')",
                     (lapsed,))
        conn.execute("UPDATE donors SET interests = ? WHERE id = ?", (json.dumps(["kids program"]), lapsed))
        db.create_schema(conn)
        conn.execute("INSERT INTO donor_interests (donor_id, tag, confidence, evidence, source_url, source_type, set_by) "
                     "VALUES (?, 'environment', 'high', 'Sponsored the Biscayne Bay cleanup', 'https://example.org/bay', "
                     "'event_sponsor', 'agent')", (lapsed,))
        conn.commit()
    finally:
        conn.close()
    return recent, lapsed


def test_find_people_filters_by_days_since_last_gift_and_interest(db_file):
    recent, lapsed = lapsed_and_tagged(db_file)
    people = {p["id"]: p for p in invoke("find_people", no_gift_in_days=7, limit=50)["people"]}
    assert lapsed in people and recent not in people
    assert people[lapsed]["last_gift_date"] == "2026-09-09"
    assert set(people[lapsed]["interests"]) >= {"kids program", "environment"}
    tagged = invoke("find_people", interest="environment", limit=50)["people"]
    assert [p["id"] for p in tagged] == [lapsed]
    name = one(db_file, "SELECT full_name FROM donors WHERE id = ?", lapsed)["full_name"]
    assert lapsed in [p["id"] for p in invoke("find_people", name=name.split()[0].lower())["people"]]


def test_campaign_drafts_are_given_the_donors_interests(db_file):
    from service import routes_campaigns as rc
    _, lapsed = lapsed_and_tagged(db_file)
    conn = db.connect()
    try:
        _, _, _, research = rc.load_donor(conn, lapsed)
    finally:
        conn.close()
    text = " ".join(f["fact"] for f in research)
    assert "kids program" in text and "Biscayne Bay cleanup" in text
    assert any(f["source_url"] == "https://example.org/bay" for f in research)


def test_a_resumed_run_returns_only_steps_the_user_has_not_seen(monkeypatch):
    """The SDK's resumed result repeats the items from before the pause; the thread already shows those."""
    from types import SimpleNamespace
    shown = [{"tool": "find_people", "call_id": "a", "status": "done", "summary": "2 people", "undo_token": None},
             {"tool": "send", "call_id": "b", "status": "awaiting_approval", "summary": "waiting", "undo_token": None}]
    rerun = [dict(shown[0]), {**shown[1], "status": "done", "summary": "Approved: batch #1, 2 sent"},
             {"tool": "get_tasks", "call_id": "c", "status": "done", "summary": "0 tasks", "undo_token": None}]
    monkeypatch.setattr(ca, "steps_from", lambda items: [dict(s) for s in rerun])
    result = SimpleNamespace(new_items=[], interruptions=[], final_output="Sent.")
    out = ca.respond(result, ca.ChatContext(tab="home"), {"tab": "home"}, shown)
    assert [s["call_id"] for s in out["steps"]] == ["b", "c"]
    assert out["steps"][0]["summary"].startswith("Approved")
