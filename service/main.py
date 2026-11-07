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
POST /agent/ping             one tiny Agents SDK call with structured output (proves key + SDK)
     (ingest routes)         service/ingest/router.py, mounted when Carlos's lane is present
"""
from service import config  # noqa: F401  (loads .env and pins SCORE_AS_OF before the lanes import)

import asyncio
import importlib.util
import json
import logging
import sqlite3
import uuid
from datetime import datetime, timezone
from urllib.parse import urlparse

import openai
from fastapi import FastAPI, HTTPException
from fastapi.concurrency import run_in_threadpool
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel

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

def ingest_present() -> bool:
    try:
        return importlib.util.find_spec("service.ingest.router") is not None
    except ModuleNotFoundError:  # no service/ingest package yet
        return False


# Carlos owns ingest; mount it only once his router exists
if ingest_present():
    from service.ingest.router import router as ingest_router
    app.include_router(ingest_router)
    INGEST_MOUNTED = True
else:
    INGEST_MOUNTED = False
    log.warning("service/ingest/router.py not found; /ingest is not mounted")


@app.get("/health")
def health() -> dict:
    return {"ok": True, "model": config.MODEL_DEFAULT, "openai_key": config.HAS_OPENAI_KEY,
            "score_as_of": config.SCORE_AS_OF, "db": str(db.db_path()), "ingest": INGEST_MOUNTED}


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


def cached_context(website: str | None) -> dict | None:
    """The saved context ({profile, facts} from the db), else the committed service/context_cache.json."""
    from service import routes_data

    if hasattr(routes_data, "get_org_profile_or_none"):
        conn = db.connect()
        try:
            db.create_schema(conn)
            profile = routes_data.get_org_profile_or_none(conn)
            if profile is not None:
                return {"profile": profile, "facts": routes_data.list_context(conn)}
        except sqlite3.OperationalError:
            pass
        finally:
            conn.close()

    # the cache file is keyed by the normalized website host
    path = config.REPO_ROOT / "service" / "context_cache.json"
    if not path.exists():
        return None
    cache = json.loads(path.read_text(encoding="utf-8"))
    host = urlparse(website if "//" in (website or "") else f"//{website or ''}").hostname or ""
    host = host.removeprefix("www.")
    return cache.get(host) or (next(iter(cache.values())) if len(cache) == 1 else None)


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


def source_progress(req: "ContextRun", result: dict | None) -> dict:
    """{website|news|x|linkedin|instagram: {status, facts, detail}} for the screen's per-source rows.

    Website only (Sharif's scope cut): social URLs are stored in org_profile, never fetched.
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
        out[source] = {"status": shown, "facts": counts.get(source, 0),
                       "detail": status if shown in ("failed", "blocked") or status == "cached" else None}
    for field, source in SOCIAL.items():
        given = getattr(req, field)
        out[source] = {"status": "saved, not connected" if given else "not provided", "facts": 0,
                       "detail": given}
    return out


def with_user_urls(result: dict | None, urls: dict) -> dict | None:
    """What the user typed is always what's saved; a cached run supplies facts, never the org's URLs."""
    if not result or not isinstance(result.get("profile"), dict):
        return result
    return {**result, "profile": {**result["profile"], **urls}}


@app.post("/context/run")
async def context_run(req: ContextRun) -> dict:
    """Onboarding screen 2, synchronous: reads the website (≤ CONTEXT_DEADLINE_S), saves, returns per-source status.

    served_from: "live" (refresh read the site), "cache" (refresh false, by request), or "fallback"
    (the read timed out or failed: cached: true, still 200, so the screen moves on).
    """
    try:
        from service.org_context import build_context
    except ImportError:
        raise not_landed("service.org_context.build_context")

    started_at = datetime.now(timezone.utc).isoformat(timespec="seconds")
    urls = req.model_dump(exclude={"refresh"})
    try:
        result = await asyncio.wait_for(run_in_threadpool(build_context, urls, req.refresh),
                                        config.CONTEXT_DEADLINE_S)
        result = with_user_urls(result, urls)
        state, cached, detail = "done", False, None
        served_from = "live" if req.refresh else "cache"
        saved = await run_in_threadpool(persist_context, result)
    except Exception as e:  # timeout, model error, site error: fall back, never leave the screen hanging
        if isinstance(e, asyncio.TimeoutError):
            detail = f"website read took longer than {config.CONTEXT_DEADLINE_S:.0f} s"
        else:
            detail = f"{type(e).__name__}: {e}"
        log.warning("context run failed, serving cached context: %s", detail)
        result = with_user_urls(cached_context(req.website), urls)
        state, cached, served_from, saved = "failed", True, "fallback", None

    return {"state": state, "cached": cached, "served_from": served_from, "detail": detail,
            "started_at": started_at, "finished_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "sources": source_progress(req, result),
            "profile": (result or {}).get("profile"), "facts": (result or {}).get("facts", []),
            "saved": saved}


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
