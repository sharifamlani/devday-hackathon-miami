"""Data routes for the UI and the agents. main.py mounts this router:

    from service.routes_data import router as data_router
    app.include_router(data_router)

GET  /donors                     every donor with score fields, highest score first
GET  /donors/{id}                one donor: gifts, score + why, research_facts, outreach_drafts, merges, call_notes (newest 5)
GET  /duplicates                 pending duplicate suggestions with both donors
POST /duplicates/{id}/merge      merge a suggested pair (optional body {"keep_id": n, "approved_by": "name"}) → includes merge_id
POST /merges/{id}/undo           undo the newest merge into a donor → {kept_id, restored_id, donor, restored}
POST /duplicates/{id}/dismiss    "not a duplicate"
POST /score/run                  rescore everyone, refresh duplicate suggestions (?as_of=YYYY-MM-DD)
POST /drafts/{id}/approve        a human approves a draft (optional edited body) → status approved
GET  /icp                        the latest ideal donor profile (traits, stats, evidence), or null
GET  /prospects                  organization prospects, best fit first (?include_dismissed=true)
GET  /prospects/{id}             one prospect with its first-touch drafts
POST /prospects/{id}/dismiss     "not a fit"
GET  /org-profile                the Foundation's profile: URLs, priorities, voice, per-source status, or null
GET  /context                    dated, sourced facts about the Foundation, newest first (?source=x)
GET  /people                     people in one tab (?type=giver|neighbor|community, ?has_dog, ?interest) + counts
PATCH /people/{id}               move a person to another tab {"contact_type": ...}
GET  /events                     the calendar, upcoming first, with audience and draft counts
GET  /events/{id}                one event: recipients across the tabs (with why) + its drafted invites
GET  /context/status             when the context was last refreshed + the last refresh log row
GET  /community/stats            counts by each recorded demographic field, with a "not recorded" bucket
"""

from __future__ import annotations

import json
import sqlite3
from collections.abc import Iterator
from datetime import date, datetime, timezone

from fastapi import APIRouter, Body, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from service import dedupe, score
from service import db
from service.db import connect, create_schema

router = APIRouter(tags=["data"])
DONOR_CALL_NOTES = 5   # newest saved call notes shown on GET /donors/{id}


def get_conn() -> Iterator[sqlite3.Connection]:
    conn = connect()
    create_schema(conn)
    try:
        yield conn
    finally:
        conn.close()


def _donor_out(row: sqlite3.Row) -> dict:
    d = dict(row)
    d["emails_all"] = json.loads(d.get("emails_all") or "[]")
    # Invented demo history: the UI badges it and outreach must not cite its amounts as real.
    # Merged donors keep both source rows, newline-joined; any SAMPLE part makes the donor sample.
    d["is_sample"] = "SAMPLE" in (d.get("source_row") or "").splitlines()
    if "is_star" in d:
        d["is_star"] = bool(d["is_star"]) if d["is_star"] is not None else False
    if "why" in d:
        d["why"] = json.loads(d["why"]) if d["why"] else None
    if "interests" in d:
        d["interests"] = json.loads(d["interests"] or "[]")
        d["demographics"] = json.loads(d["demographics"] or "{}")
        d["has_dog"] = None if d["has_dog"] is None else bool(d["has_dog"])
    return d


DONOR_WITH_SCORE = """
SELECT d.*, s.score, s.tier, s.is_star, s.status, s.why, s.as_of AS score_as_of
FROM donors d LEFT JOIN donor_scores s ON s.donor_id = d.id
"""


@router.get("/donors")
def list_donors(conn: sqlite3.Connection = Depends(get_conn)) -> list[dict]:
    """Givers only: the call-today list. Every tab's people come from GET /people."""
    rows = conn.execute(DONOR_WITH_SCORE + " WHERE d.contact_type = 'giver'"
                        " ORDER BY s.score IS NULL, s.score DESC, d.id").fetchall()
    return [_donor_out(r) for r in rows]


