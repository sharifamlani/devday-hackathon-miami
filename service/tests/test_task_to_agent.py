"""A home task click hands the task to the agent: "Work on this task: ... (task #N)". The agent reads it with
get_task, reads the person, drafts (never sends) and offers Mark done, which complete_task applies with Undo.
Tools are invoked as the agent invokes them (test_agent_tools.invoke); no model needed."""

from service import chat_agent as ca, db, tasks
from service.tests.test_agent_tools import invoke, one, undo


def test_get_task_is_a_read_tool_and_the_instructions_cover_task_clicks():
    assert "get_task" in {t.name for t in ca.TOOLS}
    assert "get_task" not in ca.APPROVAL_TOOLS
    assert '"Work on this task: ... (task #N)"' in ca.INSTRUCTIONS
    assert "Never send" in ca.INSTRUCTIONS and "Mark done?" in ca.INSTRUCTIONS


def test_get_task_reads_one_task_and_errors_cleanly(db_file):
    conn = db.connect(db_file)
    made, _ = tasks.create_task(conn, kind="call", title="Call Hye-jin Park", person_id=1, due="2026-11-08",
                                why="Monthly gift on Oct 10 failed, with no gift since.", actor="generator")
    conn.close()
    out = invoke("get_task", task_id=made["id"])
    assert out["task"]["title"] == "Call Hye-jin Park" and out["task"]["person_id"] == 1
    assert ca.summarize(out) == f"task #{made['id']}: Call Hye-jin Park"
    assert "not found" in invoke("get_task", task_id=99999)["error"]


def test_mark_done_from_the_agent_applies_and_undo_restores(db_file):
    conn = db.connect(db_file)
    made, _ = tasks.create_task(conn, kind="call", title="Call Hye-jin Park", person_id=1, due="2026-11-08",
                                actor="generator")
    conn.close()
    done = invoke("complete_task", task_id=made["id"])
    assert one(db_file, "SELECT done FROM tasks WHERE id = ?", made["id"])["done"] == 1
    undo(done["undo_token"])
    assert one(db_file, "SELECT done FROM tasks WHERE id = ?", made["id"])["done"] == 0


def test_person_steps_read_as_a_name_not_call_note_counts():
    assert ca.summarize({"full_name": "Hye-jin Park", "gifts": [{}, {}], "score": 71, "call_notes": []}) == \
        "Hye-jin Park: 2 gifts, score 71"
    assert ca.summarize({"call_notes": []}) == "0 call notes"            # a call-notes read is unchanged
