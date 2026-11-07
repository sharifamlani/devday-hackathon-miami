"""The donor service: one FastAPI app that mounts every lane's routes.

Run from the repo root:
    uvicorn service.main:app --port 8000

GET  /health                 ok, the model tier in use, whether the key is loaded
     (data routes)           see service/routes_data.py: /donors, /duplicates, /score/run, /drafts/{id}/approve
POST /enrich/{donor_id}      research agent: sourced public facts for an organization, saved to research_facts
POST /outreach/{donor_id}    outreach agent: email + call script, saved to outreach_drafts
POST /icp/run                ICP agent: ideal donor profile + matching org prospects (cached unless ?refresh=true)
POST /prospects/{id}/outreach  first-touch draft for a prospect organization, always status 'draft'
     (ICP read routes)       GET /icp, /prospects, /prospects/{id}, POST /prospects/{id}/dismiss: routes_data.py
POST /context/run            onboarding screen 2: context agent reads the website (social URLs saved, not fetched)
POST /chat                   chat agent (tab-aware tools); drafts land as a batch pending approval, never sent
POST /send/{batch_id}        a human approves a chat batch (orgs/star/big need per-item ids) and it goes out
                             through outbound.deliver: dry run unless EMAIL_SEND=on / SMS_PROVIDER is set
POST /events/{id}/plan       create or open an event's outreach batch (one campaign per event); 503 until 86 lands
POST /events/refresh, GET /events/{id}/drafts   events agent (86), 503 until it lands
POST /context/refresh        "Refresh now": starts a background context + calendar pass (86's service.refresh) on
                             org_profile's URLs and returns {status: "refreshing"}; GET /context/refresh reports it;
                             the same pass runs daily at REFRESH_DAILY_AT (HH:MM) when set
     (campaign routes)       service/routes_campaigns.py: /campaigns, /outbox (the single send log)
POST /agent/ping             one tiny Agents SDK call with structured output (proves key + SDK)
     (ingest routes)         service/ingest/router.py, mounted when Carlos's lane is present
"""
from service import config  # noqa: F401  (loads .env and pins SCORE_AS_OF before the lanes import)

import asyncio
import importlib.util
import json
import logging
import os
import sqlite3
import threading
import time
import uuid
from datetime import datetime, timedelta, timezone
from urllib.parse import urlparse

import openai
from fastapi import FastAPI, HTTPException
from fastapi.concurrency import run_in_threadpool
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from typing import Literal

from pydantic import BaseModel, Field

from service import db
from service.routes_data import router as data_router

log = logging.getLogger("service")