@router.get("/donors/{donor_id}")
def get_donor(donor_id: int, conn: sqlite3.Connection = Depends(get_conn)) -> dict:
    row = conn.execute(DONOR_WITH_SCORE + " WHERE d.id = ?", (donor_id,)).fetchone()
    if row is None:
        raise HTTPException(404, f"donor {donor_id} not found")
    donor = _donor_out(row)
    donor["gifts"] = [dict(r) for r in conn.execute(
        "SELECT * FROM gifts WHERE donor_id = ? ORDER BY gift_date DESC", (donor_id,))]
    donor["research_facts"] = [dict(r) for r in conn.execute(
        "SELECT * FROM research_facts WHERE donor_id = ? ORDER BY retrieved_at DESC, id DESC", (donor_id,))]
    donor["outreach_drafts"] = [_draft_out(r) for r in conn.execute(
        "SELECT d.*, (SELECT ed.event_id FROM event_drafts ed WHERE ed.draft_id = d.id) AS event_id "
        "FROM outreach_drafts d WHERE d.donor_id = ? ORDER BY d.created_at DESC, d.id DESC", (donor_id,))]   # event_id: an invite
    donor["merges"] = dedupe.merges_for(conn, donor_id)
    donor["call_notes"] = db.list_call_notes(conn, donor_id=donor_id, limit=DONOR_CALL_NOTES)   # routes_calls.py
    return donor


def _draft_out(row: sqlite3.Row) -> dict:
    d = dict(row)
    d["facts_used"] = json.loads(d["facts_used"]) if d.get("facts_used") else []
    return d


@router.get("/duplicates")
def list_duplicates(conn: sqlite3.Connection = Depends(get_conn)) -> list[dict]:
    out = []
    for s in conn.execute(
            "SELECT * FROM duplicate_suggestions WHERE status = 'pending' ORDER BY confidence DESC, id"):
        item = dict(s)
        item["reasons"] = json.loads(item["reasons"])
        for side in ("a", "b"):
            donor = conn.execute(DONOR_WITH_SCORE + " WHERE d.id = ?", (item[f"donor_{side}_id"],)).fetchone()
            item[f"donor_{side}"] = _donor_out(donor) if donor else None
            item[f"donor_{side}_gift_count"] = conn.execute(
                "SELECT COUNT(*) FROM gifts WHERE donor_id = ?", (item[f"donor_{side}_id"],)).fetchone()[0]
        out.append(item)
    return out


@router.post("/duplicates/{suggestion_id}/merge")
def merge_duplicate(suggestion_id: int, keep_id: int | None = Body(None, embed=True),
                    approved_by: str | None = Body(None, embed=True),
                    conn: sqlite3.Connection = Depends(get_conn)) -> dict:
    try:
        result = dedupe.merge(conn, suggestion_id, keep_id, (approved_by or "").strip() or None)
    except LookupError as e:
        raise HTTPException(404, str(e))
    except ValueError as e:
        raise HTTPException(409, str(e))
    score.run(conn)
    result["donor"] = get_donor(result["kept_donor_id"], conn)
    return result


@router.post("/merges/{merge_id}/undo")
def undo_merge(merge_id: int, conn: sqlite3.Connection = Depends(get_conn)) -> dict:
    try:
        result = dedupe.undo_merge(conn, merge_id)
    except LookupError as e:
        raise HTTPException(404, str(e))
    except ValueError as e:
        raise HTTPException(409, str(e))
    score.run(conn)
    return {**result, "donor": get_donor(result["kept_id"], conn), "restored": get_donor(result["restored_id"], conn)}


@router.post("/duplicates/{suggestion_id}/dismiss")
def dismiss_duplicate(suggestion_id: int, conn: sqlite3.Connection = Depends(get_conn)) -> dict:
    try:
        dedupe.dismiss(conn, suggestion_id)
    except LookupError as e:
        raise HTTPException(404, str(e))
    return {"suggestion_id": suggestion_id, "status": "dismissed"}


@router.post("/score/run")
def run_scores(as_of: date | None = Query(None), conn: sqlite3.Connection = Depends(get_conn)) -> dict:
    scored = score.run(conn, as_of)
    pending = dedupe.run(conn)
    top = list_donors(conn)[:5]
    return {"scored": scored, "pending_duplicates": pending,
            "as_of": (as_of or score.default_as_of()).isoformat(),
            "top": [{"id": d["id"], "full_name": d["full_name"], "score": d["score"], "status": d["status"]}
                    for d in top]}


class ApproveDraft(BaseModel):
    approved_by: str = Field(min_length=1, description="The staff member approving the draft")
    body: str | None = Field(None, description="Edited body; omit to keep the draft as written")


