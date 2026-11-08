"""POST /context/run when the live read times out or the model fails: the typed URLs are kept (never the
facts wiped), and the background refresh reads those saved URLs instead of the Foundation default.
No network and no model calls: build_context is stood in everywhere."""

import sqlite3
import time

from fastapi.testclient import TestClient

from service import config, org_context
from service import refresh as refresh_module
from service.main import app, run_refresh


def good_result(name="Test Org"):
    facts = [{"source": s, "url": f"https://example.org/{s}", "posted_at": "2026-10-01", "fact": f"{s} fact",
              "quote": "fact", "priority": "Generate Prosperity", "captured_at": "2026-11-07"}
             for s in ("website", "news")]
    return {"profile": {"name": name, "priorities": ["Generate Prosperity"], "voice": {"phrases": []}},
            "facts": facts, "sources": {"website": "ok", "news": "ok"}}


def slow(urls, refresh=False):
    time.sleep(0.5)
    return good_result("Should not be saved")


def saved(c: TestClient) -> tuple:
    profile = c.get("/org-profile").json() or {}
    facts = sorted((f["source"], f["fact"]) for f in c.get("/context").json())
    urls = {k: profile.get(k) for k in ("website", "x_url", "linkedin_url", "instagram_url")}
    return profile.get("name"), urls, facts


def test_timeout_keeps_the_typed_urls_and_the_saved_facts(db_file, monkeypatch):
    c = TestClient(app)
    monkeypatch.setattr(org_context, "build_context", lambda urls, refresh=False: good_result())
    assert c.post("/context/run", json={"website": "https://example.org"}).json()["state"] == "done"
    name, _, facts = saved(c)

    monkeypatch.setattr(config, "CONTEXT_DEADLINE_S", 0.05)
    monkeypatch.setattr(org_context, "build_context", slow)
    body = c.post("/context/run", json={"website": "https://example.org/about",
                                        "x_url": "https://x.com/testorg"}).json()

    assert body["served_from"] == "fallback" and body["state"] == "failed"
    assert "took longer" in body["detail"]
    assert body["saved"]["urls_only"] is True and body["saved"]["replaced_sources"] == []
    after_name, urls, after_facts = saved(c)
    assert urls == {"website": "https://example.org/about", "x_url": "https://x.com/testorg",
                    "linkedin_url": None, "instagram_url": None}
    assert (after_name, after_facts) == (name, facts) == ("Test Org", [("news", "news fact"),
                                                                       ("website", "website fact")])


def test_model_error_on_a_first_run_still_saves_the_urls(db_file, monkeypatch):
    c = TestClient(app)

    def model_down(urls, refresh=False):
        raise RuntimeError("APIConnectionError: model unreachable")

    monkeypatch.setattr(org_context, "build_context", model_down)
    body = c.post("/context/run", json={"website": "https://new-org.org",
                                        "instagram_url": "https://www.instagram.com/neworg"}).json()

    assert body["served_from"] == "fallback" and body["facts"] == []
    assert body["sources"]["instagram"]["status"] == "saved, not connected"   # and it really is saved now
    _, urls, facts = saved(c)
    assert urls["website"] == "https://new-org.org"
    assert urls["instagram_url"] == "https://www.instagram.com/neworg"
    assert facts == []


def test_missing_website_still_saves_nothing(db_file, monkeypatch):
    c = TestClient(app)
    before = saved(c)
    body = c.post("/context/run", json={"x_url": "https://x.com/someorg"}).json()
    assert body["saved"] is None and saved(c) == before


def test_background_refresh_reads_the_urls_a_timed_out_run_saved(db_file, monkeypatch):
    c = TestClient(app)
    monkeypatch.setattr(config, "CONTEXT_DEADLINE_S", 0.05)
    monkeypatch.setattr(org_context, "build_context", slow)
    c.post("/context/run", json={"website": "https://slow-org.org", "linkedin_url": "https://www.linkedin.com/company/slow"})

    seen = []
    monkeypatch.setattr(refresh_module, "refresh",
                        lambda conn, urls, **kw: seen.append(urls) or {"facts": {"added": 0}})
    result = run_refresh()

    assert result["state"] == "done"
    assert seen and seen[0]["website"] == "https://slow-org.org"
    assert seen[0]["linkedin_url"] == "https://www.linkedin.com/company/slow"


