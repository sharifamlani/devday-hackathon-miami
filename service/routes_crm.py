"""The Donors tab's notes, tasks and tags (Atomic CRM's contact_notes, tasks and tags), saved in donors.db.
main.py mounts this router; db.py's crm_* functions do the writing.

Shaped for react-admin's dataProvider (web/src/components/atomic-crm/providers/local/crmPersistence.ts):

    GET    /crm/{resource}          ?contact_id=&sales_id=&ids=1,2&sort=&order=ASC|DESC&page=1&per_page=25
                                    → {"data": [...], "total": n}     getList, getManyReference, getMany
    GET    /crm/{resource}/{id}     → the record                      getOne
    POST   /crm/{resource}          → the saved record, with its id   create
    PATCH  /crm/{resource}/{id}     → the saved record                update (only the fields sent change)
    DELETE /crm/{resource}/{id}     → the record as it was            delete
        resource: contact_notes | tasks | tags.  GET /crm/tags?contact_id= lists that donor's tags.

    GET    /crm/contacts            → [{contact_id, tags: [tag ids], background, last_seen}]
    PATCH  /crm/contacts/{id}       {tags?, background?, last_seen?} → that donor's row

These are private staff notes: they are not part of GET /donors/{id}, so the Vercel snapshot
(export_snapshot.py) never carries them, and their text is never logged (ids and counts only).
"""

from __future__ import annotations

import logging
import re
import sqlite3
from datetime import datetime
from typing import Any, Literal

from fastapi import APIRouter, Body, Depends, HTTPException, Query
from pydantic import BaseModel, Field, ValidationError, field_validator

from service import db
from service.routes_data import get_conn

log = logging.getLogger("service.crm")
router = APIRouter(prefix="/crm", tags=["crm"])

Resource = Literal["contact_notes", "tasks", "tags"]
SalesId = int | str | None
MAX_PER_PAGE = 1000
# 512 KB of file as base64 in a data: URL, with room for the prefix
MAX_ATTACHMENT_SRC = 700_000
COLOR_RE = re.compile(r"^#[0-9a-fA-F]{3,8}$")


def iso(value: str | None) -> str | None:
    """Check an ISO date or timestamp and keep it exactly as sent (the browser sorts these as text)."""
    if value in (None, ""):
        return None
    datetime.fromisoformat(value)
    return value


def required_iso(value: str | None) -> str:
    out = iso(value)
    if out is None:
        raise ValueError("a date is required")
    return out


class Attachment(BaseModel):
    src: str = Field(max_length=MAX_ATTACHMENT_SRC)
    title: str = Field("Attachment", max_length=200)
    type: str | None = Field(None, max_length=120)

    @field_validator("src")
    @classmethod
    def durable_url(cls, v: str) -> str:
        # A blob: URL dies with the page; javascript: and friends are never stored.
        if not re.match(r"^(data:|https?://)", v):
            raise ValueError("attachment src must be a data: or https: URL")
        return v


class NoteIn(BaseModel):
    contact_id: int = Field(ge=1)
    text: str = Field("", max_length=20000)
    date: str
    status: str | None = Field(None, max_length=40)
    sales_id: SalesId = None
    attachments: list[Attachment] = Field(default_factory=list, max_length=10)

    @field_validator("date")
    @classmethod
    def _date(cls, v: str) -> str:
        return required_iso(v)


class NotePatch(BaseModel):
    contact_id: int | None = Field(None, ge=1)
    text: str | None = Field(None, max_length=20000)
    date: str | None = None
    status: str | None = Field(None, max_length=40)
    sales_id: SalesId = None
    attachments: list[Attachment] | None = Field(None, max_length=10)

    @field_validator("date")
    @classmethod
    def _date(cls, v: str | None) -> str | None:
        return iso(v)