@router.post("/drafts/{draft_id}/approve")
def approve_draft(draft_id: int, req: ApproveDraft, conn: sqlite3.Connection = Depends(get_conn)) -> dict:
    row = conn.execute("SELECT status FROM outreach_drafts WHERE id = ?", (draft_id,)).fetchone()
    if row is None:
        raise HTTPException(404, f"draft {draft_id} not found")
    if row["status"] == "sent":
        raise HTTPException(409, f"draft {draft_id} was already sent")
    approved_by = req.approved_by.strip()
    if not approved_by:
        raise HTTPException(422, "approved_by must name a person")
    approved_at = datetime.now(timezone.utc).isoformat(timespec="seconds")
    if req.body is not None:
        conn.execute("UPDATE outreach_drafts SET body = ? WHERE id = ?", (req.body, draft_id))
    conn.execute("UPDATE outreach_drafts SET status = 'approved', approved_by = ?, approved_at = ? WHERE id = ?",
                 (approved_by, approved_at, draft_id))
    conn.commit()
    return _draft_out(conn.execute("SELECT * FROM outreach_drafts WHERE id = ?", (draft_id,)).fetchone())


def _icp_out(row: sqlite3.Row) -> dict:
    d = dict(row)
    for k in ("traits", "stats", "evidence", "recent_context"):
        d[k] = json.loads(d[k]) if d.get(k) else ([] if k != "stats" else {})
    return d


def _prospect_out(row: sqlite3.Row) -> dict:
    d = dict(row)
    d["matched_traits"] = json.loads(d.get("matched_traits") or "[]")
    d["facts"] = json.loads(d.get("facts") or "[]")
    d["fit_breakdown"] = json.loads(d.get("fit_breakdown") or "{}")
    d["matched_context"] = json.loads(d.get("matched_context") or "[]")
    return d


def latest_icp(conn: sqlite3.Connection) -> dict | None:
    row = conn.execute("SELECT * FROM icp_profile ORDER BY id DESC LIMIT 1").fetchone()
    return _icp_out(row) if row else None


# "Not built yet" is 200 null, not 404: browsers log every 404 fetch as a console error.
@router.get("/icp")
def get_icp(conn: sqlite3.Connection = Depends(get_conn)) -> dict | None:
    return latest_icp(conn)


@router.get("/prospects")
def list_prospects(include_dismissed: bool = Query(False), conn: sqlite3.Connection = Depends(get_conn)) -> list[dict]:
    where = "" if include_dismissed else "WHERE status != 'dismissed'"
    return [_prospect_out(r) for r in conn.execute(
        f"SELECT * FROM prospects {where} ORDER BY fit_score DESC, id")]


@router.get("/prospects/{prospect_id}")
def get_prospect(prospect_id: int, conn: sqlite3.Connection = Depends(get_conn)) -> dict:
    row = conn.execute("SELECT * FROM prospects WHERE id = ?", (prospect_id,)).fetchone()
    if row is None:
        raise HTTPException(404, f"prospect {prospect_id} not found")
    prospect = _prospect_out(row)
    prospect["outreach_drafts"] = [_draft_out(r) for r in conn.execute(
        "SELECT * FROM outreach_drafts WHERE prospect_id = ? ORDER BY created_at DESC, id DESC", (prospect_id,))]
    return prospect


@router.post("/prospects/{prospect_id}/dismiss")
def dismiss_prospect(prospect_id: int, conn: sqlite3.Connection = Depends(get_conn)) -> dict:
    if conn.execute("UPDATE prospects SET status = 'dismissed' WHERE id = ?", (prospect_id,)).rowcount == 0:
        raise HTTPException(404, f"prospect {prospect_id} not found")
    conn.commit()
    return get_prospect(prospect_id, conn)


CONTEXT_ORDER = " ORDER BY posted_at IS NULL, posted_at DESC, id DESC"


def get_org_profile_or_none(conn: sqlite3.Connection) -> dict | None:
    row = conn.execute("SELECT * FROM org_profile ORDER BY id DESC LIMIT 1").fetchone()
    if row is None:
        return None
    d = dict(row)
    d["priorities"] = json.loads(d.get("priorities") or "[]")
    d["voice"] = json.loads(d.get("voice") or "{}")
    d["source_status"] = json.loads(d.get("source_status") or "{}")
    return d


def list_context(conn: sqlite3.Connection, source: str | None = None) -> list[dict]:
    if source:
        rows = conn.execute("SELECT * FROM org_context WHERE source = ?" + CONTEXT_ORDER, (source,))
    else:
        rows = conn.execute("SELECT * FROM org_context" + CONTEXT_ORDER)
    return [dict(r) for r in rows]