app = FastAPI(title="Donor service", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=config.CORS_ORIGINS,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(data_router)
from service.routes_campaigns import router as campaigns_router  # noqa: E402  (#38: simulated outbox only)
app.include_router(campaigns_router)

def module_present(name: str) -> bool:
    try:
        return importlib.util.find_spec(name) is not None
    except ModuleNotFoundError:  # parent package not there yet
        return False


def mount_optional(module: str) -> bool:
    """Mount module.router once that lane has landed; until then its routes simply don't exist."""
    if not module_present(module):
        log.warning("%s not found; its routes are not mounted", module)
        return False
    app.include_router(importlib.import_module(module).router)
    return True


# Ingest (Carlos's router, or the ingest adapter PR #51), gift alerts (PR #48)
INGEST_MOUNTED = mount_optional("service.ingest.router") or mount_optional("service.ingest_router")
ALERTS_MOUNTED = mount_optional("service.gift_alerts")


@app.get("/health")
def health() -> dict:
    return {"ok": True, "model": config.MODEL_DEFAULT, "openai_key": config.HAS_OPENAI_KEY,
            "score_as_of": config.SCORE_AS_OF, "db": str(db.db_path()), "ingest": INGEST_MOUNTED, "alerts": ALERTS_MOUNTED}


def load_donor_row(donor_id: int) -> dict:
    conn = db.connect()
    try:
        row = conn.execute("SELECT * FROM donors WHERE id = ?", (donor_id,)).fetchone()
    finally:
        conn.close()
    if row is None:
        raise HTTPException(404, f"donor {donor_id} not found")
    return dict(row)


class AgentTimeout(Exception):
    def __init__(self, what: str, reason: str, extra: dict):
        self.what, self.reason, self.extra = what, reason, extra


@app.exception_handler(AgentTimeout)
def agent_timeout_response(request, exc: AgentTimeout) -> JSONResponse:
    """504 plus cached data so the UI can say 'took too long, showing cached draft'."""
    log.warning("504 %s %s: %s", exc.what, exc.extra, exc.reason)
    return JSONResponse(status_code=504, content={"error": "agent_timeout", "what": exc.what,
                                                  "detail": exc.reason, **exc.extra})


def newest_draft(column: str, ref_id: int) -> dict | None:
    """Newest outreach_drafts row for a donor_id or prospect_id; None if none (or no such column yet)."""
    conn = db.connect()
    try:
        row = conn.execute(f"SELECT * FROM outreach_drafts WHERE {column} = ? ORDER BY id DESC LIMIT 1",
                           (ref_id,)).fetchone()
    except sqlite3.OperationalError:
        return None
    finally:
        conn.close()
    return dict(row) if row else None


def cached_icp() -> dict | None:
    """data/icp_cache.json has the same shape run_icp returns."""
    path = config.REPO_ROOT / "data" / "icp_cache.json"
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else None


def prospect_status(prospect_id: int) -> str | None:
    """'new' | 'drafted' | 'dismissed', or None when there is no such prospect."""
    conn = db.connect()
    try:
        db.create_schema(conn)
        row = conn.execute("SELECT status FROM prospects WHERE id = ?", (prospect_id,)).fetchone()
    finally:
        conn.close()
    return row["status"] if row else None


def draft_id_of(where_saved: str) -> int | None:
    # save_draft reports "donors.db:outreach_drafts#<id>" when it wrote to the db, a JSON path otherwise
    return int(where_saved.rsplit("#", 1)[1]) if "#" in where_saved else None


def not_landed(module: str) -> HTTPException:
    return HTTPException(503, f"{module} has not landed on this build yet")


def timeout_reason(what: str) -> str:
    return (f"{what}: the model did not answer within {config.OPENAI_TIMEOUT_S:g} s "
            f"(after {config.OPENAI_MAX_RETRIES} retries)")


async def run_agent(what: str, fn, *args, fallback=dict, **kwargs):
    """Run a blocking agent call off the event loop, capped at AGENT_DEADLINE_S.

    On timeout, fallback() supplies the ids + cached data that go into the 504 body.
    """
    try:
        return await asyncio.wait_for(run_in_threadpool(fn, *args, **kwargs), config.AGENT_DEADLINE_S)
    except asyncio.TimeoutError:
        raise AgentTimeout(what, f"{what} took longer than {config.AGENT_DEADLINE_S:.0f} s", fallback())
    except openai.APITimeoutError:
        raise AgentTimeout(what, timeout_reason(what), fallback())


@app.post("/enrich/{donor_id}")
async def enrich(donor_id: int, refresh: bool = False) -> dict:
    from service.enrich_agent import enrich_donor, save_facts

    donor = load_donor_row(donor_id)
    facts = await run_agent("enrich", enrich_donor, donor["full_name"], donor.get("org_name"), donor.get("city"),
                            refresh=refresh, donor_type=donor.get("donor_type"),
                            fallback=lambda: {"donor_id": donor_id})
    run_id = f"enrich-{uuid.uuid4().hex[:12]}"
    saved = await run_in_threadpool(save_facts, donor_id, facts, run_id)
    return {"donor_id": donor_id, "full_name": donor["full_name"], "agent_run_id": run_id, "saved": saved,
            "facts": [f.model_dump() for f in facts]}


@app.post("/outreach/{donor_id}")
async def outreach(donor_id: int) -> dict:
    from service.outreach_agent import draft_for_donor

    load_donor_row(donor_id)
    try:
        draft, where_saved = await run_agent(
            "outreach", draft_for_donor, donor_id,
            fallback=lambda: {"donor_id": donor_id, "cached_draft": newest_draft("donor_id", donor_id)})
    except KeyError:
        raise HTTPException(404, f"donor {donor_id} not found")
    return {"donor_id": donor_id, "draft_id": draft_id_of(where_saved), "saved_to": where_saved,
            **draft.model_dump()}


@app.post("/icp/run")
async def icp_run(refresh: bool = False) -> dict:
    try:
        from service.icp_agent import run_icp
    except ImportError:
        raise not_landed("service.icp_agent")

    result = await run_agent("icp", run_icp, refresh=refresh, fallback=lambda: {"cached_icp": cached_icp()})
    saved = await run_in_threadpool(persist_icp, result)
    return {**result, "saved": saved}


def persist_icp(result: dict) -> dict | None:
    """run_icp is pure; db.save_icp_run is the only writer of icp_profile + prospects.

    Returns {"icp_id", "prospect_ids"}, or None until save_icp_run lands on this build.
    """
    if not hasattr(db, "save_icp_run"):
        return None
    conn = db.connect()
    try:
        db.create_schema(conn)
        return db.save_icp_run(conn, result)
    finally:
        conn.close()


@app.post("/prospects/{prospect_id}/outreach")
async def prospect_outreach(prospect_id: int) -> dict:
    """409 for a dismissed prospect, 404 for an unknown one; otherwise a first-touch draft (status 'draft')."""
    try:
        from service.outreach_agent import draft_for_prospect
    except ImportError:
        raise not_landed("service.outreach_agent.draft_for_prospect")

    # Checked before the model call: a dismissed prospect never gets a draft
    status = prospect_status(prospect_id)
    if status is None:
        raise HTTPException(404, f"prospect {prospect_id} not found")
    if status == "dismissed":
        raise HTTPException(409, f"prospect {prospect_id} is dismissed")

    try:
        draft, where_saved = await run_agent(
            "prospect_outreach", draft_for_prospect, prospect_id,
            fallback=lambda: {"prospect_id": prospect_id,
                              "cached_draft": newest_draft("prospect_id", prospect_id)})
    except KeyError:
        raise HTTPException(404, f"prospect {prospect_id} not found")
    return {"prospect_id": prospect_id, "draft_id": draft_id_of(where_saved), "saved_to": where_saved,
            **draft.model_dump()}


class ContextRun(BaseModel):
    """Onboarding screen 2: where the organization is online. Any URL may be left out."""
    website: str | None = None
    x_url: str | None = None
    linkedin_url: str | None = None
    instagram_url: str | None = None
    refresh: bool = False


SOCIAL = {"x_url": "x", "linkedin_url": "linkedin", "instagram_url": "instagram"}
# build_context's per-source status → what onboarding screen 2 shows
SOURCE_STATUS = {"ok": "done", "cached": "done", "blocked": "blocked", "skipped": "not provided",
                 "not_provided": "not provided"}


def host_of(url: str | None) -> str:
    """'https://www.miamifoundation.org/' -> 'miamifoundation.org'; '' for no URL."""
    host = urlparse(url if "//" in (url or "") else f"//{url or ''}").hostname or ""
    return host.removeprefix("www.")


def cached_context(website: str | None) -> dict | None:
    """Saved context for THIS website only: the db's profile if its host matches, else the cache file's entry.

    Never another organization's context: no website, or no match, means None.
    """
    from service import routes_data

    host = host_of(website)
    if not host:
        return None
    if hasattr(routes_data, "get_org_profile_or_none"):
        conn = db.connect()
        try:
            db.create_schema(conn)
            profile = routes_data.get_org_profile_or_none(conn)
            if profile is not None and host_of(profile.get("website")) == host:
                return {"profile": profile, "facts": routes_data.list_context(conn)}
        except sqlite3.OperationalError:
            pass
        finally:
            conn.close()

    # the cache file is keyed by the normalized website host
    path = config.REPO_ROOT / "service" / "context_cache.json"
    if not path.exists():
        return None
    return json.loads(path.read_text(encoding="utf-8")).get(host)


def persist_context(result: dict) -> dict | None:
    """build_context is pure; db.save_context is the only writer of org_profile + org_context.

    Returns {"org_profile_id", "context_ids", "replaced_sources"}, or None until save_context lands.
    """
    if not hasattr(db, "save_context"):
        return None
    conn = db.connect()
    try:
        db.create_schema(conn)
        return db.save_context(conn, result)
    finally:
        conn.close()


def source_progress(req: "ContextRun", result: dict | None, fallback: bool = False, stored: bool = True) -> dict:
    """{website|news|x|linkedin|instagram: {status, facts, detail}} for the screen's per-source rows.

    Website only (Sharif's scope cut): social URLs are stored in org_profile, never fetched.
    fallback: rows came from saved context after the live read failed, so "done" reads "cached (fallback)".
    stored: False when nothing was saved, so social URLs are "not connected" rather than "saved, ...".
    """
    result = result or {}
    raw = result.get("sources") or {}
    counts: dict[str, int] = {}
    for f in result.get("facts") or []:
        counts[f.get("source")] = counts.get(f.get("source"), 0) + 1

    out = {}
    for source in ("website", "news"):
        if source == "website" and not req.website:
            out[source] = {"status": "not provided", "facts": 0, "detail": None}
            continue
        status = str(raw.get(source, "ok" if counts.get(source) else "skipped"))
        shown = SOURCE_STATUS.get(status, "failed" if status.startswith("error") else status)
        detail = status if shown in ("failed", "blocked") or status == "cached" else None
        if shown == "done" and not counts.get(source):  # "ok" with nothing found is not a success
            shown, detail = "failed", "error: no facts found"
        elif fallback and shown == "done":
            shown, detail = "cached (fallback)", "live read failed; showing saved context"
        elif fallback and source == "website" and not result:
            shown, detail = "failed", "live read failed; no saved context for this site"
        out[source] = {"status": shown, "facts": counts.get(source, 0), "detail": detail}
    for field, source in SOCIAL.items():
        given = getattr(req, field)
        connected = "saved, not connected" if stored else "not connected"
        out[source] = {"status": connected if given else "not provided", "facts": 0, "detail": given}
    return out


def run_state(sources: dict) -> str:
    """'done' if every source that was read succeeded, 'partial' if some failed, 'failed' if none succeeded.

    Only sources that were actually read count: "not provided" and "saved, not connected" are neither.
    """
    read = [s["status"] for s in sources.values() if s["status"] not in ("not provided", "saved, not connected")]
    ok = read.count("done")
    if not read or ok == len(read):
        return "done"
    return "partial" if ok else "failed"


def savable(result: dict, sources: dict) -> dict:
    """The result with the route's per-source verdicts, so save_context replaces only sources that succeeded.

    save_context replaces facts for sources marked ok/cached; a source build_context called "ok" but that found
    nothing (or failed) must keep its earlier facts, so it is marked as an error here.
    """
    statuses = dict(result.get("sources") or {})
    for source in ("website", "news"):
        row = sources[source]
        if row["status"] != "done":
            why = row["detail"] or row["status"]
            statuses[source] = why if why.startswith("error") else f"error: {why}"
    return {**result, "sources": statuses}


def with_user_urls(result: dict | None, urls: dict) -> dict | None:
    """What the user typed is always what's saved; a cached run supplies facts, never the org's URLs."""
    if not result or not isinstance(result.get("profile"), dict):
        return result
    return {**result, "profile": {**result["profile"], **urls}}


@app.post("/context/run")
async def context_run(req: ContextRun) -> dict:
    """Onboarding screen 2, synchronous: reads the website (≤ CONTEXT_DEADLINE_S), saves, returns per-source status.

    served_from: "live" (refresh read the site), "cache" (refresh false, by request), or "fallback"
    (the read timed out or failed: cached: true, still 200, so the screen moves on). No website: state
    "failed", detail "no website provided", served_from null, empty context, nothing saved.
    """
    try:
        from service.org_context import build_context
    except ImportError:
        raise not_landed("service.org_context.build_context")

    started_at = datetime.now(timezone.utc).isoformat(timespec="seconds")
    if not host_of(req.website):  # nothing to read, and never someone else's cached context
        return {"state": "failed", "cached": False, "served_from": None, "detail": "no website provided",
                "started_at": started_at, "finished_at": started_at,
                "sources": source_progress(req, None, stored=False),
                "profile": None, "facts": [], "saved": None}

    urls = req.model_dump(exclude={"refresh"})
    try:
        result = await asyncio.wait_for(run_in_threadpool(build_context, urls, req.refresh),
                                        config.CONTEXT_DEADLINE_S)
        result = with_user_urls(result, urls)
        state, cached, detail = "done", False, None
        served_from = "live" if req.refresh else "cache"
    except Exception as e:  # timeout, model error, site error: fall back, never leave the screen hanging
        if isinstance(e, asyncio.TimeoutError):
            detail = f"website read took longer than {config.CONTEXT_DEADLINE_S:.0f} s"
        else:
            detail = f"{type(e).__name__}: {e}"
        log.warning("context run failed, serving cached context: %s", detail)
        result = with_user_urls(cached_context(req.website), urls)
        state, cached, served_from = "failed", True, "fallback"

    sources = source_progress(req, result, fallback=served_from == "fallback")
    saved = None
    if served_from != "fallback":
        state = run_state(sources)
        # A failed run saves nothing: a typo'd URL must not wipe the saved profile or facts
        if state != "failed":
            saved = await run_in_threadpool(persist_context, savable(result, sources))
    return {"state": state, "cached": cached, "served_from": served_from, "detail": detail,
            "started_at": started_at, "finished_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "sources": sources,
            "profile": (result or {}).get("profile"), "facts": (result or {}).get("facts", []),
            "saved": saved}


class ChatTurn(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(max_length=8000)


class ChatScreen(BaseModel):
    screen: Literal["giver", "neighbor", "community", "calendar", "home"] = "giver"
    person_id: int | None = None
    event_id: int | None = None


class ChatRequest(BaseModel):
    """The UI's body ({message, history, context}); tab/selection are accepted too."""
    message: str = Field(min_length=1, max_length=2000)
    history: list[ChatTurn] = Field(default_factory=list, max_length=50)
    context: ChatScreen | None = None
    tab: Literal["givers", "neighbors", "community", "calendar", "home"] | None = None
    selection: list[int] = Field(default_factory=list, max_length=200)


async def capped(what: str, seconds: float, fn, *args, **kwargs):
    """A blocking agent call off the event loop with its own wall-clock cap (504 on timeout)."""
    try:
        return await asyncio.wait_for(run_in_threadpool(fn, *args, **kwargs), seconds)
    except asyncio.TimeoutError:
        raise AgentTimeout(what, f"{what} took longer than {seconds:.0f} s", {})
    except openai.APITimeoutError:
        raise AgentTimeout(what, timeout_reason(what), {})


@app.post("/chat")
async def chat(req: ChatRequest) -> dict:
    """{reply, tab, steps: [{tool, args, summary, status}], pending_batch: {id, title, items} | null}.

    The model can draft a batch; it cannot send. A human sends with POST /send.
    """
    from service.chat_agent import SCREEN_TAB, run_chat

    if not config.HAS_OPENAI_KEY:
        raise HTTPException(503, "OPENAI_API_KEY is not set in .env")
    screen = req.context or ChatScreen()
    tab = req.tab or SCREEN_TAB[screen.screen]
    selection = req.selection or ([screen.person_id] if screen.person_id is not None else [])
    return await capped("chat", config.CHAT_DEADLINE_S, run_chat, req.message, tab, selection,
                        [t.model_dump() for t in req.history], screen.event_id)


class SendChoice(BaseModel):
    id: int
    approve: bool


class SendRequest(BaseModel):
    """items null: send only items that need no individual approval and have no flags.
    Listed items: approve true sends that one (orgs / star / big donors go only this way); false skips it."""
    batch_id: int | None = None
    approved_by: str = Field(min_length=1, max_length=120, description="The staff member approving the batch")
    items: list[SendChoice] | None = None
    approve_message_ids: list[int] = Field(default_factory=list, description="Same as items with approve: true")


def send_batch(batch_id: int, req: SendRequest) -> dict:
    from service import routes_campaigns as rc

    who = req.approved_by.strip()
    if not who:
        raise HTTPException(422, "approved_by must name a person")
    choices = list(req.items or []) + [SendChoice(id=i, approve=True) for i in req.approve_message_ids]
    blocked, skipped = [], 0
    conn = db.connect()
    try:
        db.create_schema(conn)
        rc.campaign_detail(conn, batch_id)                        # 404 for an unknown batch
        if not choices:
            rc.approve_small(batch_id, who, conn)                 # only items that need no individual approval
        for c in choices:                                         # the user named each of these
            try:
                status = "approved" if c.approve else "skipped"
                rc.patch_message(batch_id, c.id, rc.PatchMessage(status=status, approved_by=who), conn)
                skipped += not c.approve
            except HTTPException as e:                            # flagged, already sent, not in this batch
                blocked.append({"id": c.id, "reason": e.detail})
        result = rc.send_campaign(batch_id, conn)
        outbox = rc.list_outbox(batch_id, None, conn)
    finally:
        conn.close()
    for m in result["campaign"]["messages"]:
        if m["status"] == "draft" and m["needs_individual_approval"]:
            blocked.append({"id": m["id"], "reason": f"needs individual approval ({m['approval_reason']})"})
        elif m["status"] == "draft" and m["flags"]:
            blocked.append({"id": m["id"], "reason": "flagged: " + "; ".join(m["flags"])})
    blocked += [{"id": f["message_id"], "reason": f["reason"]} for f in result["failed"] + result["no_address"]]
    blocked = list({b["id"]: b for b in reversed(blocked)}.values())[::-1]     # one entry per item, first reason
    return {"batch_id": batch_id, "approved_by": who, "sent": result["sent"], "skipped": skipped,
            "blocked": blocked, "simulated": result["simulated"], "outbox": outbox}


@app.post("/send")
async def send(req: SendRequest) -> dict:
    """The only way a chat batch is sent: a named human approves it here."""
    if req.batch_id is None:
        raise HTTPException(422, "batch_id is required")
    return await run_in_threadpool(send_batch, req.batch_id, req)


@app.post("/send/{batch_id}")
async def send_path(batch_id: int, req: SendRequest) -> dict:
    return await run_in_threadpool(send_batch, batch_id, req)


def org_urls(conn: sqlite3.Connection) -> dict | None:
    """The saved org's URLs (onboarding screen 2), or None before onboarding."""
    row = conn.execute("SELECT website, x_url, linkedin_url, instagram_url FROM org_profile "
                       "ORDER BY id DESC LIMIT 1").fetchone()
    return dict(row) if row and row["website"] else None


def run_refresh() -> dict:
    """One refresh pass on the saved org. 86's refresh never wipes good data on a failed source."""
    from service.refresh import refresh

    conn = db.connect()
    try:
        db.create_schema(conn)
        urls = org_urls(conn)
        if urls is None:
            return {"state": "failed", "detail": "no website saved yet: run onboarding first", "changes": None}
        return {"state": "done", "detail": None, "changes": refresh(conn, urls)}
    finally:
        conn.close()


@app.post("/context/refresh")
async def context_refresh() -> dict:
    """"Refresh now": starts one background pass and returns at once with status "refreshing".
    Poll GET /context/refresh (or 8b's GET /context/status). A second click while one runs returns that one."""
    if not module_present("service.refresh"):
        raise not_landed("service.refresh")
    return start_refresh_job()


@app.get("/context/refresh")
def context_refresh_status() -> dict:
    """{status: idle | refreshing | done | failed, started_at, finished_at, detail, changes}."""
    return refresh_job_state()


REFRESH_JOB = {"status": "idle", "started_at": None, "finished_at": None, "detail": None, "changes": None}
REFRESH_LOCK = threading.Lock()


def refresh_job_state() -> dict:
    with REFRESH_LOCK:
        state = dict(REFRESH_JOB)
    if state["status"] == "refreshing" and state["started_at"]:
        elapsed = (datetime.now(timezone.utc) - datetime.fromisoformat(state["started_at"])).total_seconds()
        if elapsed > config.REFRESH_DEADLINE_S:   # report it; the pass may still finish and save
            state["detail"] = f"still running after {config.REFRESH_DEADLINE_S:.0f} s"
    return state


def start_refresh_job() -> dict:
    with REFRESH_LOCK:
        if REFRESH_JOB["status"] == "refreshing":
            return dict(REFRESH_JOB)
        REFRESH_JOB.update(status="refreshing", started_at=datetime.now(timezone.utc).isoformat(timespec="seconds"),
                           finished_at=None, detail=None, changes=None)
        started = dict(REFRESH_JOB)
    threading.Thread(target=refresh_job, daemon=True, name="context-refresh").start()
    return started


def refresh_job() -> None:
    try:
        result = run_refresh()
        status, detail, changes = result["state"], result["detail"], result["changes"]
    except Exception as e:  # a site or model error: report it, keep the saved context and calendar
        log.warning("context refresh failed: %s", e)
        status, detail, changes = "failed", f"{type(e).__name__}: {e}", None
    with REFRESH_LOCK:
        REFRESH_JOB.update(status=status, detail=detail, changes=changes,
                           finished_at=datetime.now(timezone.utc).isoformat(timespec="seconds"))


def seconds_until(hh_mm: str, now: datetime | None = None) -> float:
    """Seconds from now until the next local HH:MM."""
    now = now or datetime.now()
    hour, minute = (int(x) for x in hh_mm.split(":"))
    target = now.replace(hour=hour, minute=minute, second=0, microsecond=0)
    if target <= now:
        target += timedelta(days=1)
    return (target - now).total_seconds()


def daily_refresh_loop(hh_mm: str) -> None:
    while True:
        time.sleep(seconds_until(hh_mm))
        log.info("daily refresh: %s", start_refresh_job()["status"])


@app.on_event("startup")
def start_daily_refresh() -> None:
    """In-process scheduler: off unless REFRESH_DAILY_AT is set, and never under pytest.
    For a laptop that isn't always serving, use Windows Task Scheduler instead (service/README.md)."""
    if not config.REFRESH_DAILY_AT or "PYTEST_CURRENT_TEST" in os.environ or not module_present("service.refresh"):
        return
    seconds_until(config.REFRESH_DAILY_AT)                     # fail fast on a malformed HH:MM
    threading.Thread(target=daily_refresh_loop, args=(config.REFRESH_DAILY_AT,), daemon=True,
                     name="daily-refresh").start()
    log.info("daily context refresh scheduled at %s", config.REFRESH_DAILY_AT)


def events_agent():
    try:
        from service import events_agent as ea
    except ImportError:
        raise not_landed("service.events_agent")
    return ea


@app.post("/events/refresh")
async def events_refresh() -> dict:
    ea = events_agent()
    if not hasattr(ea, "refresh_events"):
        raise not_landed("service.events_agent.refresh_events")
    return await capped("events", config.CHAT_DEADLINE_S, ea.refresh_events)


@app.post("/events/{event_id}/plan")
async def event_plan(event_id: int) -> dict:
    """The calendar's "Review": create (or open, if it exists) this event's pending outreach batch."""
    from service.chat_agent import pending_batch
    from service import routes_campaigns as rc

    if not module_present("service.events_agent"):
        raise not_landed("service.events_agent")
    from service.event_outreach import plan_event_outreach
    try:
        result = await capped("event plan", config.CHAT_DEADLINE_S, plan_event_outreach, event_id)
    except LookupError as e:
        raise HTTPException(404, str(e))
    event = result["events"][0]
    batch = None
    if event.get("batch_id") is not None:
        conn = db.connect()
        try:
            batch = pending_batch(rc.campaign_detail(conn, event["batch_id"]))
        finally:
            conn.close()
    return {**event, "givers_only": result["givers_only"], "pending_batch": batch}


@app.get("/events/{event_id}/drafts")
async def event_drafts(event_id: int) -> dict:
    ea = events_agent()
    if not hasattr(ea, "drafts_for_event"):
        raise not_landed("service.events_agent.drafts_for_event")
    return await capped("events", config.CHAT_DEADLINE_S, ea.drafts_for_event, event_id)


class Ping(BaseModel):
    ok: bool
    echo: str


@app.post("/agent/ping")
async def agent_ping(text: str = "hello") -> dict:
    from agents import Agent, Runner

    if not config.HAS_OPENAI_KEY:
        raise HTTPException(503, "OPENAI_API_KEY is not set in .env")
    agent = Agent(name="Ping", instructions="Set ok to true and echo the user's text back exactly.",
                  model=config.MODEL_FAST, output_type=Ping)
    try:
        result = await asyncio.wait_for(Runner.run(agent, text), config.AGENT_DEADLINE_S)
    except asyncio.TimeoutError:
        raise AgentTimeout("ping", f"ping took longer than {config.AGENT_DEADLINE_S:.0f} s", {})
    except openai.APITimeoutError:
        raise AgentTimeout("ping", timeout_reason("ping"), {})
    return {"model": config.MODEL_FAST, **result.final_output.model_dump()}


# ----------------------------------------------------------------------------------------------
# Stubs for routes the UI already calls (plan.md §17): a clear 503 until the owning lane lands.
# Registered last, so the real route (routes_data.router, gift alerts) wins as soon as it exists.
# ----------------------------------------------------------------------------------------------

STUBS = {"/people": "the people list", "/events": "the event calendar", "/community/stats": "community analysis",
         "/context/status": "the context refresh status", "/alerts": "gift alerts"}


def stub(feature: str):
    def handler():
        raise HTTPException(503, f"{feature} isn't available yet")
    return handler


for path, feature in STUBS.items():
    if not any(getattr(r, "path", None) == path for r in app.routes):
        app.add_api_route(path, stub(feature), methods=["GET"], include_in_schema=False)

