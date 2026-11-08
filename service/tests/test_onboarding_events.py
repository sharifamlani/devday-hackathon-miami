"""Onboarding's context run ends with the first calendar: events + prep tasks before step 3 answers, invites in
the background. /events/refresh runs the real pass. No network: the agents are stood in."""

import asyncio
import time

from fastapi.testclient import TestClient

from service import db, main, org_context, refresh
# never `from service import events_agent` here: it would bypass test_event_outreach's fake module

EVENTS = [
    {"title": "Give Miami Day Early Giving", "starts_at": "2026-11-14", "ends_at": None, "place": None,
     "audience_hint": "giving", "source_url": "https://www.givemiamiday.org/", "source": "website",
     "verification": "page-verified", "quote": "Early Giving opens on November 14.", "captured_at": "now"},
    {"title": "Give Miami Day", "starts_at": "2026-11-19", "ends_at": None, "place": None,
     "audience_hint": "giving", "source_url": "https://www.givemiamiday.org/p/new/", "source": "website",
     "verification": "page-verified", "quote": "On November 19, 2026", "captured_at": "now"},
]


def context_ok(urls, refresh=False):
    return {"profile": {"name": "The Miami Foundation", "website": urls.get("website")},
            "facts": [{"source": "news", "url": "https://miamifoundation.org/n/", "posted_at": "2026-10-01",
                       "fact": "The Foundation hosted SET Summits.", "kind": "success_story", "title": "SET Summits"}],
            "sources": {"website": "ok", "news": "ok"}, "source_notes": {}}


def events_found(events):
    """Stand in for main.start_events_search: a finished search that found these events."""
    async def found():
        return [dict(e) for e in events]
    return lambda website: asyncio.ensure_future(found())


def wait_for_job(timeout=10):
    for _ in range(int(timeout * 10)):
        if main.refresh_job_state()["status"] != "refreshing":
            return main.refresh_job_state()
        time.sleep(0.1)
    return main.refresh_job_state()


def test_onboarding_leaves_events_and_prep_tasks_without_a_refresh(db_file, monkeypatch):
    monkeypatch.setattr(main, "start_events_search", events_found(EVENTS))
    monkeypatch.setattr(org_context, "build_context", context_ok)
    monkeypatch.setattr(org_context, "embed_texts", lambda texts: [None] * len(texts))
    drafted = []
    monkeypatch.setattr(refresh, "draft_invites_for",
                        lambda conn, events, ids, stored, people=None, **k: drafted.append(len(events)) or
                        {"drafts": {e["title"]: 3 for e in events}, "errors": []})
    with main.REFRESH_LOCK:
        main.REFRESH_JOB.update(status="idle")
    body = TestClient(main.app).post("/context/run", json={"website": "https://miamifoundation.org"}).json()
    assert body["calendar"]["events"] == 2 and body["calendar"]["prep_tasks"] >= 1
    assert body["calendar"]["invites"] == "refreshing"
    conn = db.connect(db_file)
    assert conn.execute("SELECT COUNT(*) FROM events").fetchone()[0] == 2               # already there for the dashboard
    assert conn.execute("SELECT COUNT(*) FROM tasks WHERE kind = 'prep'").fetchone()[0] >= 1
    conn.close()
    job = wait_for_job()
    assert job["status"] == "done" and drafted == [2] and job["changes"]["drafts"]["Give Miami Day"] == 3


def test_a_search_that_finds_nothing_leaves_the_calendar_alone(db_file, monkeypatch):
    monkeypatch.setattr(main, "start_events_search", events_found([]))
    monkeypatch.setattr(org_context, "build_context", context_ok)
    monkeypatch.setattr(org_context, "embed_texts", lambda texts: [None] * len(texts))
    body = TestClient(main.app).post("/context/run", json={"website": "https://miamifoundation.org"}).json()
    assert body["calendar"]["events"] == 0 and body["calendar"]["invites"] == "not started"


def test_events_refresh_runs_the_real_pass(db_file, monkeypatch):
    monkeypatch.setattr(main, "events_agent", lambda: None)            # don't import the real module here
    monkeypatch.setattr(main, "run_refresh", lambda: {"state": "done", "detail": None, "changes": {"events": {"new": []}}})
    r = TestClient(main.app).post("/events/refresh")
    assert r.status_code == 200 and r.json()["state"] == "done"
