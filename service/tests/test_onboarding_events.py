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


def slow_context(urls, refresh=False):
    time.sleep(0.6)                                   # past the (shortened) read deadline
    return context_ok(urls, refresh)


def events_after(seconds, events):
    """Stand in for main.start_events_search: a search that finishes after `seconds`."""
    async def found():
        await asyncio.sleep(seconds)
        return [dict(e) for e in events]
    return lambda website: asyncio.ensure_future(found())


def test_a_slow_read_still_lands_with_events_and_prep_tasks(db_file, monkeypatch):
    monkeypatch.setattr(main.config, "CONTEXT_DEADLINE_S", 0.2)
    monkeypatch.setattr(main.config, "ONBOARDING_EVENTS_GRACE_S", 5)
    monkeypatch.setattr(main, "start_events_search", events_after(0.4, EVENTS))   # done after the read gave up
    monkeypatch.setattr(org_context, "build_context", slow_context)
    with main.REFRESH_LOCK:
        main.REFRESH_JOB.update(status="idle")
    body = TestClient(main.app).post("/context/run", json={"website": "https://miamifoundation.org"}).json()
    assert body["served_from"] == "fallback"                                        # the web goes on in the background
    assert body["calendar"]["events"] == 2 and body["calendar"]["prep_tasks"] >= 1
    assert body["calendar"]["invites"] == "with the background read"
    assert main.refresh_job_state()["status"] == "idle"           # the refresh slot is free for POST /context/refresh
    conn = db.connect(db_file)
    assert conn.execute("SELECT COUNT(*) FROM events").fetchone()[0] == 2
    assert conn.execute("SELECT COUNT(*) FROM tasks WHERE kind = 'prep'").fetchone()[0] >= 1
    conn.close()

    # the web's background read: the refresh skips these (already saved), so it drafts the handed-over invites
    drafted = []
    monkeypatch.setattr(main, "run_refresh", lambda: {"state": "done", "detail": None, "changes": {"facts": {"added": 3}}})
    monkeypatch.setattr(refresh, "draft_invites_for",
                        lambda conn, events, ids, stored, people=None, **k: drafted.append(len(events)) or
                        {"drafts": {e["title"]: 4 for e in events}, "errors": []})
    TestClient(main.app).post("/context/refresh")
    job = wait_for_job()
    assert job["status"] == "done" and drafted == [2]
    assert job["changes"]["facts"] == {"added": 3}                  # the web still reads the refresh's own changes
    assert job["changes"]["onboarding_invites"]["drafts"]["Give Miami Day"] == 4
    assert main.PENDING_INVITES == []                               # handed over once


def test_a_slow_read_and_a_slower_search_answer_on_time_with_no_events(db_file, monkeypatch):
    monkeypatch.setattr(main.config, "CONTEXT_DEADLINE_S", 0.2)
    monkeypatch.setattr(main.config, "ONBOARDING_EVENTS_GRACE_S", 0.2)
    monkeypatch.setattr(main, "start_events_search", events_after(5, EVENTS))
    monkeypatch.setattr(org_context, "build_context", slow_context)
    t0 = time.monotonic()
    body = TestClient(main.app).post("/context/run", json={"website": "https://miamifoundation.org"}).json()
    assert time.monotonic() - t0 < 3                              # capped: the grace, not the search, sets the wait
    assert body["served_from"] == "fallback" and body["calendar"]["events"] == 0
    conn = db.connect(db_file)
    assert conn.execute("SELECT COUNT(*) FROM events").fetchone()[0] == 0
    conn.close()


def test_events_refresh_runs_the_real_pass(db_file, monkeypatch):
    monkeypatch.setattr(main, "events_agent", lambda: None)            # don't import the real module here
    monkeypatch.setattr(main, "run_refresh", lambda: {"state": "done", "detail": None, "changes": {"events": {"new": []}}})
    r = TestClient(main.app).post("/events/refresh")
    assert r.status_code == 200 and r.json()["state"] == "done"


def fake_events_agent(monkeypatch, runs):
    """A stand-in events_agent on sys.modules AND the service package (both restored after the test), so
    nothing here imports the real module (which would bypass test_event_outreach's fake)."""
    import sys
    import types

    import service
    it = iter(runs)
    fake = types.ModuleType("service.events_agent")
    fake.site_host = lambda url: "miamifoundation.org"
    fake.EVENTS_LIVE = fake.EVENTS_CACHE = None
    fake.read_runs = lambda path: {}
    fake.extract_events = lambda hints, refresh, website: [dict(e) for e in next(it)]
    monkeypatch.setitem(sys.modules, "service.events_agent", fake)
    monkeypatch.setattr(service, "events_agent", fake, raising=False)


