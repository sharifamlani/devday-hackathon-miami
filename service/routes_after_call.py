"""After-call routes (B6, plan §21.5).

POST /call-notes/{id}/actions   propose follow-up actions from the call (writes nothing)
POST /call-notes/{id}/apply     {action_ids} -> write those actions; each at most once
GET  /people/{id}/pledges       promises made on calls (never counted as money raised)
"""

from __future__ import annotations

import sqlite3

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from service import after_call_agent as aca
from service.routes_data import get_conn

router = APIRouter(tags=["after-call"])


class ApplyBody(BaseModel):
    action_ids: list[str]


@router.post("/call-notes/{note_id}/actions")
def propose_actions(note_id: str, conn: sqlite3.Connection = Depends(get_conn)) -> dict:
    try:
        return aca.propose(conn, note_id)
    except aca.NotFound as e:
        raise HTTPException(404, str(e))


@router.post("/call-notes/{note_id}/apply")
def apply_actions(note_id: str, body: ApplyBody, conn: sqlite3.Connection = Depends(get_conn)) -> dict:
    try:
        return aca.apply(conn, note_id, body.action_ids)
    except aca.NotFound as e:
        raise HTTPException(404, str(e))


@router.get("/people/{person_id}/pledges")
def get_pledges(person_id: int, conn: sqlite3.Connection = Depends(get_conn)) -> list[dict]:
    return aca.list_pledges(conn, person_id)
