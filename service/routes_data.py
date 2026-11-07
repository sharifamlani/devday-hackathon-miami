"""Data routes for the UI and the agents. main.py mounts this router:

    from service.routes_data import router as data_router
    app.include_router(data_router)

GET  /donors                     every donor with score fields, highest score first
GET  /donors/{id}                one donor: gifts, score + why, research_facts, outreach_drafts
GET  /duplicates                 pending duplicate suggestions with both donors
POST /duplicates/{id}/merge      merge a suggested pair (optional body {"keep_id": n})
POST /duplicates/{id}/dismiss    "not a duplicate"
POST /score/run                  rescore everyone, refresh duplicate suggestions (?as_of=YYYY-MM-DD)
POST /drafts/{id}/approve        a human approves a draft (optional edited body) → status approved
GET  /icp                        the latest ideal donor profile (traits, stats, evidence)
GET  /prospects                  organization prospects, best fit first (?include_dismissed=true)
GET  /prospects/{id}             one prospect with its first-touch drafts
POST /prospects/{id}/dismiss     "not a fit"
"""

from __future__ import annotations

import json
import sqlite3
from collections.abc import Iterator
from datetime import date, datetime, timezone

from fastapi import APIRouter, Body, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from service import dedupe, score
from service.db import connect, create_schema

router = APIRouter(tags=["data"])


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
    return d


DONOR_WITH_SCORE = """
SELECT d.*, s.score, s.tier, s.is_star, s.status, s.why, s.as_of AS score_as_of
FROM donors d LEFT JOIN donor_scores s ON s.donor_id = d.id
"""


@router.get("/donors")
def list_donors(conn: sqlite3.Connection = Depends(get_conn)) -> list[dict]:
    rows = conn.execute(DONOR_WITH_SCORE + " ORDER BY s.score IS NULL, s.score DESC, d.id").fetchall()
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
        "SELECT * FROM outreach_drafts WHERE donor_id = ? ORDER BY created_at DESC, id DESC", (donor_id,))]
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
                    conn: sqlite3.Connection = Depends(get_conn)) -> dict:
    try:
        result = dedupe.merge(conn, suggestion_id, keep_id)
    except LookupError as e:
        raise HTTPException(404, str(e))
    except ValueError as e:
        raise HTTPException(409, str(e))
    score.run(conn)
    result["donor"] = get_donor(result["kept_donor_id"], conn)
    return result


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
    for k in ("traits", "stats", "evidence"):
        d[k] = json.loads(d[k]) if d.get(k) else ([] if k != "stats" else {})
    return d


def _prospect_out(row: sqlite3.Row) -> dict:
    d = dict(row)
    d["matched_traits"] = json.loads(d.get("matched_traits") or "[]")
    d["facts"] = json.loads(d.get("facts") or "[]")
    return d


def latest_icp(conn: sqlite3.Connection) -> dict | None:
    row = conn.execute("SELECT * FROM icp_profile ORDER BY id DESC LIMIT 1").fetchone()
    return _icp_out(row) if row else None


@router.get("/icp")
def get_icp(conn: sqlite3.Connection = Depends(get_conn)) -> dict:
    icp = latest_icp(conn)
    if icp is None:
        raise HTTPException(404, "no ideal donor profile yet: run the pipeline or POST /icp/run")
    return icp


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
