"""Daily refresh: keep the org's context and calendar current, and pre-draft invites for what changed.

refresh(conn, urls, as_of) runs, in order:
  1. build_context (website + news, live)       -> diff facts against org_context
  2. extract_events (seeded with the new facts)  -> diff events: new / changed / removed
  3. for each new or changed event: suggest_audience + draft_event_invite (drafts only, never sent)
and returns a change summary for data's context_refresh_log.

A failed source never wipes good data: facts are compared only for sources that read ok, and if
event extraction fails or finds nothing, no event is marked removed and the cached events stay.
Facts are stored through db.save_context (data's writer) when it exists; this module writes no
tables of its own.

    python -m service.refresh --daily       # what the scheduler and "Refresh now" run
"""

import argparse
import json
import os
import sqlite3
import sys
import time
from datetime import date, datetime, timezone
from pathlib import Path

SERVICE_DIR = Path(__file__).resolve().parent
REPO_ROOT = SERVICE_DIR.parent
sys.path.insert(0, str(SERVICE_DIR))

from events_agent import (EVENTS_CACHE, EVENTS_LIVE, draft_event_invite, extract_events,  # noqa: E402
                          read_runs, save_invite, suggest_audience)
from org_context import FOUNDATION_URLS, build_context, site_host  # noqa: E402

MAX_DRAFTS_PER_EVENT = 50
EVENT_FIELDS = ("starts_at", "ends_at", "place")      # what makes an event "changed"; a new citing page doesn't


