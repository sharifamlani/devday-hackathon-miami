"""Calendar v3: staff add, edit and remove organization events (service/events_crud.py). GET /events and
GET /events/{id} stay in routes_data.py; GET /calendar?kind=event is in routes_tasks.py.

POST   /events         {title, starts_at | date + time?, ends_at?, place?, event_kind?, notes?, source?, source_url?}
                       -> {...event, undo_token}; source staff (default) | agent need no source_url
PATCH  /events/{id}    any of title, starts_at | date + time, ends_at, place, event_kind, notes -> {...event, undo_token}
DELETE /events/{id}    -> {deleted: true, undo_token}
Website/news/search events: 403 (the refresh owns them). Undo: POST /undo/{token}.
"""
from __future__ import annotations

import sqlite3
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from service import events_crud as ev
from service.routes_data import get_conn

router = APIRouter(tags=["events"])
Kind = Literal["fundraising", "stewardship", "community", "other"]


class EventIn(BaseModel):
    title: str = Field(min_length=1, max_length=300)
    starts_at: str | None = None
    date: str | None = None
    time: str | None = None
    ends_at: str | None = None
    place: str | None = Field(None, max_length=300)
    event_kind: Kind | None = None
    notes: str | None = Field(None, max_length=4000)
    source: Literal["staff", "agent", "website", "news", "search"] = "staff"
    source_url: str | None = Field(None, max_length=2000)


class EventPatch(BaseModel):
    title: str | None = Field(None, min_length=1, max_length=300)
    starts_at: str | None = None
    date: str | None = None
    time: str | None = None
    ends_at: str | None = None
    place: str | None = Field(None, max_length=300)
    event_kind: Kind | None = None
    notes: str | None = Field(None, max_length=4000)


def _call(fn, *args, **kwargs):
    try:
        return fn(*args, **kwargs)
    except ev.EventNotFound as e:
        raise HTTPException(404, str(e))
    except ev.EventLocked as e:
        raise HTTPException(403, str(e))
    except ev.EventError as e:
        raise HTTPException(422, str(e))


@router.post("/events")
def post_event(body: EventIn, conn: sqlite3.Connection = Depends(get_conn)) -> dict:
    when = _call(ev.starts_at, body.starts_at, body.date, body.time)
    extra = body.model_dump(exclude={"title", "starts_at", "date", "time", "source", "source_url"}, exclude_none=True)
    event, token = _call(ev.add_event, conn, title=body.title, starts_at_=when, source=body.source,
                         source_url=body.source_url, actor="staff", **extra)
    return {**event, "undo_token": token}


@router.patch("/events/{event_id}")
def patch_event(event_id: int, body: EventPatch, conn: sqlite3.Connection = Depends(get_conn)) -> dict:
    sent = body.model_dump(exclude_unset=True)
    day, time, value = sent.pop("date", None), sent.pop("time", None), sent.pop("starts_at", None)
    if value or day:
        sent["starts_at"] = _call(ev.starts_at, value, day, time)
    event, token = _call(ev.update_event, conn, event_id, actor="staff", **sent)
    return {**event, "undo_token": token}


@router.delete("/events/{event_id}")
def remove_event(event_id: int, conn: sqlite3.Connection = Depends(get_conn)) -> dict:
    _, token = _call(ev.delete_event, conn, event_id, actor="staff")
    return {"deleted": True, "undo_token": token}