class TaskIn(BaseModel):
    contact_id: int = Field(ge=1)
    type: str = Field("none", min_length=1, max_length=40)
    text: str = Field("", max_length=5000)
    due_date: str
    done_date: str | None = None
    sales_id: SalesId = None

    @field_validator("due_date")
    @classmethod
    def _due(cls, v: str) -> str:
        return required_iso(v)

    @field_validator("done_date")
    @classmethod
    def _done(cls, v: str | None) -> str | None:
        return iso(v)


class TaskPatch(BaseModel):
    contact_id: int | None = Field(None, ge=1)
    type: str | None = Field(None, min_length=1, max_length=40)
    text: str | None = Field(None, max_length=5000)
    due_date: str | None = None
    done_date: str | None = None
    sales_id: SalesId = None

    @field_validator("due_date", "done_date")
    @classmethod
    def _dates(cls, v: str | None) -> str | None:
        return iso(v)


class TagIn(BaseModel):
    name: str = Field(min_length=1, max_length=60)
    color: str = Field(pattern=COLOR_RE.pattern)

    @field_validator("name")
    @classmethod
    def trimmed(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("a tag needs a name")
        return v.strip()


class TagPatch(BaseModel):
    name: str | None = Field(None, min_length=1, max_length=60)
    color: str | None = Field(None, pattern=COLOR_RE.pattern)


class ContactPatch(BaseModel):
    tags: list[int] | None = Field(None, max_length=50)
    background: str | None = Field(None, max_length=20000)
    last_seen: str | None = None

    @field_validator("last_seen")
    @classmethod
    def _seen(cls, v: str | None) -> str | None:
        return iso(v)


CREATE_MODELS: dict[str, type[BaseModel]] = {"contact_notes": NoteIn, "tasks": TaskIn, "tags": TagIn}
PATCH_MODELS: dict[str, type[BaseModel]] = {"contact_notes": NotePatch, "tasks": TaskPatch, "tags": TagPatch}
# Columns that can't be cleared with an explicit null
REQUIRED = {"contact_notes": {"contact_id", "text", "date", "attachments"},
            "tasks": {"contact_id", "type", "text", "due_date"},
            "tags": {"name", "color"}}
SORTS = {"contact_notes": {"id", "date", "contact_id", "status", "created_at", "updated_at"},
         "tasks": {"id", "due_date", "done_date", "contact_id", "type", "created_at", "updated_at"},
         "tags": {"id", "name"}}
DEFAULT_SORT = {"contact_notes": ("date", "DESC"), "tasks": ("due_date", "ASC"), "tags": ("id", "ASC")}


def require_donor(conn: sqlite3.Connection, contact_id: int, status: int = 422) -> None:
    if conn.execute("SELECT 1 FROM donors WHERE id = ?", (contact_id,)).fetchone() is None:
        raise HTTPException(status, f"donor {contact_id} not found")


def require_tags(conn: sqlite3.Connection, tag_ids: list[int]) -> None:
    if not tag_ids:
        return
    have = {r[0] for r in conn.execute(
        f"SELECT id FROM crm_tags WHERE id IN ({', '.join('?' for _ in tag_ids)})", tag_ids)}
    missing = sorted(set(tag_ids) - have)
    if missing:
        raise HTTPException(422, f"tag {missing[0]} not found")


def parse_ids(raw: str | None) -> list[int] | None:
    if raw is None:
        return None
    try:
        return [int(p) for p in raw.split(",") if p.strip()]
    except ValueError:
        raise HTTPException(422, "ids must be a comma-separated list of numbers")


def validated(model: type[BaseModel], body: Any) -> BaseModel:
    try:
        return model.model_validate(body)
    except ValidationError as e:
        # Same shape as FastAPI's own 422, without echoing the input (it may be note text)
        raise HTTPException(422, [{k: err[k] for k in ("loc", "msg", "type") if k in err} for err in e.errors()])


# ----------------------------------------------------------------------------------------------
# What this tab adds to a donor (tags, background, last seen). Registered before /crm/{resource}.
# ----------------------------------------------------------------------------------------------

@router.get("/contacts")
def list_contacts(conn: sqlite3.Connection = Depends(get_conn)) -> list[dict]:
    return db.crm_contacts(conn)


@router.patch("/contacts/{contact_id}")
def patch_contact(contact_id: int, patch: ContactPatch, conn: sqlite3.Connection = Depends(get_conn)) -> dict:
    require_donor(conn, contact_id, status=404)
    sent = patch.model_dump(exclude_unset=True)
    if "tags" in sent:
        sent["tags"] = list(dict.fromkeys(sent["tags"] or []))
        require_tags(conn, sent["tags"])
    saved = db.crm_save_contact(conn, contact_id, **sent)
    log.info("crm: donor %s updated (%s)", contact_id, ", ".join(sorted(sent)) or "nothing")
    return saved


# ----------------------------------------------------------------------------------------------
# contact_notes, tasks, tags
# ----------------------------------------------------------------------------------------------

@router.get("/{resource}")
def list_records(resource: Resource, contact_id: int | None = Query(None),
                 sales_id: str | None = Query(None, max_length=64), ids: str | None = Query(None, max_length=4000),
                 sort: str | None = Query(None, max_length=40), order: Literal["ASC", "DESC", "asc", "desc"] | None = None,
                 page: int = Query(1, ge=1), per_page: int = Query(25, ge=1, le=MAX_PER_PAGE),
                 conn: sqlite3.Connection = Depends(get_conn)) -> dict:
    default_sort, default_order = DEFAULT_SORT[resource]
    field = sort or default_sort
    if field not in SORTS[resource]:
        raise HTTPException(422, f"can't sort {resource} by {field}")
    data, total = db.crm_list(conn, resource, contact_id=contact_id, sales_id=sales_id, ids=parse_ids(ids),
                              sort=field, order=(order or default_order).upper(), page=page, per_page=per_page)
    return {"data": data, "total": total}


@router.get("/{resource}/{record_id}")
def get_record(resource: Resource, record_id: int, conn: sqlite3.Connection = Depends(get_conn)) -> dict:
    found = db.crm_get(conn, resource, record_id)
    if found is None:
        raise HTTPException(404, f"{resource} {record_id} not found")
    return found


@router.post("/{resource}")
def create_record(resource: Resource, body: dict = Body(...), conn: sqlite3.Connection = Depends(get_conn)) -> dict:
    record = validated(CREATE_MODELS[resource], body).model_dump()
    if "contact_id" in record:
        require_donor(conn, record["contact_id"])
    saved = db.crm_create(conn, resource, record)
    log.info("crm: %s %s created%s", resource, saved["id"],
             f" for donor {record['contact_id']}" if "contact_id" in record else "")
    return saved


@router.patch("/{resource}/{record_id}")
def update_record(resource: Resource, record_id: int, body: dict = Body(...),
                  conn: sqlite3.Connection = Depends(get_conn)) -> dict:
    sent = validated(PATCH_MODELS[resource], body).model_dump(exclude_unset=True)
    cleared = sorted(k for k, v in sent.items() if v is None and k in REQUIRED[resource])
    if cleared:
        raise HTTPException(422, f"{cleared[0]} can't be empty")
    if sent.get("contact_id") is not None:
        require_donor(conn, sent["contact_id"])
    saved = db.crm_update(conn, resource, record_id, sent)
    if saved is None:
        raise HTTPException(404, f"{resource} {record_id} not found")
    log.info("crm: %s %s updated (%s)", resource, record_id, ", ".join(sorted(sent)) or "nothing")
    return saved


@router.delete("/{resource}/{record_id}")
def delete_record(resource: Resource, record_id: int, conn: sqlite3.Connection = Depends(get_conn)) -> dict:
    removed = db.crm_delete(conn, resource, record_id)
    if removed is None:
        raise HTTPException(404, f"{resource} {record_id} not found")
    log.info("crm: %s %s deleted", resource, record_id)
    return removed