def has_table(conn, name: str) -> bool:
    return conn is not None and bool(conn.execute(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?", (name,)).fetchone())


def stored_facts(conn) -> list[dict]:
    if not has_table(conn, "org_context"):
        return []
    conn.row_factory = sqlite3.Row
    return [dict(r) for r in conn.execute("SELECT source, url, fact, posted_at FROM org_context")]


def stored_events(conn, host: str) -> list[dict]:
    """The calendar as it stood before this run: data's events table when it exists, else the
    last cached run (runtime file, then the committed cache)."""
    if has_table(conn, "events"):
        conn.row_factory = sqlite3.Row
        return [dict(r) for r in conn.execute("SELECT * FROM events")]
    for path in (EVENTS_LIVE, EVENTS_CACHE):
        events = read_runs(path).get(host)
        if events is not None:
            return events
    return []


def event_key(e: dict) -> str:
    """Titles match ignoring case and punctuation ("Give Miami Day — Early Giving" = "Give Miami Day Early Giving")."""
    import re
    return " ".join(re.sub(r"[^a-z0-9]+", " ", (e.get("title") or "").lower()).split())


def diff_facts(before: list[dict], result: dict) -> dict:
    """Added / removed per source, only for sources that read ok this run."""
    ok = {s for s, st in (result.get("sources") or {}).items() if st in ("ok", "cached")}
    key = lambda f: (f.get("source"), f.get("url"), f.get("fact"))
    now = {key(f) for f in result.get("facts") or []}
    was = {key(f) for f in before}
    return {"added": sorted(k[2] for k in now - was),
            "removed": sorted(k[2] for k in was - now if k[0] in ok),
            "failed_sources": sorted(s for s, st in (result.get("sources") or {}).items()
                                     if str(st).startswith(("error", "blocked")))}


def diff_events(before: list[dict], after: list[dict], extraction_ok: bool, as_of: str) -> dict:
    was = {event_key(e): e for e in before}
    now = {event_key(e): e for e in after}
    new = [now[k] for k in now if k not in was]
    changed = [{"event": now[k], "before": {f: was[k].get(f) for f in EVENT_FIELDS},
                "after": {f: now[k].get(f) for f in EVENT_FIELDS}}
               for k in now if k in was and any((was[k].get(f) or None) != (now[k].get(f) or None) for f in EVENT_FIELDS)]
    # removed only when this run actually read events, and only upcoming ones (past events just age out)
    removed = [was[k] for k in was if k not in now and (was[k].get("starts_at") or "")[:10] >= as_of] if extraction_ok else []
    return {"new": new, "changed": changed, "removed": removed}


def load_people(conn) -> list[dict]:
    """Everyone the audience rule can pick from. Givers come from donors + donor_scores today;
    data's people table (contact_type, interests, has_dog) replaces this once it lands."""
    if has_table(conn, "people"):
        conn.row_factory = sqlite3.Row
        people = [dict(r) for r in conn.execute("SELECT * FROM people")]
        for p in people:
            if isinstance(p.get("interests"), str):
                p["interests"] = json.loads(p["interests"] or "[]")
        return people
    if not has_table(conn, "donors"):
        return []
    conn.row_factory = sqlite3.Row
    rows = conn.execute("""SELECT d.id, d.full_name, d.first_name, d.donor_type, d.email, d.phone,
                                  s.tier, s.is_star, s.status FROM donors d
                           LEFT JOIN donor_scores s ON s.donor_id = d.id""")
    return [dict(r) | {"contact_type": "giver"} for r in rows]


def data_writers(conn) -> dict:
    """data's 5E readers/writers, by name, if this checkout has them (db.save_events,
    db.save_event_audience, db.save_event_draft, routes_data.list_people)."""
    if conn is None:
        return {}
    found = {}
    try:
        import db
        for name in ("save_events", "save_event_audience", "save_event_draft"):
            if hasattr(db, name) and has_table(conn, "events"):
                found[name] = getattr(db, name)
    except ImportError:
        pass
    try:
        import routes_data
        if hasattr(routes_data, "list_people") and has_table(conn, "donors"):
            found["list_people"] = routes_data.list_people
    except ImportError:
        pass
    return found


def refresh(conn, urls: dict | None = None, as_of: str | None = None, people: list[dict] | None = None,
            *, build=build_context, extract=extract_events, audience=suggest_audience,
            invite=draft_event_invite, save=save_invite) -> dict:
    """One refresh pass. The agent functions are parameters so tests can stand them in."""
    started = time.monotonic()
    urls = urls or FOUNDATION_URLS
    host = site_host(urls.get("website"))
    as_of = as_of or os.environ.get("SCORE_AS_OF") or date.today().isoformat()
    errors = []

    # 1. context
    before_facts = stored_facts(conn)
    try:
        result = build(urls, refresh=True)
    except Exception as e:                            # the whole context run failed: keep everything
        result = {"facts": [], "sources": {"website": f"error: {type(e).__name__}", "news": f"error: {type(e).__name__}"}}
        errors.append(f"context: {type(e).__name__}: {e}")
    facts = diff_facts(before_facts, result)
    if conn is not None and result.get("facts"):
        try:
            from db import save_context
            save_context(conn, result)
            conn.commit()
        except (ImportError, sqlite3.Error) as e:
            errors.append(f"save_context: {e}")

    # 2. calendar
    before_events = stored_events(conn, host)
    try:
        after_events = extract(result.get("facts") or [], refresh=True, website=urls.get("website"))
        extraction_ok = bool(after_events)
        if not extraction_ok:
            errors.append("events: none found this run; calendar left as it was")
            after_events = before_events
    except Exception as e:
        errors.append(f"events: {type(e).__name__}: {e}")
        after_events, extraction_ok = before_events, False
    events = diff_events(before_events, after_events, extraction_ok, as_of)

    # data's writers (feat/three-tabs) when they exist; complete=True only after a good read,
    # so a failed run never deletes an event
    w = data_writers(conn)
    event_ids = {}
    if w.get("save_events") and extraction_ok:
        try:
            saved = w["save_events"](conn, after_events, complete=True)
            event_ids = {event_key(e): i for e, i in zip(after_events, saved.get("ids") or [])}
            conn.commit()
        except sqlite3.Error as ex:
            errors.append(f"save_events: {ex}")

    # 3. audience + invites for what's new or changed (drafts only)
    people = people if people is not None else (w["list_people"](conn) if w.get("list_people") else load_people(conn))
    by_id = {p["id"]: p for p in people}
    drafts = {}
    for e in events["new"] + [c["event"] for c in events["changed"]]:
        eid = event_ids.get(event_key(e))
        try:
            chosen = audience(e, people, rationale=False)
            if eid and w.get("save_event_audience"):
                w["save_event_audience"](conn, eid, chosen)
        except Exception as ex:
            errors.append(f"audience {e.get('title')}: {type(ex).__name__}")
            continue
        n = 0
        for pid in chosen["person_ids"][:MAX_DRAFTS_PER_EVENT]:
            try:
                inv = invite(e, by_id[pid])
                if eid and w.get("save_event_draft"):
                    w["save_event_draft"](conn, eid, pid, inv)
                else:
                    save(e, by_id[pid], inv)
                n += 1
            except Exception as ex:
                errors.append(f"invite {e.get('title')} -> {pid}: {type(ex).__name__}")
        drafts[e["title"]] = n
    if conn is not None:
        conn.commit()

    return {
        "as_of": as_of,
        "ran_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "seconds": round(time.monotonic() - started, 1),
        "sources": result.get("sources") or {},
        "facts": {"added": len(facts["added"]), "removed": len(facts["removed"]),
                  "failed_sources": facts["failed_sources"], "added_facts": facts["added"][:10]},
        "events": {"new": [e["title"] for e in events["new"]],
                   "changed": [{"title": c["event"]["title"], "before": c["before"], "after": c["after"]}
                               for c in events["changed"]],
                   "removed": [e["title"] for e in events["removed"]]},
        "drafts": drafts,
        "errors": errors,
    }


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--daily", action="store_true", help="run one refresh pass on the configured org")
    ap.add_argument("--as-of", help="YYYY-MM-DD (default: SCORE_AS_OF or today)")
    args = ap.parse_args()
    if not args.daily:
        ap.error("pass --daily")
    db_path = Path(os.environ.get("DONORS_DB", REPO_ROOT / "data" / "donors.db"))
    conn = sqlite3.connect(db_path) if db_path.exists() else None
    summary = refresh(conn, as_of=args.as_of)
    print(json.dumps(summary, indent=2, ensure_ascii=False))
    both_failed = {"website", "news"} <= set(summary["facts"]["failed_sources"])
    sys.exit(1 if both_failed else 0)               # the scheduler sees a run that read nothing