@router.get("/org-profile")
def get_org_profile(conn: sqlite3.Connection = Depends(get_conn)) -> dict | None:
    return get_org_profile_or_none(conn)


@router.get("/context")
def get_context(source: str | None = Query(None, pattern="^(website|x|linkedin|instagram|news)$"),
                conn: sqlite3.Connection = Depends(get_conn)) -> list[dict]:
    return list_context(conn, source)



# ---- 5E: three tabs, events, community stats ----------------------------------------------------

CONTACT_TYPE_PATTERN = "^(giver|neighbor|community)$"
NOT_RECORDED = "not recorded"


def people_counts(conn: sqlite3.Connection) -> dict:
    counts = {t: 0 for t in db.CONTACT_TYPES}
    for row in conn.execute("SELECT contact_type, COUNT(*) FROM donors GROUP BY contact_type"):
        counts[row[0]] = row[1]
    counts["needs_review"] = conn.execute("SELECT COUNT(*) FROM donors WHERE tab_review IS NOT NULL").fetchone()[0]
    return counts


def list_people(conn: sqlite3.Connection, contact_type: str | None = None, has_dog: bool | None = None,
                interest: str | None = None) -> list[dict]:
    """In-process helper for the chat agent's find_people and the routes. Givers come best score first,
    everyone else by name. interest matches a tag case-insensitively."""
    where, args = [], []
    if contact_type:
        where.append("d.contact_type = ?")
        args.append(contact_type)
    if has_dog is not None:
        where.append("d.has_dog = ?")
        args.append(int(has_dog))
    if interest:
        where.append("EXISTS (SELECT 1 FROM json_each(COALESCE(d.interests, '[]')) WHERE lower(value) = lower(?))")
        args.append(interest)
    sql = DONOR_WITH_SCORE + (" WHERE " + " AND ".join(where) if where else "")
    sql += " ORDER BY s.score IS NULL, s.score DESC, d.full_name, d.id"
    return [_donor_out(r) for r in conn.execute(sql, args)]


@router.get("/people")
def get_people(type: str | None = Query(None, pattern=CONTACT_TYPE_PATTERN), has_dog: bool | None = Query(None),
               interest: str | None = Query(None), conn: sqlite3.Connection = Depends(get_conn)) -> dict:
    return {"type": type, "counts": people_counts(conn), "people": list_people(conn, type, has_dog, interest)}


class MovePerson(BaseModel):
    contact_type: str = Field(pattern=CONTACT_TYPE_PATTERN)


@router.patch("/people/{person_id}")
def move_person(person_id: int, req: MovePerson, conn: sqlite3.Connection = Depends(get_conn)) -> dict:
    """One-click move between tabs; clears any review flag. A new Giver is scored right away."""
    if conn.execute("UPDATE donors SET contact_type = ?, tab_review = NULL WHERE id = ?",
                    (req.contact_type, person_id)).rowcount == 0:
        raise HTTPException(404, f"person {person_id} not found")
    conn.commit()
    score.run(conn)
    return get_donor(person_id, conn)


EVENT_WITH_COUNTS = """
SELECT e.*,
       (SELECT COUNT(*) FROM event_audience ea WHERE ea.event_id = e.id) AS audience_count,
       (SELECT COUNT(*) FROM event_drafts ed JOIN outreach_drafts d ON d.id = ed.draft_id
         WHERE ed.event_id = e.id AND d.status IN ('draft', 'ready', 'approved')) AS drafts_ready
FROM events e
"""


def event_batches(conn: sqlite3.Connection) -> dict[int, int]:
    """{event_id: latest campaign id} once campaigns.event_id exists (90's #58 hook); empty until then."""
    cols = {r[1] for r in conn.execute("PRAGMA table_info(campaigns)")}
    if "event_id" not in cols:
        return {}
    return {r[0]: r[1] for r in conn.execute(
        "SELECT event_id, MAX(id) FROM campaigns WHERE event_id IS NOT NULL GROUP BY event_id")}


def list_events(conn: sqlite3.Connection, today: date | None = None) -> list[dict]:
    """Upcoming first (soonest first), then past events (most recent first). batch_id is the event's
    outreach campaign, or null."""
    today_s = (today or score.default_as_of()).isoformat()
    rows = conn.execute(
        EVENT_WITH_COUNTS + " ORDER BY substr(e.starts_at, 1, 10) < ?, "
        "CASE WHEN substr(e.starts_at, 1, 10) >= ? THEN e.starts_at END ASC, e.starts_at DESC, e.id",
        (today_s, today_s))
    batches = event_batches(conn)
    return [{**dict(r), "batch_id": batches.get(r["id"])} for r in rows]


