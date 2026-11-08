"""Daily refresh: keep the org's context and calendar current, and pre-draft invites for what changed.

refresh(conn, urls, as_of) runs:
  1. build_context (website + news, live)  } in parallel -> diff facts against org_context
  2. extract_events (stored facts as hints) }             -> diff events: new / changed / removed
  3. for each new or changed event only: suggest_audience + draft_event_invite, invites drafted
     in parallel (drafts only, never sent)
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
INVITE_WORKERS = 16                                   # concurrent invite model calls
EVENT_FIELDS = ("starts_at", "ends_at", "place")      # what makes an event "changed"; a new citing page doesn't


def has_table(conn, name: str) -> bool:
    return conn is not None and bool(conn.execute(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?", (name,)).fetchone())


def stored_facts(conn) -> list[dict]:
    if not has_table(conn, "org_context"):
        return []
    conn.row_factory = sqlite3.Row
    return [dict(r) for r in conn.execute("SELECT source, url, fact, posted_at FROM org_context")]


def saved_urls(conn) -> dict | None:
    """The org's URLs as onboarding saved them in org_profile, or None before onboarding."""
    if not has_table(conn, "org_profile"):
        return None
    keys = ("name", "website", "x_url", "linkedin_url", "instagram_url")
    row = conn.execute(f"SELECT {', '.join(keys)} FROM org_profile ORDER BY id DESC LIMIT 1").fetchone()
    return dict(zip(keys, row)) if row and row[1] else None


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


def same_event(a: dict, b: dict, by_date: bool = True) -> bool:
    """Search words the same event differently run to run ("Give Miami Day" vs "Give Miami Day -
    15th anniversary"). Same event = one title contains the other, or most title words overlap;
    with by_date, also the same start date. Two events on one day with different start times are different
    events, however alike their titles ("The Give Miami 5K" at 8:00 vs its Post-Race Festival at 8:30)."""
    sa, sb = a.get("starts_at") or "", b.get("starts_at") or ""
    if by_date and sa[:10] != sb[:10]:
        return False
    if by_date and len(sa) > 10 and len(sb) > 10 and sa[11:16] != sb[11:16]:
        return False
    ka, kb = event_key(a), event_key(b)
    if not ka or not kb:
        return False
    if ka in kb or kb in ka:
        return True
    wa, wb = set(ka.split()), set(kb.split())
    return len(wa & wb) / len(wa | wb) >= 0.6


def match(e: dict, pool: list[dict]) -> dict | None:
    """The stored event this one is: same date first, else the same title on another date (a move)."""
    return (next((p for p in pool if same_event(e, p)), None)
            or next((p for p in pool if event_key(p) == event_key(e)), None))


def diff_events(before: list[dict], after: list[dict], extraction_ok: bool, as_of: str) -> dict:
    new, changed, matched = [], [], []
    for e in after:
        old = match(e, [b for b in before if not any(b is m for m in matched)])
        if old is None:
            new.append(e)
            continue
        matched.append(old)
        if any((old.get(f) or None) != (e.get(f) or None) for f in EVENT_FIELDS):
            changed.append({"event": e, "before": {f: old.get(f) for f in EVENT_FIELDS},
                            "after": {f: e.get(f) for f in EVENT_FIELDS}})
    # removed only when this run actually read events, and only upcoming ones (past events just age out)
    removed = [b for b in before if not any(b is m for m in matched)
               and (b.get("starts_at") or "")[:10] >= as_of] if extraction_ok else []
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


def save_found_events(conn, events: list[dict]) -> tuple[dict, bool]:
    """Store events found in a successful read through data's save_events (complete=True: nothing is
    removed unless this read found events). Returns ({event key: id or None}, stored_in_db)."""
    w = data_writers(conn)
    if not events or not w.get("save_events"):
        return {}, False
    saved = w["save_events"](conn, events, complete=True)
    conn.commit()
    return {event_key(e): i for e, i in zip(events, saved.get("ids") or [])}, True


