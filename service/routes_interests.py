"""Interest-tag routes (B1, plan §21.5). Mounted in service/main.py, before main's own POST /enrich.

    GET    /interest-tags                         the 17 tags: [{slug, label, definition}]
    GET    /people/{id}/interests                 [{tag, sub_tag, confidence, evidence, source_url, set_by, ...}]
    POST   /people/{id}/interests                 staff adds {tag, sub_tag?}; same list back (X-Undo-Token header)
    DELETE /people/{id}/interests/{tag}           {removed, undo}; the row is kept with status 'removed'
    POST   /enrich/{id}?dry_run=1                 {facts[], interests[], contact{}}: proposals, nothing written
    POST   /enrich/{id}                           unchanged: main's enrich (saves research facts)
    POST   /people/{id}/enrichment/accept         {fact_ids, tags} → {saved, undo}: the "Save to profile" button

Undo tokens ("int_...") reverse a change through service.interests.undo.
"""
from __future__ import annotations

import asyncio
import sqlite3
import uuid

from fastapi import APIRouter, Body, Depends, HTTPException, Query, Response
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel

from service import interests
from service.routes_data import get_conn

router = APIRouter(tags=["interests"])

ENRICH_TIMEOUT_S = 90
# The latest dry-run proposal per person, so Save writes exactly what staff reviewed
PROPOSALS: dict[int, dict] = {}


class AddInterest(BaseModel):
    tag: str
    sub_tag: str | None = None
    staff: str = "staff"


class AcceptEnrichment(BaseModel):
    fact_ids: list[str] = []
    tags: list[str] = []


def donor_row(conn: sqlite3.Connection, donor_id: int) -> dict:
    row = conn.execute("SELECT * FROM donors WHERE id = ?", (donor_id,)).fetchone()
    if row is None:
        raise HTTPException(404, f"person {donor_id} not found")
    return dict(row)


@router.get("/interest-tags")
def interest_tags(conn: sqlite3.Connection = Depends(get_conn)) -> list[dict]:
    return interests.list_tags(conn)


@router.get("/people/{donor_id}/interests")
def person_interests(donor_id: int, include_removed: bool = False,
                     conn: sqlite3.Connection = Depends(get_conn)) -> list[dict]:
    donor_row(conn, donor_id)
    return interests.list_interests(conn, donor_id, include_removed)


@router.post("/people/{donor_id}/interests")
def add_person_interest(donor_id: int, req: AddInterest, response: Response,
                        conn: sqlite3.Connection = Depends(get_conn)) -> list[dict]:
    donor_row(conn, donor_id)
    try:
        result = interests.add_interest(conn, donor_id, req.tag, req.sub_tag, staff=req.staff)
    except ValueError as e:
        raise HTTPException(422, str(e))
    response.headers["X-Undo-Token"] = result["undo"]
    return result["interests"]


@router.delete("/people/{donor_id}/interests/{tag}")
def remove_person_interest(donor_id: int, tag: str, staff: str = Query("staff"),
                           conn: sqlite3.Connection = Depends(get_conn)) -> dict:
    donor_row(conn, donor_id)
    try:
        return interests.remove_interest(conn, donor_id, tag, staff=staff)
    except ValueError as e:
        raise HTTPException(422, str(e))


async def propose(donor: dict, refresh: bool) -> dict:
    from service.enrich_agent import enrich_full
    try:
        return await asyncio.wait_for(run_in_threadpool(
            enrich_full, donor["full_name"], donor.get("org_name"), donor.get("city"),
            donor.get("donor_type"), refresh), ENRICH_TIMEOUT_S)
    except asyncio.TimeoutError:
        raise HTTPException(504, f"enrichment took longer than {ENRICH_TIMEOUT_S} s; try again")


@router.post("/enrich/{donor_id}")
async def enrich(donor_id: int, dry_run: bool = False, refresh: bool = False,
                 conn: sqlite3.Connection = Depends(get_conn)) -> dict:
    """dry_run=1: propose facts, interest tags and contact; nothing is written. Otherwise main's enrich."""
    if not dry_run:
        from service import main   # loaded already: this router is mounted by main
        return await main.enrich(donor_id, refresh)
    donor = donor_row(conn, donor_id)
    result = await propose(donor, refresh)
    PROPOSALS[donor_id] = result
    return {"donor_id": donor_id, "full_name": donor["full_name"], "dry_run": True, **result}


@router.post("/people/{donor_id}/enrichment/accept")
async def accept(donor_id: int, req: AcceptEnrichment = Body(...),
                 conn: sqlite3.Connection = Depends(get_conn)) -> dict:
    """Save to profile: write the facts and tags staff picked from the latest proposal."""
    donor = donor_row(conn, donor_id)
    proposal = PROPOSALS.get(donor_id)
    if proposal is None:
        from service.enrich_agent import read_interest_cache
        proposal = read_interest_cache().get(donor["full_name"])
    if proposal is None:
        raise HTTPException(409, "no proposal for this person yet; run POST /enrich/{id}?dry_run=1 first")
    try:
        return interests.accept_enrichment(conn, donor_id, proposal, req.fact_ids, req.tags,
                                           agent_run_id=f"enrich-accept-{uuid.uuid4().hex[:12]}")
    except ValueError as e:
        raise HTTPException(422, str(e))
