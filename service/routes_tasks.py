"""Tasks, calendar, artifacts and undo over HTTP (plan.md §21.5). Thin: every write is a service.tasks call.

GET    /tasks?due=today | from&to | person_id      [{id, kind, title, why, person_id, chips[], due, time, done, source}]
POST   /tasks                                       task + undo_token
PATCH  /tasks/{id}                                  task + undo_token (done: true completes it)
DELETE /tasks/{id}                                  {deleted: true, undo_token}
POST   /tasks/generate                              {created, tasks} (idempotent)
GET    /calendar?from&to                            [{date, time, title, kind: event|task, source, ref}]
GET    /artifacts                                   [{kind: call_note|draft|report, title, date, ref}]
POST   /undo/{token}                                {undone: true}; int_… tokens go to service.interests
"""

from __future__ import annotations

import sqlite3
from datetime import date
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from service import tasks
from service.routes_data import get_conn

router = APIRouter(tags=["tasks"])

Kind = Literal["call", "email", "review", "prep", "other"]


class TaskIn(BaseModel):
    kind: Kind = "other"
    title: str = Field(min_length=1)
    why: str | None = None
    person_id: int | None = None
    chips: list[str] = []
    due: date | None = None
    time: str | None = None
    source: Literal["staff", "agent"] = "staff"   # generator/call tasks come only from the service, never the API


class TaskPatch(BaseModel):
    kind: Kind | None = None
    title: str | None = None
    why: str | None = None
    person_id: int | None = None
    chips: list[str] | None = None
    due: date | None = None
    time: str | None = None
    done: bool | None = None


def _call(fn, *args, **kwargs):
    try:
        return fn(*args, **kwargs)
    except tasks.NotFound as exc:
        raise HTTPException(404, str(exc))
    except tasks.UndoConflict as exc:
        raise HTTPException(409, str(exc))
    except (tasks.TaskError, ValueError) as exc:
        raise HTTPException(422, str(exc))


@router.get("/tasks")
def get_tasks(due: Literal["today"] | None = None, from_: date | None = Query(None, alias="from"),
              to: date | None = None, person_id: int | None = None,
              conn: sqlite3.Connection = Depends(get_conn)) -> list[dict]:
    return _call(tasks.list_tasks, conn, due=due, from_=from_.isoformat() if from_ else None,
                 to=to.isoformat() if to else None, person_id=person_id)


@router.post("/tasks/generate")
def generate_tasks(as_of: date | None = None, conn: sqlite3.Connection = Depends(get_conn)) -> dict:
    return _call(tasks.generate, conn, as_of)


@router.post("/tasks")
def post_task(body: TaskIn, conn: sqlite3.Connection = Depends(get_conn)) -> dict:
    fields = body.model_dump()
    fields["due"] = fields["due"].isoformat() if fields["due"] else None
    source = fields.pop("source")
    task, token = _call(tasks.create_task, conn, actor=source, **fields)
    return {**task, "undo_token": token}


@router.patch("/tasks/{task_id}")
def patch_task(task_id: int, body: TaskPatch, conn: sqlite3.Connection = Depends(get_conn)) -> dict:
    fields = body.model_dump(exclude_unset=True)
    if fields.get("due") is not None:
        fields["due"] = fields["due"].isoformat()
    task, token = _call(tasks.update_task, conn, task_id, **fields)
    return {**task, "undo_token": token}


@router.delete("/tasks/{task_id}")
def remove_task(task_id: int, conn: sqlite3.Connection = Depends(get_conn)) -> dict:
    _, token = _call(tasks.delete_task, conn, task_id)
    return {"deleted": True, "undo_token": token}


@router.get("/calendar")
def get_calendar(from_: date | None = Query(None, alias="from"), to: date | None = None,
                 conn: sqlite3.Connection = Depends(get_conn)) -> list[dict]:
    return _call(tasks.calendar, conn, from_.isoformat() if from_ else None, to.isoformat() if to else None)


@router.get("/artifacts")
def get_artifacts(limit: int = Query(50, ge=1, le=500), conn: sqlite3.Connection = Depends(get_conn)) -> list[dict]:
    return tasks.artifacts(conn, limit)


@router.post("/undo/{token}")
def post_undo(token: str, conn: sqlite3.Connection = Depends(get_conn)) -> dict:
    """One undo for every agent write: "int_…" tokens belong to interests (42), the rest to tasks."""
    if token.startswith("int_"):
        try:
            from service import interests
        except ImportError:
            raise HTTPException(404, "interest undo isn't available yet")
        try:
            return interests.undo(conn, token)
        except (ValueError, KeyError) as exc:   # a malformed token (bad base64 / JSON) is a ValueError
            raise HTTPException(422, f"bad interest undo token: {exc}")
    return _call(tasks.undo, conn, token)
