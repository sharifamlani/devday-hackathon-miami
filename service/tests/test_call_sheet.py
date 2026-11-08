"""The call sheet (service/call_sheet.py) and the prep_call tool: a sheet built only from the db, a masked phone,
declined charges kept apart from gifts, talking points from sheet facts, and nothing is ever dialed."""

import asyncio
import json

import pytest
from agents.tool_context import ToolContext

from service import call_sheet, db
from service import chat_agent as ca


@pytest.fixture
def conn(tmp_path, monkeypatch):
    monkeypatch.setenv("DONORS_DB", str(tmp_path / "donors.db"))
    monkeypatch.setenv("PHONE_CALLS", "off")
    c = db.connect(tmp_path / "donors.db")
    db.create_schema(c)
    yield c
    c.close()


def person(conn, name, phone=None):
    return conn.execute("INSERT INTO donors (full_name, donor_type, phone, city, state) "
                        "VALUES (?, 'individual', ?, 'Miami', 'FL')", (name, phone)).lastrowid


def gift(conn, pid, amount, day, channel="Online", status="ok"):
    conn.execute("INSERT INTO gifts (donor_id, amount, gift_date, channel, status) VALUES (?, ?, ?, ?, ?)",
                 (pid, amount, day, channel, status))


def test_sheet_summarizes_giving_and_masks_the_phone(conn):
    pid = person(conn, "Elizabeth Fontaine", "(305) 555-0104")
    gift(conn, pid, 100, "2024-03-01")
    gift(conn, pid, 250, "2025-11-20", "Check")
    gift(conn, pid, 100, "2026-02-01")
    conn.commit()
    s = call_sheet.build(conn, pid)
    assert s["kind"] == "call_sheet" and s["name"] == "Elizabeth Fontaine"
    assert s["phone_masked"] == "***-***-0104" and s["has_phone"]
    assert "555" not in json.dumps(s)
    rel = s["relationship"]
    assert (rel["gift_count"], rel["total"]) == (3, 450)
    assert rel["first_gift"] == {"date": "2024-03-01", "amount": 100}
    assert rel["last_gift"] == {"date": "2026-02-01", "amount": 100}
    assert rel["usual_channel"] == "Online"
    assert len(s["talking_points"]) <= 3 and "$100" in s["talking_points"][0]
    assert "Acknowledge 3 gifts totaling $450 since 2024" in s["talking_points"][1]


def test_declined_charge_is_noted_separately_not_counted(conn):
    pid = person(conn, "Hye-jin Park", "305-555-0111")
    gift(conn, pid, 40, "2026-09-10")
    gift(conn, pid, 40, "2026-10-10", status="declined")
    conn.commit()
    s = call_sheet.build(conn, pid)
    assert s["relationship"]["gift_count"] == 1 and s["relationship"]["total"] == 40
    assert s["relationship"]["last_gift"]["date"] == "2026-09-10"
    assert s["declined_charges"] == [{"date": "2026-10-10", "amount": 40, "status": "declined"}]
    assert "didn't go through" in s["talking_points"][0]


def test_no_phone_no_gifts_and_unknown_person(conn):
    pid = person(conn, "Carmen Ibarra")
    conn.commit()
    s = call_sheet.build(conn, pid)
    assert s["has_phone"] is False and s["phone_masked"] is None
    assert s["relationship"]["gift_count"] == 0 and s["relationship"]["last_gift"] is None
    assert s["talking_points"] and "No gifts on record" in s["talking_points"][0]
    with pytest.raises(LookupError):
        call_sheet.build(conn, 9999)


def test_tasks_notes_and_facts_feed_the_sheet_and_points(conn):
    pid = person(conn, "Lee Wong", "3055550199")
    conn.execute("INSERT INTO tasks (kind, title, person_id, due) VALUES ('call', 'Confirm gala seats', ?, '2026-11-10')", (pid,))
    conn.execute("INSERT INTO tasks (kind, title, person_id, done) VALUES ('call', 'Old finished task', ?, 1)", (pid,))
    conn.execute("INSERT INTO research_facts (donor_id, fact, source_url) VALUES (?, 'Chairs the Wong Family Fund', 'https://x.test/a')", (pid,))
    db.save_call_note(conn, {"id": "n1", "title": "Call with Lee", "created_at": "2026-10-01T10:00:00",
                             "destinations": [{"kind": "donor", "id": pid, "label": "Lee Wong"}],
                             "summary": ["Likes the youth program"], "next_steps": ["Send the pledge form"]})
    conn.commit()
    s = call_sheet.build(conn, pid)
    assert [t["title"] for t in s["open_tasks"]] == ["Confirm gala seats"]
    assert s["facts"] == [{"fact": "Chairs the Wong Family Fund", "source_url": "https://x.test/a"}]
    assert s["recent_calls"][0]["next_steps"] == ["Send the pledge form"]
    assert s["talking_points"][0].startswith("Follow up on the last call (2026-10-01)")
    assert len(s["talking_points"]) == 3


def invoke(**args) -> dict:
    tool = next(t for t in ca.TOOLS if t.name == "prep_call")
    payload = json.dumps(args)
    ctx = ToolContext(context=ca.ChatContext(tab="givers"), tool_name="prep_call", tool_call_id="t1", tool_arguments=payload)
    out = asyncio.run(tool.on_invoke_tool(ctx, payload))
    return out if isinstance(out, dict) else json.loads(out)


def test_prep_call_tool_returns_a_generic_card_and_a_summary(conn):
    pid = person(conn, "Elizabeth Fontaine", "(305) 555-0104")
    gift(conn, pid, 100, "2026-02-01")
    conn.commit()
    out = invoke(person_id=pid)
    assert out["card"]["kind"] == "call_sheet" and out["card"]["person_id"] == pid
    assert ca.summarize(out) == "call sheet for Elizabeth Fontaine: 1 gift, $100"
    assert "error" in invoke(person_id=424242)


def test_prep_call_is_a_read_tool_that_never_dials(conn):
    assert "prep_call" in {t.name for t in ca.TOOLS} and "prep_call" not in ca.APPROVAL_TOOLS
    assert "prep_call" in ca.INSTRUCTIONS and "call_person" in ca.INSTRUCTIONS


def test_steps_from_copies_the_card(conn):
    from agents.items import ToolCallItem, ToolCallOutputItem
    from types import SimpleNamespace as NS
    card = {"kind": "call_sheet", "name": "X", "relationship": {"gift_count": 0, "total": 0}, "has_phone": False}
    agent = ca.Agent(name="t")
    call = ToolCallItem(agent=agent, raw_item=NS(name="prep_call", call_id="c1", arguments='{"person_id": 1}'))
    out = ToolCallOutputItem(agent=agent, raw_item={"call_id": "c1"}, output={"card": card})
    (step,) = ca.steps_from([call, out])
    assert step["card"] == card and step["status"] == "done"
