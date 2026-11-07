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
    except KeyError as e:
        raise HTTPException(404, str(e))
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
    try:
        from service.outreach_agent import draft_for_prospect
    except ImportError:
        raise not_landed("service.outreach_agent.draft_for_prospect")

    try:
        draft, where_saved = await run_agent(
            "prospect_outreach", draft_for_prospect, prospect_id,
            fallback=lambda: {"prospect_id": prospect_id,
                              "cached_draft": newest_draft("prospect_id", prospect_id)})
    except KeyError as e:
        raise HTTPException(404, str(e))
    return {"prospect_id": prospect_id, "draft_id": draft_id_of(where_saved), "saved_to": where_saved,
            **draft.model_dump()}


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
