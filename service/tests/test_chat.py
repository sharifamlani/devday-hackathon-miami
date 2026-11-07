"""Chat agent tools and the approval-gated send (plan.md §17). No test reaches the model or a provider:
drafts use the template drafter, httpx is blocked, and the default send path is a dry run."""

import httpx
import pytest
from fastapi.testclient import TestClient

from service import campaign_agent as ca
from service import chat_agent
from service.main import app

# Seed ids: 1 Maria Delgado, 3 James Carter (individuals), 4 Biscayne Harbor (star org, has email),
# 11 DeLuca (star org, no email)


@pytest.fixture(autouse=True)
def offline(monkeypatch):
    def refuse(*args, **kwargs):
        raise AssertionError("a test reached the network or the model")
    monkeypatch.setattr(httpx, "post", refuse)
    monkeypatch.setattr(ca, "model_write", refuse)
    monkeypatch.setenv("CAMPAIGN_DRAFTER", "template")
    for var in ("SMS_PROVIDER", "EMAIL_SEND", "GMAIL_TOKEN_PATH"):
        monkeypatch.delenv(var, raising=False)


def test_the_model_has_no_tool_that_sends():
    names = {t.name for t in chat_agent.TOOLS}
    assert names == {"find_people", "segment", "get_context", "get_events", "get_alerts", "draft_email",
                     "draft_sms", "build_brief", "community_stats"}
    assert not any("send" in n for n in names)


def test_draft_batch_is_pending_and_sends_nothing(db_file):
    ctx = chat_agent.ChatContext(tab="givers")
    out = chat_agent.draft_batch(ctx, [1, 3, 11], "check_in", "email")

    assert out["drafts"] == 3 and out["status"] == "pending approval (nothing sent)"
    assert out["needs_individual_approval"] == ["Frederick A. DeLuca Foundation"]
    assert ctx.batches == [out["batch_id"]]
    assert TestClient(app).get("/outbox").json() == []


def test_community_never_gets_a_donation_ask(db_file):
    out = chat_agent.draft_batch(chat_agent.ChatContext(tab="community"), [1], "re_engage", "text")
    assert out == {"error": "community outreach never asks for a donation: use intent check_in"}


def test_tabs_without_data_say_so(db_file):
    out = chat_agent.draft_batch(chat_agent.ChatContext(tab="neighbors"), [1], "check_in", "email")
    assert out["people"] == [] and "not loaded yet" in out["note"]


def batch(c: TestClient) -> int:
    ctx = chat_agent.ChatContext(tab="givers")
    return chat_agent.draft_batch(ctx, [1, 3, 4], "check_in", "email")["batch_id"]


def test_send_without_items_sends_only_items_that_need_no_individual_approval(db_file):
    c = TestClient(app)
    bid = batch(c)

    r = c.post("/send", json={"batch_id": bid, "approved_by": "Test approver", "items": None}).json()

    assert r["sent"] == 2 and r["simulated"] is True
    assert [b["id"] for b in r["blocked"]] == [3] and "individual approval" in r["blocked"][0]["reason"]
    assert {o["donor_id"] for o in r["outbox"]} == {1, 3}
    assert {(o["provider"], o["delivery_status"]) for o in r["outbox"]} == {("dryrun", "queued (dry run)")}


def test_star_org_goes_only_when_listed_and_skip_means_skip(db_file):
    c = TestClient(app)
    bid = batch(c)
    items = [{"id": 1, "approve": False}, {"id": 3, "approve": True}]   # Maria skipped, Biscayne Harbor approved

    r = c.post(f"/send/{bid}", json={"approved_by": "Test approver", "items": items}).json()

    assert r["skipped"] == 1
    sent_to = {o["donor_id"] for o in r["outbox"]}
    assert sent_to == {4}                                                # unlisted James stays a draft


def test_send_requires_a_named_approver_and_a_real_batch(db_file):
    c = TestClient(app)
    bid = batch(c)
    assert c.post("/send", json={"batch_id": bid, "approved_by": "   "}).status_code == 422
    assert c.post("/send", json={"approved_by": "Test approver"}).status_code == 422
    assert c.post("/send", json={"batch_id": 999, "approved_by": "Test approver"}).status_code == 404
    assert c.get("/outbox").json() == []


def test_steps_summarize_a_batch():
    assert chat_agent.summarize({"batch_id": 4, "drafts": 3, "needs_individual_approval": ["DeLuca"]}) == \
        "batch #4: 3 drafts, pending approval, 1 need individual approval"


def test_approved_item_without_an_address_is_blocked_not_sent(db_file):
    c = TestClient(app)
    bid = chat_agent.draft_batch(chat_agent.ChatContext(tab="givers"), [11], "check_in", "email")["batch_id"]

    r = c.post("/send", json={"batch_id": bid, "approved_by": "Test approver",
                              "items": [{"id": 1, "approve": True}]}).json()

    assert r["sent"] == 0 and r["blocked"] == [{"id": 1, "reason": "no email on file"}]


def test_refresh_now_without_the_refresh_lane_is_503(db_file):
    r = TestClient(app).post("/context/refresh")
    assert r.status_code == 503 and r.json()["detail"] == "service.refresh has not landed on this build yet"


def test_first_turn_asks_for_context_and_events_and_later_turns_do_not():
    first = chat_agent.FIRST_TURN.format(today="2026-11-08")
    assert "call get_context and get_events" in first and "within 14 days of 2026-11-08" in first
    assert "Plan outreach for N upcoming events?" in first


def test_daily_schedule_math():
    from datetime import datetime
    from service.main import seconds_until
    assert seconds_until("07:00", datetime(2026, 11, 7, 6, 0)) == 3600
    assert seconds_until("07:00", datetime(2026, 11, 7, 7, 0)) == 24 * 3600


def test_refresh_now_runs_in_the_background_and_reports_its_state(db_file, monkeypatch):
    import importlib.machinery
    import sys
    import threading
    import time
    import types

    from service import db, main

    conn = db.connect()
    db.save_context(conn, {"profile": {"name": "Test Org", "website": "https://example.org"}, "facts": [],
                           "sources": {}})
    conn.close()
    gate, seen = threading.Event(), []
    fake = types.ModuleType("service.refresh")
    fake.__spec__ = importlib.machinery.ModuleSpec("service.refresh", None)
    fake.refresh = lambda conn, urls: seen.append(urls["website"]) or gate.wait(5) and {"facts": {"added": [1]}}
    monkeypatch.setitem(sys.modules, "service.refresh", fake)
    monkeypatch.setitem(main.REFRESH_JOB, "status", "idle")
    c = TestClient(app)

    first = c.post("/context/refresh").json()
    second = c.post("/context/refresh").json()                     # a second click joins the running pass

    assert first["status"] == "refreshing" and second["started_at"] == first["started_at"]
    gate.set()
    for _ in range(50):
        if c.get("/context/refresh").json()["status"] != "refreshing":
            break
        time.sleep(0.1)
    done = c.get("/context/refresh").json()
    assert done["status"] == "done" and done["changes"] == {"facts": {"added": [1]}} and seen == ["https://example.org"]
