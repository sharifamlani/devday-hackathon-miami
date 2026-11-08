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


def test_new_event_is_drafted_and_a_missed_known_one_is_kept():
    # One search can miss an event it found before (3 of 4, Nov 8): a miss never drops a known upcoming event.
    conn = db_with([], [GMD])
    pet = {"title": "Puppy Day", "starts_at": "2026-11-21", "ends_at": None, "place": None,
           "source_url": "https://miamifoundation.org/pups/", "audience_hint": "community"}
    f, calls = fakes({"facts": [], "sources": {"website": "ok", "news": "ok"}}, [pet])
    out = r.refresh(conn, URLS, "2026-11-08", PEOPLE, **f)
    assert out["events"]["new"] == ["Puppy Day"] and out["events"]["removed"] == []
    assert calls["saved"] == [("Puppy Day", 2)]                                   # no re-draft for the kept one
    assert any("missed 1 known upcoming event" in e for e in out["errors"])


def test_a_search_that_misses_the_5k_keeps_it_and_hints_every_known_event():
    conn = db_with([], [GMD, FIVE_K])
    seen_hints = []
    f, calls = fakes({"facts": [], "sources": {"website": "ok", "news": "ok"}}, [GMD])
    real_extract = f["extract"]

    def extract(facts, refresh, website):
        seen_hints.extend(h["fact"] for h in facts)
        return real_extract(facts, refresh, website)
    f["extract"] = extract
    out = r.refresh(conn, URLS, "2026-11-08", PEOPLE, **f)
    assert out["events"]["removed"] == [] and out["events"]["new"] == []
    assert "The Give Miami 5K on 2026-11-15 at Maurice A. Ferre Park" in seen_hints
    assert calls["invites"] == []


def test_keep_known_skips_past_cancelled_and_sourceless_events():
    past = dict(GMD, title="Last year's gala", starts_at="2025-11-19")
    cancelled = dict(FIVE_K, title="Cancelled walk", status="cancelled")
    nosource = dict(GMD, title="Rumored event", starts_at="2026-12-01", source_url=None)
    kept = r.keep_known([], [past, cancelled, nosource, dict(FIVE_K, id=7, status="upcoming")], "2026-11-08")
    assert [e["title"] for e in kept] == ["The Give Miami 5K"] and "id" not in kept[0]


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


def test_event_rejected_by_save_events_gets_no_invites(monkeypatch):
    conn = db_with([], [])
    calls_saved = []
    writers = {"save_events": lambda c, evs, complete: {"ids": [None, 7]},
               "save_event_audience": lambda c, eid, chosen: None,
               "save_event_draft": lambda c, eid, pid, inv: calls_saved.append((eid, pid))}
    monkeypatch.setattr(r, "data_writers", lambda c: writers)
    f, calls = fakes({"facts": [], "sources": {"website": "ok", "news": "ok"}}, [GMD, FIVE_K])
    out = r.refresh(conn, URLS, "2026-11-08", PEOPLE, **f)
    assert calls_saved == [(7, 2)] and calls["saved"] == []              # 5K drafted to the db; GMD nowhere, no JSON
    assert any("rejected by save_events" in e and "Give Miami Day" in e for e in out["errors"])


def test_a_race_and_its_festival_at_different_times_are_two_events():
    race = dict(FIVE_K, title="The Give Miami 5K", starts_at="2026-11-15T08:00")
    festival = dict(FIVE_K, title="The Give Miami 5K Post-Race Festival", starts_at="2026-11-15T08:30")
    assert not r.same_event(race, festival)
    moved = dict(race, starts_at="2026-11-15T09:00")                        # same title, new time: changed, not new
    d = r.diff_events([race], [moved], True, "2026-11-08")
    assert d["new"] == [] and d["changed"][0]["after"]["starts_at"] == "2026-11-15T09:00"