def test_two_parallel_searches_are_merged_without_duplicates(monkeypatch):
    five_k = {"title": "The Give Miami 5K", "starts_at": "2026-11-15T08:00", "source_url": "https://runsignup.com/x/"}
    festival = {"title": "The Give Miami 5K Post-Race Festival", "starts_at": "2026-11-15T08:30", "source_url": "https://e.com/f/"}
    early, gmd = EVENTS[0], EVENTS[1]
    reworded = dict(five_k, title="Give Miami 5K")                                  # the same race, other wording
    fake_events_agent(monkeypatch, [[five_k, festival, early], [gmd, reworded]])    # run 1 missed Give Miami Day
    got = main.find_onboarding_events("https://miamifoundation.org")
    assert [e["starts_at"][:10] for e in got] == ["2026-11-14", "2026-11-15", "2026-11-15", "2026-11-19"]
    assert any(e["title"] == "Give Miami Day" for e in got)


def test_invites_queue_behind_a_running_refresh(monkeypatch):
    ran = []
    monkeypatch.setattr(refresh, "draft_invites_for",
                        lambda conn, events, ids, stored, people=None, **k: ran.append(len(events)) or {"drafts": {}, "errors": []})
    with main.REFRESH_LOCK:
        main.REFRESH_JOB.update(status="refreshing", started_at="2026-11-08T10:00:00+00:00")
    started = main.start_invites_job([dict(e) for e in EVENTS], {}, False)
    assert "queued" in started and ran == []                                        # not dropped, not run yet
    with main.REFRESH_LOCK:
        main.REFRESH_JOB.update(status="done")                                     # the running refresh finishes
    for _ in range(50):
        if ran:
            break
        time.sleep(0.1)
    assert ran == [2] and wait_for_job()["status"] == "done"


def test_a_failed_site_says_why_at_the_top(db_file, monkeypatch):
    monkeypatch.setattr(org_context, "build_context", lambda urls, refresh=False: {
        "profile": {"name": None}, "facts": [],
        "sources": {"website": "error: DNS: no-such-org-qa.invalid not found", "news": "error: DNS: no-such-org-qa.invalid not found"},
        "source_notes": {}})
    body = TestClient(main.app).post("/context/run", json={"website": "https://no-such-org-qa.invalid"}).json()
    assert body["state"] == "failed" and body["detail"].startswith("We couldn't read https://no-such-org-qa.invalid")
    assert "DNS" in body["detail"] and body["calendar"] is None


def test_onboarding_rerun_that_misses_an_event_keeps_it(db_file, monkeypatch):
    """S-neg: a second setup (or a re-read) whose search misses an event already found never drops it."""
    monkeypatch.setattr(org_context, "build_context", context_ok)
    monkeypatch.setattr(org_context, "embed_texts", lambda texts: [None] * len(texts))
    monkeypatch.setattr(refresh, "draft_invites_for",
                        lambda conn, events, ids, stored, people=None, **k: {"drafts": {}, "attempted": 0,
                                                                            "drafted": 0, "errors": []})
    monkeypatch.setenv("SCORE_AS_OF", "2026-11-08")
    with main.REFRESH_LOCK:
        main.REFRESH_JOB.update(status="idle")
    monkeypatch.setattr(main, "start_events_search", events_found(EVENTS))
    TestClient(main.app).post("/context/run", json={"website": "https://miamifoundation.org"})
    wait_for_job()
    monkeypatch.setattr(main, "start_events_search", events_found(EVENTS[1:]))      # this read misses Early Giving
    TestClient(main.app).post("/context/run", json={"website": "https://miamifoundation.org"})
    wait_for_job()
    conn = db.connect(db_file)
    titles = sorted(r[0] for r in conn.execute("SELECT title FROM events WHERE COALESCE(status, '') != 'cancelled'"))
    conn.close()
    assert titles == ["Give Miami Day", "Give Miami Day Early Giving"]


def test_onboarding_runs_three_searches():
    assert main.ONBOARDING_SEARCHES == 3
