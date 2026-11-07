"""The donor service: one FastAPI app that mounts every lane's routes.

Run from the repo root:
    uvicorn service.main:app --port 8000

GET  /health                 ok, the model tier in use, whether the key is loaded
     (data routes)           see service/routes_data.py: /donors, /duplicates, /score/run, /drafts/{id}/approve
POST /enrich/{donor_id}      research agent: sourced public facts for an organization, saved to research_facts
POST /outreach/{donor_id}    outreach agent: email + call script, saved to outreach_drafts
POST /agent/ping             one tiny Agents SDK call with structured output (proves key + SDK)
     (ingest routes)         service/ingest/router.py, mounted when Carlos's lane is present
"""
from service import config  # noqa: F401  (loads .env and pins SCORE_AS_OF before the lanes import)

import asyncio
import importlib.util
import logging
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
    def __init__(self, what: str, donor_id: int | None, reason: str):
        self.what, self.donor_id, self.reason = what, donor_id, reason


@app.exception_handler(AgentTimeout)
def agent_timeout_response(request, exc: AgentTimeout) -> JSONResponse:
    log.warning("504 %s donor=%s: %s", exc.what, exc.donor_id, exc.reason)
    """504 with the newest saved draft (if any) so the UI can say 'took too long, showing cached draft'."""
    cached = None
    if exc.donor_id is not None and exc.what == "outreach":
        conn = db.connect()
        try:
            row = conn.execute("SELECT * FROM outreach_drafts WHERE donor_id = ? ORDER BY id DESC LIMIT 1",
                               (exc.donor_id,)).fetchone()
        finally:
            conn.close()
        cached = dict(row) if row else None
    return JSONResponse(status_code=504, content={
        "error": "agent_timeout", "what": exc.what, "donor_id": exc.donor_id,
        "detail": exc.reason,
        "cached_draft": cached})


def timeout_reason(what: str) -> str:
    return (f"{what}: the model did not answer within {config.OPENAI_TIMEOUT_S:g} s "
            f"(after {config.OPENAI_MAX_RETRIES} retries)")


async def run_agent(what: str, donor_id: int | None, fn, *args, **kwargs):
    """Run a blocking agent call off the event loop, capped at AGENT_DEADLINE_S."""
    try:
        return await asyncio.wait_for(run_in_threadpool(fn, *args, **kwargs), config.AGENT_DEADLINE_S)
    except asyncio.TimeoutError:
        raise AgentTimeout(what, donor_id, f"{what} took longer than {config.AGENT_DEADLINE_S:.0f} s")
    except openai.APITimeoutError:
        raise AgentTimeout(what, donor_id, timeout_reason(what))


@app.post("/enrich/{donor_id}")
async def enrich(donor_id: int, refresh: bool = False) -> dict:
    from service.enrich_agent import enrich_donor, save_facts

    donor = load_donor_row(donor_id)
    facts = await run_agent("enrich", donor_id, enrich_donor, donor["full_name"], donor.get("org_name"),
                            donor.get("city"), refresh=refresh, donor_type=donor.get("donor_type"))
    run_id = f"enrich-{uuid.uuid4().hex[:12]}"
    saved = await run_in_threadpool(save_facts, donor_id, facts, run_id)
    return {"donor_id": donor_id, "full_name": donor["full_name"], "agent_run_id": run_id, "saved": saved,
            "facts": [f.model_dump() for f in facts]}


@app.post("/outreach/{donor_id}")
async def outreach(donor_id: int) -> dict:
    from service.outreach_agent import draft_for_donor

    load_donor_row(donor_id)
    try:
        draft, where_saved = await run_agent("outreach", donor_id, draft_for_donor, donor_id)
    except KeyError as e:
        raise HTTPException(404, str(e))
    # save_draft reports "donors.db:outreach_drafts#<id>" when it wrote to the db
    draft_id = int(where_saved.rsplit("#", 1)[1]) if "#" in where_saved else None
    return {"donor_id": donor_id, "draft_id": draft_id, "saved_to": where_saved, **draft.model_dump()}


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
        raise AgentTimeout("ping", None, f"ping took longer than {config.AGENT_DEADLINE_S:.0f} s")
    except openai.APITimeoutError:
        raise AgentTimeout("ping", None, timeout_reason("ping"))
    return {"model": config.MODEL_FAST, **result.final_output.model_dump()}