def test_refresh_without_urls_uses_the_saved_profile_not_the_foundation():
    conn = sqlite3.connect(":memory:")
    conn.execute("CREATE TABLE org_profile (id INTEGER PRIMARY KEY, name, website, x_url, linkedin_url, instagram_url)")
    conn.execute("INSERT INTO org_profile VALUES (1, 'Saved Org', 'https://saved-org.org/', NULL, NULL, NULL)")
    built = []

    def build(urls, refresh):
        built.append(urls)
        return {"facts": [], "sources": {"website": "error: test", "news": "error: test"}}

    refresh_module.refresh(conn, None, "2026-11-08", [], build=build, extract=lambda facts, refresh, website: [],
                           audience=lambda *a, **k: {"person_ids": []}, invite=lambda e, p: {},
                           save=lambda *a: None)

    assert built[0]["website"] == "https://saved-org.org/" and built[0]["name"] == "Saved Org"


def test_refresh_falls_back_to_the_foundation_before_onboarding():
    conn = sqlite3.connect(":memory:")
    built = []

    def build(urls, refresh):
        built.append(urls)
        return {"facts": [], "sources": {}}

    refresh_module.refresh(conn, None, "2026-11-08", [], build=build, extract=lambda facts, refresh, website: [],
                           audience=lambda *a, **k: {"person_ids": []}, invite=lambda e, p: {},
                           save=lambda *a: None)

    assert built[0]["website"] == refresh_module.FOUNDATION_URLS["website"]


def full_profile(c: TestClient) -> dict:
    return c.get("/org-profile").json() or {}


def test_timeout_for_another_org_forgets_the_previous_orgs_context(db_file, monkeypatch):
    c = TestClient(app)
    monkeypatch.setattr(org_context, "build_context", lambda urls, refresh=False: good_result("Old Org"))
    assert c.post("/context/run", json={"website": "https://example.org"}).json()["state"] == "done"
    assert full_profile(c)["priorities"] == ["Generate Prosperity"]

    monkeypatch.setattr(config, "CONTEXT_DEADLINE_S", 0.05)
    monkeypatch.setattr(org_context, "build_context", slow)
    body = c.post("/context/run", json={"website": "https://another-org.org"}).json()

    assert body["served_from"] == "fallback" and body["facts"] == []
    assert body["saved"]["cleared_previous_org"] is True
    profile = full_profile(c)
    assert profile["website"] == "https://another-org.org"
    assert profile["name"] is None and profile["priorities"] == [] and profile["voice"] == {}
    assert profile["source_status"] == {}
    assert c.get("/context").json() == []                     # no Old Org facts under the new URL


def test_timeout_for_the_same_host_keeps_its_context(db_file, monkeypatch):
    c = TestClient(app)
    monkeypatch.setattr(org_context, "build_context", lambda urls, refresh=False: good_result("Same Org"))
    c.post("/context/run", json={"website": "https://example.org"})

    monkeypatch.setattr(config, "CONTEXT_DEADLINE_S", 0.05)
    monkeypatch.setattr(org_context, "build_context", slow)
    body = c.post("/context/run", json={"website": "https://www.example.org/donate"}).json()   # www + path: same host

    assert body["saved"]["cleared_previous_org"] is False
    profile = full_profile(c)
    assert profile["website"] == "https://www.example.org/donate"
    assert profile["name"] == "Same Org" and profile["priorities"] == ["Generate Prosperity"]
    assert len(c.get("/context").json()) == 2


