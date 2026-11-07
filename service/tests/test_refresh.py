"""Daily refresh: diffs, re-drafting, and never wiping good data on a failed source (no model calls)."""

import sqlite3
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import refresh as r  # noqa: E402

URLS = {"website": "https://miamifoundation.org/"}
GMD = {"title": "Give Miami Day", "starts_at": "2026-11-19", "ends_at": None, "place": None,
       "source_url": "https://www.givemiamiday.org/", "audience_hint": "giving"}
FIVE_K = {"title": "The Give Miami 5K", "starts_at": "2026-11-15", "ends_at": None, "place": "Maurice A. Ferre Park",
          "source_url": "https://miamifoundation.org/5k/", "audience_hint": "community"}
PEOPLE = [{"id": 1, "full_name": "Maria", "contact_type": "giver"}, {"id": 2, "full_name": "Ana", "contact_type": "community"}]


def db_with(facts=(), events=()):
    conn = sqlite3.connect(":memory:")
    conn.execute("CREATE TABLE org_context (source, url, fact, posted_at)")
    conn.executemany("INSERT INTO org_context VALUES (?,?,?,?)", [(f["source"], f["url"], f["fact"], f.get("posted_at")) for f in facts])
    conn.execute("CREATE TABLE events (title, starts_at, ends_at, place, source_url, audience_hint)")
    conn.executemany("INSERT INTO events VALUES (?,?,?,?,?,?)",
                     [(e["title"], e["starts_at"], e["ends_at"], e["place"], e["source_url"], e["audience_hint"]) for e in events])
    return conn


def fakes(context_result, events_result):
    calls = {"invites": [], "saved": []}

    def build(urls, refresh):
        if isinstance(context_result, Exception):
            raise context_result
        return context_result

    def extract(facts, refresh, website):
        if isinstance(events_result, Exception):
            raise events_result
        return events_result

    def audience(e, people, rationale):
        ids = [p["id"] for p in people if (p["contact_type"] == "giver") == (e["audience_hint"] == "giving")]
        return {"person_ids": ids}

    def invite(e, p):
        calls["invites"].append((e["title"], e["starts_at"], p["id"]))
        return {"subject": "s", "email_body": "b", "sms": "t", "status": "ready"}

    def save(e, p, inv):
        calls["saved"].append((e["title"], p["id"]))
    return dict(build=build, extract=extract, audience=audience, invite=invite, save=save), calls


def test_event_date_change_is_marked_changed_and_reinvited():
    fact = {"source": "news", "url": "u1", "fact": "SET Summits", "posted_at": "2026-10-01"}
    conn = db_with([fact], [GMD, FIVE_K])
    moved = dict(FIVE_K, starts_at="2026-11-22")
    f, calls = fakes({"facts": [fact], "sources": {"website": "ok", "news": "ok"}}, [GMD, moved])
    out = r.refresh(conn, URLS, "2026-11-08", PEOPLE, **f)
    assert out["events"]["new"] == [] and out["events"]["removed"] == []
    assert out["events"]["changed"][0]["title"] == "The Give Miami 5K"
    assert out["events"]["changed"][0]["before"]["starts_at"] == "2026-11-15"
    assert out["events"]["changed"][0]["after"]["starts_at"] == "2026-11-22"
    assert calls["invites"] == [("The Give Miami 5K", "2026-11-22", 2)]          # only the changed event is re-drafted
    assert out["drafts"] == {"The Give Miami 5K": 1}


def test_source_failure_removes_nothing():
    fact = {"source": "website", "url": "u1", "fact": "Scholarships", "posted_at": "2026-08-31"}
    conn = db_with([fact], [GMD, FIVE_K])
    failed = {"facts": [], "sources": {"website": "error: search found no pages on miamifoundation.org", "news": "error: Timeout"}}
    f, calls = fakes(failed, RuntimeError("search down"))
    out = r.refresh(conn, URLS, "2026-11-08", PEOPLE, **f)
    assert out["facts"]["removed"] == 0 and out["facts"]["failed_sources"] == ["news", "website"]
    assert out["events"] == {"new": [], "changed": [], "removed": []}
    assert calls["invites"] == [] and any(e.startswith("events:") for e in out["errors"])
    assert conn.execute("SELECT COUNT(*) FROM org_context").fetchone()[0] == 1        # good data kept


def test_new_event_is_drafted_and_a_vanished_one_removed_only_after_a_good_read():
    conn = db_with([], [GMD])
    pet = {"title": "Puppy Day", "starts_at": "2026-11-21", "ends_at": None, "place": None,
           "source_url": "https://miamifoundation.org/pups/", "audience_hint": "community"}
    f, calls = fakes({"facts": [], "sources": {"website": "ok", "news": "ok"}}, [pet])
    out = r.refresh(conn, URLS, "2026-11-08", PEOPLE, **f)
    assert out["events"]["new"] == ["Puppy Day"] and out["events"]["removed"] == ["Give Miami Day"]
    assert calls["saved"] == [("Puppy Day", 2)]


def test_same_event_with_new_punctuation_or_citing_page_is_not_a_change():
    before = [dict(GMD, title="Give Miami Day — Early Giving", starts_at="2026-11-14")]
    after = [dict(GMD, title="Give Miami Day Early Giving", starts_at="2026-11-14", source_url="https://www.givemiamiday.org/p/new/")]
    d = r.diff_events(before, after, True, "2026-11-08")
    assert d == {"new": [], "changed": [], "removed": []}


def test_reworded_titles_on_the_same_date_are_the_same_event():
    before = [dict(GMD, title="Give Miami Day — 15th anniversary"), dict(GMD, title="Give Miami Day — Early Giving opens", starts_at="2026-11-14")]
    after = [dict(GMD, title="Give Miami Day"), dict(GMD, title="Give Miami Day — Early Giving", starts_at="2026-11-14")]
    assert r.diff_events(before, after, True, "2026-11-08") == {"new": [], "changed": [], "removed": []}
    assert not r.same_event(GMD, FIVE_K)


def test_declined_gifts_are_not_loaded(tmp_path, monkeypatch):
    import outreach_agent
    db = tmp_path / "d.db"
    c = sqlite3.connect(db)
    c.executescript("""CREATE TABLE donors (id INTEGER PRIMARY KEY, full_name TEXT);
        CREATE TABLE donor_scores (donor_id INTEGER, tier TEXT, is_star INTEGER, why TEXT);
        CREATE TABLE gifts (donor_id INTEGER, amount REAL, gift_date TEXT, channel TEXT, status TEXT);
        CREATE TABLE research_facts (donor_id INTEGER, fact TEXT, source_url TEXT);
        INSERT INTO donors VALUES (1, 'Maria');
        INSERT INTO gifts VALUES (1, 250, '2025-11-20', 'Give Miami Day', 'ok'), (1, 999, '2026-01-02', 'online', 'declined');""")
    c.commit(); c.close()
    monkeypatch.setenv("DONORS_DB", str(db))
    _, gifts, _, _ = outreach_agent.load_donor(1)
    assert [g["amount"] for g in gifts] == [250]
