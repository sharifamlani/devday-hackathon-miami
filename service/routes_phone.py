"""Phone call routes (plan §21 S1): call a donor from the staff member's own phone. main.py mounts this router.

    GET  /phone/preview?donor_id=        -> {ready, reason, donor_name, donor_phone, staff_phone, notice} (masked)
    POST /phone/calls {donor_id}         -> rings the staff phone; the phone_calls row (409 + reason if not ready)
    GET  /phone/calls/{id}               -> {status: calling_you|calling_donor|connected|processing|done|failed,
                                             detail, note_id, duration_sec, result: {summary, next_steps, actions}}
    POST /phone/calls/{id}/hangup        -> ends both legs; a connected call is still transcribed and saved

Follow-ups in result.actions are applied with the existing POST /call-notes/{note_id}/apply.
"""

from __future__ import annotations

import sqlite3

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from service import phone
from service.routes_data import get_conn

router = APIRouter(tags=["phone"])


class CallBody(BaseModel):
    donor_id: int


@router.get("/phone/preview")
def preview_call(donor_id: int = Query(...), conn: sqlite3.Connection = Depends(get_conn)) -> dict:
    try:
        return phone.preview(conn, donor_id)
    except LookupError as e:
        raise HTTPException(404, str(e))


@router.post("/phone/calls")
def start_call(body: CallBody, conn: sqlite3.Connection = Depends(get_conn)) -> dict:
    try:
        return phone.start_call(conn, body.donor_id)
    except LookupError as e:
        raise HTTPException(404, str(e))
    except phone.PhoneError as e:
        raise HTTPException(409, str(e))


@router.get("/phone/calls/{call_id}")
def get_call(call_id: str, conn: sqlite3.Connection = Depends(get_conn)) -> dict:
    try:
        return phone.get_call(conn, call_id, check_worker=True)
    except LookupError as e:
        raise HTTPException(404, str(e))


@router.post("/phone/calls/{call_id}/hangup")
def hang_up(call_id: str, conn: sqlite3.Connection = Depends(get_conn)) -> dict:
    try:
        return phone.hang_up(conn, call_id)
    except LookupError as e:
        raise HTTPException(404, str(e))
    except phone.PhoneError as e:
        raise HTTPException(409, str(e))