def test_partial_live_run_for_another_org_keeps_none_of_the_old_facts(db_file, monkeypatch):
    c = TestClient(app)
    monkeypatch.setattr(org_context, "build_context", lambda urls, refresh=False: good_result("Old Org"))
    c.post("/context/run", json={"website": "https://example.org"})

    fresh = good_result("New Org")                               # news fails for the new org
    fresh["facts"] = [{**fresh["facts"][0], "url": "https://new-org.org/about", "fact": "new org fact"}]
    fresh["sources"] = {"website": "ok", "news": "error: search timed out"}
    monkeypatch.setattr(org_context, "build_context", lambda urls, refresh=False: fresh)
    body = c.post("/context/run", json={"website": "https://new-org.org"}).json()

    assert body["state"] == "partial"
    assert [(f["source"], f["fact"]) for f in c.get("/context").json()] == [("website", "new org fact")]
    assert full_profile(c)["name"] == "New Org"


# ---- a slow first read is reused, not repeated; another org's calendar is forgotten -------------------------

def test_background_refresh_reuses_the_timed_out_read_instead_of_reading_again(db_file, monkeypatch):
    c = TestClient(app)
    calls = []

    def slow_counted(urls, refresh=False):
        calls.append(urls["website"])
        time.sleep(0.3)
        return good_result("Slow Org")

    monkeypatch.setattr(config, "CONTEXT_DEADLINE_S", 0.05)
    monkeypatch.setattr(org_context, "build_context", slow_counted)
    body = c.post("/context/run", json={"website": "https://slow-org.org", "x_url": "https://x.com/slow"}).json()
    assert body["served_from"] == "fallback"

    built = []

    def fake_refresh(conn, urls, build=None, **kw):
        built.append(build(urls, refresh=True) if build else None)
        return {"facts": {"added": 0}}

    monkeypatch.setattr(refresh_module, "refresh", fake_refresh)
    assert run_refresh()["state"] == "done"

    assert calls == ["https://slow-org.org"]                   # the site was read once
    assert built[0]["profile"]["name"] == "Slow Org"            # the refresh got that read's result
    assert built[0]["profile"]["x_url"] == "https://x.com/slow"  # with the URLs the user typed

    assert run_refresh()["state"] == "done"                     # taken once: a later pass reads on its own
    assert built[1] is None


def test_a_slow_read_of_another_site_is_not_reused(db_file, monkeypatch):
    from service.main import SLOW_READ, take_slow_read

    monkeypatch.setattr(config, "CONTEXT_DEADLINE_S", 0.05)
    monkeypatch.setattr(org_context, "build_context", slow)
    TestClient(app).post("/context/run", json={"website": "https://first-org.org"})
    assert SLOW_READ.get("host") == "first-org.org"
    assert take_slow_read({"website": "https://second-org.org"}) is None
    assert SLOW_READ == {}                                     # and it's dropped either way


def seed_calendar(path) -> dict:
    """One Old Org event with an audience, an unsent and a sent invite draft, a draft and a sent invite batch,
    and an open and a done prep task."""
    conn = sqlite3.connect(path)
    conn.execute("PRAGMA foreign_keys = ON")
    donor = conn.execute("SELECT id FROM donors ORDER BY id LIMIT 1").fetchone()[0]
    ev = conn.execute("INSERT INTO events (title, starts_at, source_url, source) VALUES "
                      "('Old Org Gala', '2026-11-20', 'https://example.org/gala', 'website')").lastrowid
    conn.execute("INSERT INTO event_audience (event_id, person_id, reason) VALUES (?, ?, 'test')", (ev, donor))
    ids = {}
    for status in ("draft", "sent"):
        ids[status] = conn.execute("INSERT INTO outreach_drafts (donor_id, body, status) VALUES (?, 'Join us', ?)",
                                   (donor, status)).lastrowid
        conn.execute("INSERT INTO event_drafts (event_id, draft_id) VALUES (?, ?)", (ev, ids[status]))
    for status in ("draft", "sent"):
        camp = conn.execute("INSERT INTO campaigns (name, intent, channel, event_id, status) "
                            "VALUES (?, 'event_invite', 'email', ?, ?)", (f"Gala {status}", ev, status)).lastrowid
        conn.execute("INSERT INTO campaign_messages (campaign_id, donor_id, channel, body, status) "
                     "VALUES (?, ?, 'email', 'Join us', ?)", (camp, donor, status))
        ids[f"campaign_{status}"] = camp
    for done in (0, 1):
        conn.execute("INSERT INTO tasks (kind, title, done, source, gen_key) VALUES ('prep', ?, ?, 'generator', ?)",
                     (f"Prep list: Old Org Gala {done}", done, f"prep:{ev}" if not done else "prep:999"))
    conn.commit()
    conn.close()
    return ids