@router.get("/events")
def get_events(conn: sqlite3.Connection = Depends(get_conn)) -> list[dict]:
    return list_events(conn)


def event_detail(conn: sqlite3.Connection, event_id: int) -> dict | None:
    row = conn.execute(EVENT_WITH_COUNTS + " WHERE e.id = ?", (event_id,)).fetchone()
    if row is None:
        return None
    event = dict(row)
    event["batch_id"] = event_batches(conn).get(event_id)
    event["recipients"] = [
        {"person_id": r["person_id"], "full_name": r["full_name"], "contact_type": r["contact_type"],
         "donor_type": r["donor_type"], "has_dog": None if r["has_dog"] is None else bool(r["has_dog"]),
         "reason": r["reason"]}
        for r in conn.execute(
            "SELECT ea.person_id, ea.reason, p.full_name, p.contact_type, p.donor_type, p.has_dog "
            "FROM event_audience ea JOIN donors p ON p.id = ea.person_id WHERE ea.event_id = ? "
            "ORDER BY ea.rowid", (event_id,))]
    event["drafts"] = [
        {**_draft_out(r), "person_id": r["donor_id"], "full_name": r["full_name"], "contact_type": r["contact_type"]}
        for r in conn.execute(
            "SELECT d.*, p.full_name, p.contact_type FROM outreach_drafts d JOIN event_drafts ed ON ed.draft_id = d.id "
            "LEFT JOIN donors p ON p.id = d.donor_id WHERE ed.event_id = ? ORDER BY d.id", (event_id,))]
    return event


@router.get("/events/{event_id}")
def get_event(event_id: int, conn: sqlite3.Connection = Depends(get_conn)) -> dict:
    event = event_detail(conn, event_id)
    if event is None:
        raise HTTPException(404, f"event {event_id} not found")
    return event


def context_status(conn: sqlite3.Connection) -> dict:
    profile = conn.execute("SELECT last_refreshed_at FROM org_profile WHERE id = 1").fetchone()
    row = conn.execute("SELECT * FROM context_refresh_log ORDER BY id DESC LIMIT 1").fetchone()
    last = None
    if row:
        last = dict(row)
        last["sources_read"] = json.loads(last["sources_read"] or "{}")
        last["errors"] = json.loads(last["errors"] or "[]")
    return {"last_refreshed_at": profile["last_refreshed_at"] if profile else None, "last_run": last}


@router.get("/context/status")
def get_context_status(conn: sqlite3.Connection = Depends(get_conn)) -> dict:
    return context_status(conn)


def community_stats(conn: sqlite3.Connection) -> dict:
    """Counts by each self-reported demographic field across the Community tab. A field missing from a
    record lands in "not recorded"; list fields (programs) count each value once per person."""
    people = [json.loads(r[0] or "{}") for r in conn.execute(
        "SELECT demographics FROM donors WHERE contact_type = 'community'")]
    fields = {}
    for field in db.DEMOGRAPHIC_FIELDS:
        buckets: dict[str, int] = {}
        recorded = 0
        for demo in people:
            entry = demo.get(field)
            value = entry.get("value") if isinstance(entry, dict) else entry
            values = [v for v in (value if isinstance(value, list) else [value]) if v not in (None, "")]
            if not values:
                continue
            recorded += 1
            for v in dict.fromkeys(str(v) for v in values):
                buckets[v] = buckets.get(v, 0) + 1
        missing = len(people) - recorded
        fields[field] = {
            "recorded": recorded,
            "not_recorded": missing,
            "buckets": [{"value": v, "count": n} for v, n in sorted(buckets.items(), key=lambda kv: (-kv[1], kv[0]))]
                       + ([{"value": NOT_RECORDED, "count": missing}] if missing else []),
        }
    return {
        "total": len(people),
        "as_of": score.default_as_of().isoformat(),
        "note": "Counts use only what the nonprofit recorded; nothing is inferred.",
        "fields": fields,
        # Flat view for charts: {field: {bucket: count}}, with "not recorded" as a bucket.
        "breakdowns": {f: {b["value"]: b["count"] for b in v["buckets"]} for f, v in fields.items()},
    }


@router.get("/community/stats")
def get_community_stats(conn: sqlite3.Connection = Depends(get_conn)) -> dict:
    return community_stats(conn)