def draft_invites_for(conn, events: list[dict], event_ids: dict, stored_in_db: bool, people: list[dict] | None = None,
                      *, audience=suggest_audience, invite=draft_event_invite, save=save_invite) -> dict:
    """Audience + invite drafts (never sent) for these events: {drafts: {title: n}, errors: [...]}. Shared by
    the daily refresh (new or changed events) and onboarding (every event the first read found)."""
    from concurrent.futures import ThreadPoolExecutor
    w = data_writers(conn)
    errors = []
    people = people if people is not None else (w["list_people"](conn) if w.get("list_people") else load_people(conn))
    by_id = {p["id"]: p for p in people}
    drafts, work = {}, []
    for e in events:
        eid = event_ids.get(event_key(e))
        if stored_in_db and eid is None:              # data rejected it (no source, title or date): no invites anywhere
            errors.append(f"event rejected by save_events, no invites drafted: {e.get('title')}")
            continue
        try:
            chosen = audience(e, people, rationale=False)
            if eid and w.get("save_event_audience"):
                w["save_event_audience"](conn, eid, chosen)
        except Exception as ex:
            errors.append(f"audience {e.get('title')}: {type(ex).__name__}")
            continue
        drafts[e["title"]] = 0
        work += [(e, eid, pid) for pid in chosen["person_ids"][:MAX_DRAFTS_PER_EVENT] if pid in by_id]

    # every invite for every event in one pool of model calls; writes stay on this thread
    with ThreadPoolExecutor(max_workers=INVITE_WORKERS) as pool:
        jobs = [(e, eid, pid, pool.submit(invite, e, by_id[pid])) for e, eid, pid in work]
    for e, eid, pid, job in jobs:
        try:
            inv = job.result()
            if eid and w.get("save_event_draft"):
                w["save_event_draft"](conn, eid, pid, inv)
            else:
                save(e, by_id[pid], inv)
            drafts[e["title"]] += 1
        except Exception as ex:
            errors.append(f"invite {e.get('title')} -> {pid}: {type(ex).__name__}")
    if conn is not None:
        conn.commit()
    return {"drafts": drafts, "errors": errors}


def refresh(conn, urls: dict | None = None, as_of: str | None = None, people: list[dict] | None = None,
            *, build=build_context, extract=extract_events, audience=suggest_audience,
            invite=draft_event_invite, save=save_invite) -> dict:
    """One refresh pass. The agent functions are parameters so tests can stand them in."""
    started = time.monotonic()
    urls = urls or saved_urls(conn) or FOUNDATION_URLS    # the saved org first; the Foundation only before onboarding
    host = site_host(urls.get("website"))
    as_of = as_of or os.environ.get("SCORE_AS_OF") or date.today().isoformat()
    errors = []

    # 1 + 2 in parallel: the context run (website + news searches) and the event search are
    # independent. Events get the stored facts as hints, so they needn't wait for the new ones.
    from concurrent.futures import ThreadPoolExecutor

    before_facts = stored_facts(conn)
    before_events = stored_events(conn, host)
    with ThreadPoolExecutor(max_workers=2) as pool:
        ctx_job = pool.submit(build, urls, refresh=True)
        ev_job = pool.submit(extract, before_facts, refresh=True, website=urls.get("website"))
        try:
            result = ctx_job.result()
        except Exception as e:                        # the whole context run failed: keep everything
            result = {"facts": [], "sources": {"website": f"error: {type(e).__name__}", "news": f"error: {type(e).__name__}"}}
            errors.append(f"context: {type(e).__name__}: {e}")
        try:
            after_events = ev_job.result()
            extraction_ok = bool(after_events)
            if not extraction_ok:
                errors.append("events: none found this run; calendar left as it was")
                after_events = before_events
        except Exception as e:
            errors.append(f"events: {type(e).__name__}: {e}")
            after_events, extraction_ok = before_events, False
    facts = diff_facts(before_facts, result)
    if conn is not None and result.get("facts"):
        try:
            from db import save_context
            save_context(conn, result)
            conn.commit()
        except (ImportError, sqlite3.Error) as e:
            errors.append(f"save_context: {e}")

    events = diff_events(before_events, after_events, extraction_ok, as_of)

    # data's writers (feat/three-tabs) when they exist; complete=True only after a good read,
    # so a failed run never deletes an event
    w = data_writers(conn)
    event_ids, stored_in_db = {}, False
    if w.get("save_events") and extraction_ok:
        try:
            saved = w["save_events"](conn, after_events, complete=True)
            event_ids = {event_key(e): i for e, i in zip(after_events, saved.get("ids") or [])}
            stored_in_db = True
            conn.commit()
        except sqlite3.Error as ex:
            errors.append(f"save_events: {ex}")

    # 3. audience + invites for what's new or changed (drafts only)
    out = draft_invites_for(conn, events["new"] + [c["event"] for c in events["changed"]], event_ids,
                            stored_in_db, people, audience=audience, invite=invite, save=save)
    drafts = out["drafts"]
    errors += out["errors"]

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