def calendar_rows(path) -> dict:
    conn = sqlite3.connect(path)
    q = lambda sql: [tuple(r) for r in conn.execute(sql)]   # noqa: E731
    out = {"events": q("SELECT title FROM events"), "audience": q("SELECT event_id FROM event_audience"),
           "drafts": q("SELECT id, status FROM outreach_drafts WHERE body = 'Join us' ORDER BY id"),
           "campaigns": q("SELECT id, event_id, status FROM campaigns WHERE intent = 'event_invite' ORDER BY id"),
           "prep": q("SELECT title, done, gen_key FROM tasks WHERE kind = 'prep' ORDER BY title")}
    conn.close()
    return out


def test_setup_for_another_org_forgets_the_previous_orgs_calendar(db_file, monkeypatch):
    c = TestClient(app)
    monkeypatch.setattr(org_context, "build_context", lambda urls, refresh=False: good_result("Old Org"))
    assert c.post("/context/run", json={"website": "https://example.org"}).json()["state"] == "done"
    ids = seed_calendar(db_file)

    monkeypatch.setattr(config, "CONTEXT_DEADLINE_S", 0.05)
    monkeypatch.setattr(org_context, "build_context", slow)
    c.post("/context/run", json={"website": "https://another-org.org"})

    rows = calendar_rows(db_file)
    assert rows["events"] == [] and rows["audience"] == []
    assert rows["drafts"] == [(ids["sent"], "sent")]                       # sent invites stay as history
    assert rows["campaigns"] == [(ids["campaign_sent"], None, "sent")]     # unlinked, not deleted
    assert rows["prep"] == [("Prep list: Old Org Gala 0", 0, None),        # open one retired (soft, logged)
                            ("Prep list: Old Org Gala 1", 1, None)]        # done one kept, its key freed
    conn = sqlite3.connect(db_file)
    retired = conn.execute("SELECT t.deleted_at, a.token FROM tasks t JOIN agent_actions a "
                           "ON a.target = 'task:' || t.id WHERE t.title = 'Prep list: Old Org Gala 0' "
                           "AND a.action = 'retire_old_org_prep'").fetchone()
    conn.close()
    assert retired is not None and retired[0] is not None     # soft-deleted with an undo token


def test_setup_for_another_org_drops_queued_invite_work(db_file, monkeypatch):
    from service import main

    c = TestClient(app)
    monkeypatch.setattr(org_context, "build_context", lambda urls, refresh=False: good_result("Old Org"))
    c.post("/context/run", json={"website": "https://example.org"})
    main.PENDING_INVITES[:] = [([{"title": "Old Org Gala"}], {"Old Org Gala": 1}, True)]

    monkeypatch.setattr(org_context, "build_context", lambda urls, refresh=False: good_result("New Org"))
    c.post("/context/run", json={"website": "https://another-org.org"})
    assert main.PENDING_INVITES == []


def test_setup_for_the_same_org_keeps_its_calendar(db_file, monkeypatch):
    c = TestClient(app)
    monkeypatch.setattr(org_context, "build_context", lambda urls, refresh=False: good_result("Same Org"))
    c.post("/context/run", json={"website": "https://example.org"})
    seed_calendar(db_file)
    before = calendar_rows(db_file)

    monkeypatch.setattr(config, "CONTEXT_DEADLINE_S", 0.05)
    monkeypatch.setattr(org_context, "build_context", slow)
    c.post("/context/run", json={"website": "https://www.example.org/events"})

    assert calendar_rows(db_file) == before
