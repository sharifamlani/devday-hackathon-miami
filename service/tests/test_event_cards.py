"""Event step cards read as sentences, and the reply after an approval card says what happened (calendar v3)."""
import json

from fastapi.testclient import TestClient

from service import chat_agent as ca, db
from service import events_crud as ev

EVENT = {"id": 6, "title": "Board meeting", "starts_at": "2026-11-10T15:00", "ends_at": None, "place": None,
         "event_kind": "other", "notes": None, "source": "agent", "source_url": None, "status": None,
         "audience_hint": None, "undo_token": "event-6"}
DECLINED = "Tool execution was not approved."


def test_event_writes_read_as_sentences():
    assert ca.step_summary("add_event", EVENT) == "Added Board meeting · Tue Nov 10, 3:00 PM"
    assert ca.step_summary("add_calendar_item", {**EVENT, "starts_at": "2026-11-10"}) == "Added Board meeting · Tue Nov 10"
    assert ca.step_summary("move_event", {**EVENT, "starts_at": "2026-11-12T09:30"}) == \
        "Moved Board meeting to Thu Nov 12, 9:30 AM"
    assert ca.step_summary("move_calendar_item", EVENT) == "Moved Board meeting to Tue Nov 10, 3:00 PM"
    assert ca.step_summary("delete_event", EVENT) == "Deleted Board meeting (Nov 10)"
    assert ca.step_summary("delete_event", json.dumps(EVENT)) == "Deleted Board meeting (Nov 10)"   # as the SDK hands it
    assert "{" not in ca.step_summary("add_event", EVENT)                                          # no raw JSON


def test_a_declined_delete_says_kept_and_other_steps_are_unchanged():
    assert ca.step_summary("delete_event", DECLINED) == "kept (not deleted)"
    assert ca.step_summary("send", DECLINED) == "not sent"
    assert ca.step_summary("delete_task", {"id": 3, "title": "Old flyer", "kind": "other"}) == "deleted: Old flyer"
    assert ca.step_summary("add_event", {"error": "this event comes from your website"}).startswith("error")


def board_meeting(db_file) -> int:
    conn = db.connect()
    try:
        db.create_schema(conn)
        row, _ = ev.add_event(conn, title="Board meeting", starts_at_="2026-11-10T15:00", source="agent", actor="agent")
        return row["id"]
    finally:
        conn.close()


def resumed(call_id: str, summary: str, reply: str | None, status: str = "done") -> dict:
    return {"reply": reply, "approvals": [], "run_id": None,
            "steps": [{"tool": "delete_event", "call_id": call_id, "summary": summary, "status": status}]}


def test_after_approve_the_reply_says_it_was_deleted(db_file):
    shown = [{"tool": "delete_event", "call_id": "c1", "args": {"event_id": board_meeting(db_file)}}]
    out = ca.with_outcome(resumed("c1", "Deleted Board meeting (Nov 10)", None), {"c1": True}, shown)
    assert out["reply"] == "Deleted Board meeting (Nov 10)."                                       # S2
    stale = resumed("c1", "Deleted Board meeting (Nov 10)", "The board meeting is pending deletion; approve it on the card.")
    assert ca.with_outcome(stale, {"c1": True}, shown)["reply"] == "Deleted Board meeting (Nov 10)."


def test_after_decline_the_reply_says_it_was_kept(db_file):
    shown = [{"tool": "delete_event", "call_id": "c1", "args": {"event_id": board_meeting(db_file)}}]
    out = ca.with_outcome(resumed("c1", "kept (not deleted)", "Ready for your approval on the card."), {"c1": False}, shown)
    assert out["reply"] == "Kept Board meeting (2026-11-10)."                                     # S-neg


def test_a_reply_that_already_says_what_happened_is_kept(db_file):
    shown = [{"tool": "delete_event", "call_id": "c1", "args": {"event_id": board_meeting(db_file)}}]
    own = "Deleted the board meeting on November 10. Undo puts it back."
    assert ca.with_outcome(resumed("c1", "Deleted Board meeting (Nov 10)", own), {"c1": True}, shown)["reply"] == own
    paused = {**resumed("c2", "waiting", "Waiting for you: Send 1 email."), "approvals": [{"call_id": "c2"}]}
    assert ca.with_outcome(paused, {"c1": True}, shown)["reply"] == "Waiting for you: Send 1 email."  # paused again


def test_live_streamed_event_cards_and_the_approved_delete(db_file):
    """S1 + S2 through the real routes: the streamed add shows a readable step; an approved delete removes the
    event and the reply doesn't talk as if it were still waiting."""
    from service.main import app
    client = TestClient(app)
    added = client.post("/chat/stream", json={"message": "Add a board meeting on 2026-11-10 at 15:00.",
                                              "context": {"screen": "home"}}).text
    parts = [json.loads(line.split(":", 1)[1]) for line in added.splitlines() if ":" in line]   # data-stream lines
    steps = [p["result"] for p in parts if isinstance(p, dict) and isinstance(p.get("result"), dict)]
    add = next(st for st in steps if st.get("tool") == "add_event")
    assert add["summary"] == "Added Board meeting · Tue Nov 10, 3:00 PM"                           # S1: the card's line
    event_id = db.connect().execute("SELECT id FROM events WHERE title = 'Board meeting'").fetchone()[0]

    paused = client.post("/chat", json={"message": f"Delete the board meeting (event {event_id}).",
                                        "context": {"screen": "home"}}).json()
    card = next(a for a in paused["approvals"] if a["tool"] == "delete_event")
    done = client.post("/chat/approve", json={"run_id": paused["run_id"], "approved_by": "Test approver",
                                              "approvals": [{"call_id": card["call_id"], "approve": True}]}).json()
    assert db.connect().execute("SELECT COUNT(*) FROM events WHERE id = ?", (event_id,)).fetchone()[0] == 0
    step = next(s for s in done["steps"] if s["call_id"] == card["call_id"])
    assert step["summary"] == "Deleted Board meeting (Nov 10)"
    assert done["reply"] and not ca.STILL_PENDING.search(done["reply"])
