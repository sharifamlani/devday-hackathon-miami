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
POST /events/refresh         one refresh pass now (context, events, invites, tasks); GET /events/{id}/drafts
POST /context/refresh        "Refresh now": starts a background context + calendar pass (86's service.refresh) on
                             org_profile's URLs and returns {status: "refreshing"}; GET /context/refresh reports it;
                             the same pass runs daily at REFRESH_DAILY_AT (HH:MM) when set
     (campaign routes)       service/routes_campaigns.py: /campaigns, /outbox (the single send log)
     (call notes)            service/routes_calls.py: POST /calls/summarize, POST /calls, GET /calls
     (Donors tab CRM)        service/routes_crm.py: /crm/contact_notes, /crm/tasks, /crm/tags, /crm/contacts
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
from concurrent.futures import ThreadPoolExecutor
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
from service.public_mode import PublicModeMiddleware, enabled as public_mode_enabled
from service.routes_ask import router as ask_router
from service.routes_calls import router as calls_router
from service.routes_crm import router as crm_router
from service.routes_data import router as data_router
from service.routes_targets import router as targets_router

log = logging.getLogger("service")

app = FastAPI(title="Donor service", version="0.1.0")
app.add_middleware(PublicModeMiddleware)   # no-op unless PUBLIC_MODE=1; added first so CORS wraps its 429s
app.add_middleware(
    CORSMiddleware,
    allow_origins=config.CORS_ORIGINS,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(data_router)
app.include_router(targets_router)
from service.routes_home import router as home_router  # noqa: E402  (B13: home summary + attention list)
app.include_router(home_router)
from service.routes_campaigns import router as campaigns_router  # noqa: E402  (#38: simulated outbox only)
app.include_router(campaigns_router)
app.include_router(ask_router)  # POST /ask (issue #36)
from service.routes_tasks import router as tasks_router  # noqa: E402  (§21 B11/B12)
app.include_router(tasks_router)
app.include_router(importlib.import_module("service.routes_events").router)  # calendar v3: POST/PATCH/DELETE /events
app.include_router(calls_router)  # live transcript call notes: /calls, /calls/summarize
app.include_router(crm_router)  # the Donors tab's notes, tasks and tags: /crm/...
app.include_router(importlib.import_module("service.routes_interests").router)  # B1 interests; owns POST /enrich (dry_run)
from service.routes_voice import router as voice_router  # noqa: E402  (B3: /transcribe/live, /transcribe/file)
app.include_router(voice_router)

from service.routes_after_call import router as after_call_router  # noqa: E402  (§21 B6: /call-notes/{id}/actions, /apply)
app.include_router(after_call_router)
from service.routes_phone import router as phone_router  # noqa: E402  (§21 S1: call a donor from your own phone)
app.include_router(phone_router)

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


@app.get("/public-mode")
def public_mode_flag() -> dict:
    """The web app shows a 'public demo' banner when this is true (docs/public-tunnel.md)."""
    return {"enabled": public_mode_enabled()}


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
                            state=donor.get("state"), email=donor.get("email"),   # identity: city, state or email domain
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
    """Onboarding organization identity and online sources. Social URLs may be left out."""
    name: str | None = None
    website: str | None = None
    x_url: str | None = None
    linkedin_url: str | None = None
    instagram_url: str | None = None
    refresh: bool = False


SOCIAL = {"x_url": "x", "linkedin_url": "linkedin", "instagram_url": "instagram"}
# build_context's per-source status → what onboarding screen 2 shows
SOURCE_STATUS = {"ok": "done", "cached": "cached", "blocked": "blocked", "skipped": "not provided",
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
    database_context = None
    if hasattr(routes_data, "get_org_profile_or_none"):
        conn = db.connect()
        try:
            db.create_schema(conn)
            profile = routes_data.get_org_profile_or_none(conn)
            if profile is not None and host_of(profile.get("website")) == host:
                database_context = {"profile": profile, "facts": routes_data.list_context(conn)}
        except sqlite3.OperationalError:
            pass
        finally:
            conn.close()

    # the cache file is keyed by the normalized website host
    path = config.REPO_ROOT / "service" / "context_cache.json"
    file_context = json.loads(path.read_text(encoding="utf-8")).get(host) if path.exists() else None
    if not database_context:
        return file_context
    if not file_context:
        return database_context
    # Prefer the database profile and its newer facts; add only file-cache facts not already present.
    known = {(f.get("source"), f.get("url"), f.get("fact")) for f in database_context["facts"]}
    extras = []
    for fact in file_context.get("facts") or []:
        key = (fact.get("source"), fact.get("url"), fact.get("fact"))
        if key not in known:
            extras.append({**fact, "cached": True})
            known.add(key)
    return {**file_context, **database_context, "facts": [*database_context["facts"], *extras]}


def forget_other_org(conn: sqlite3.Connection, website: str | None) -> bool:
    """Setup rerun for a different organization (another site host): drop the previous org's facts
    (org_context, which is also the context store) and its name, priorities, voice and source status,
    so none of it shows under the new URL. Same host, or nothing saved yet: keep everything.
    Uncommitted; the save_context that follows commits it. True when something was cleared."""
    row = conn.execute("SELECT website FROM org_profile WHERE id = 1").fetchone()
    if not row or not row[0] or host_of(row[0]) == host_of(website):
        return False
    conn.execute("DELETE FROM org_context")
    reset = "name = NULL, priorities = '[]', voice = '{}', source_status = '{}'"
    if "last_refreshed_at" in {r[1] for r in conn.execute("PRAGMA table_info(org_profile)")}:
        reset += ", last_refreshed_at = NULL"
    conn.execute(f"UPDATE org_profile SET {reset} WHERE id = 1")
    forget_org_calendar(conn)
    return True


def forget_org_calendar(conn: sqlite3.Connection) -> None:
    """The previous org's calendar, on a setup rerun for another organization: every event came from its site
    and searches, so drop them with their audiences, unsent invite drafts, draft invite batches and the
    generator's open prep tasks, plus any invite work a slow run queued for them (PENDING_INVITES). Sent invites
    stay as donor history (unlinked from the event). Open prep tasks are retired through tasks.delete_task, so
    Undo still restores them; done ones stay. Every prep task's generator key is freed: event ids can be reused,
    and a kept key would stop the new org's prep task for that id. Retiring a task commits (delete_task);
    the rest is left for the caller's save, like forget_other_org."""
    with REFRESH_LOCK:
        PENDING_INVITES.clear()                       # never draft old-org invites onto new-org events
    tables = {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type = 'table'")}
    if "events" not in tables:
        return
    if {"event_drafts", "outreach_drafts"} <= tables:
        conn.execute("DELETE FROM outreach_drafts WHERE status != 'sent' "
                     "AND id IN (SELECT draft_id FROM event_drafts)")
    if "campaigns" in tables:
        drafts = "SELECT id FROM campaigns WHERE event_id IS NOT NULL AND status = 'draft'"
        if "campaign_messages" in tables:
            conn.execute(f"DELETE FROM campaign_messages WHERE campaign_id IN ({drafts})")
        conn.execute(f"DELETE FROM campaigns WHERE id IN ({drafts})")
        conn.execute("UPDATE campaigns SET event_id = NULL WHERE event_id IS NOT NULL")
    if "tasks" in tables:
        from service import tasks
        for (task_id,) in conn.execute("SELECT id FROM tasks WHERE gen_key LIKE 'prep:%' AND done = 0 "
                                       "AND deleted_at IS NULL").fetchall():
            tasks.delete_task(conn, task_id, actor="generator", _action="retire_old_org_prep",
                              _raw={"gen_key": None})
        conn.execute("UPDATE tasks SET gen_key = NULL WHERE gen_key LIKE 'prep:%'")
    for table in ("event_drafts", "event_audience"):
        if table in tables:
            conn.execute(f"DELETE FROM {table}")
    conn.execute("DELETE FROM events")


def persist_context(result: dict) -> dict | None:
    """build_context is pure; db.save_context is the only writer of org_profile + org_context.

    Returns {"org_profile_id", "context_ids", "replaced_sources"}, or None until save_context lands.
    A run for another organization first forgets the previous one (forget_other_org).
    """
    if not hasattr(db, "save_context"):
        return None
    conn = db.connect()
    try:
        db.create_schema(conn)
        forget_other_org(conn, (result.get("profile") or {}).get("website"))
        savable_result = dict(result)
        statuses = dict(result.get("sources") or {})
        for source in ("website", "news"):
            if statuses.get(source) != "error: cached fallback retained":
                continue
            count = conn.execute("SELECT COUNT(*) FROM org_context WHERE source = ?", (source,)).fetchone()[0]
            if count == 0:
                statuses[source] = "cached"  # seed an empty source so the dashboard can show its saved fallback
        savable_result["sources"] = statuses
        saved = db.save_context(conn, savable_result)
        from service.org_context import after_context_saved; after_context_saved(conn)  # index the store, then tasks (86)
        for fact in savable_result.get("facts") or []:
            if fact.get("cached"):
                conn.execute(
                    "UPDATE org_context SET cached = 1 WHERE source = ? AND url = ? AND fact = ?",
                    (fact.get("source"), fact.get("url"), fact.get("fact")),
                )
        conn.commit()
        return saved
    finally:
        conn.close()


def persist_fallback_context(urls: dict, sources: dict, result: dict | None) -> dict:
    """Save same-host cached facts and the attempted source status for the dashboard handoff.

    Only sources labeled cached are replaced with their saved facts. Sources without fallback data
    retain prior rows. The organization name and URLs come from this request, never the cached profile.
    """
    conn = db.connect()
    try:
        db.create_schema(conn)
        cleared = forget_other_org(conn, urls.get("website"))
        profile = {**((result or {}).get("profile") or {}), **urls}
        source_status = {
            source: "cached" if details["status"] == "cached"
            else f"error: {details.get('detail') or details['status']}"
            for source, details in sources.items()
            if source in ("website", "news")
        }
        cached_sources = {source for source, status in source_status.items() if status == "cached"}
        facts = [fact for fact in (result or {}).get("facts", []) if fact.get("source") in cached_sources]
        saved = db.save_context(conn, {"profile": profile, "sources": source_status, "facts": facts})
        from service.org_context import index_context
        index_context(conn)
        if saved.get("context_ids"):
            marks = ",".join("?" for _ in saved["context_ids"])
            conn.execute(f"UPDATE org_context SET cached = 1 WHERE id IN ({marks})", saved["context_ids"])
            conn.commit()
        return {**saved, "cached_fallback": True, "cleared_previous_org": cleared}
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
        shown = SOURCE_STATUS.get(status, "cached" if status.startswith("cached") else
                                  "failed" if status.startswith("error") else status)
        detail = status if shown in ("failed", "blocked", "cached") else None
        if shown == "done" and not counts.get(source):  # "ok" with nothing found is not a success
            shown, detail = "failed", "error: no facts found"
        elif fallback and not counts.get(source):
            shown, detail = "failed", "live read failed; no saved context for this source"
        elif fallback and shown in ("done", "cached") and counts.get(source):
            shown, detail = "cached", "live read failed; showing saved context"
        elif shown == "cached" and not counts.get(source):
            shown, detail = "failed", "saved source has no facts"
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
    ok = sum(status == "done" or status == "cached" for status in read)
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
        if row["status"] not in ("done", "cached"):
            why = row["detail"] or row["status"]
            statuses[source] = why if why.startswith("error") else f"error: {why}"
        elif row["status"] == "cached":
            # Keep old facts visible in this response without replacing the saved source.
            statuses[source] = "error: cached fallback retained"
    return {**result, "sources": statuses}


def add_cached_partial_sources(result: dict, website: str | None) -> dict:
    """Fill failed/empty live sources from this same site's saved context for the response only.

    The caller marks these sources cached; savable() then prevents the old facts from replacing
    the source in storage. A successful live source always wins over its cached counterpart.
    """
    saved = cached_context(website)
    if not saved:
        return result
    facts = list(result.get("facts") or [])
    live_sources = dict(result.get("sources") or {})
    for source in ("website", "news"):
        present = [fact for fact in facts if fact.get("source") == source]
        status = str(live_sources.get(source, ""))
        if present and status in ("ok", "cached"):
            continue
        saved_facts = [fact for fact in saved.get("facts") or [] if fact.get("source") == source]
        if not saved_facts:
            continue
        known = {(fact.get("source"), fact.get("url"), fact.get("fact")) for fact in facts}
        facts.extend(
            {**fact, "cached": True}
            for fact in saved_facts
            if (fact.get("source"), fact.get("url"), fact.get("fact")) not in known
        )
        live_sources[source] = "cached (partial; live source unavailable)"
    return {**result, "facts": facts, "sources": live_sources}


def failure_detail(website: str | None, sources: dict) -> str:
    """One plain sentence for a failed read: which site, and what each source reported."""
    why = "; ".join(f"{s}: {(sources.get(s) or {}).get('detail') or (sources.get(s) or {}).get('status')}"
                    for s in ("website", "news") if (sources.get(s) or {}).get("status") != "done")
    return f"We couldn't read {website}" + (f" ({why})" if why else "") + ". Nothing was saved."


def with_user_urls(result: dict | None, urls: dict) -> dict | None:
    """What the user typed is always what's saved; a cached run supplies facts, never the org's URLs."""
    if not result or not isinstance(result.get("profile"), dict):
        return result
    return {**result, "profile": {**result["profile"], **urls}}


# A first-run website read that ran past CONTEXT_DEADLINE_S keeps going in its own thread. The background refresh
# the web starts next (POST /context/refresh) waits for that read instead of reading the site a second time.
# Room for several slow reads: a read can't be stopped once started, and a new run must never queue behind them.
READ_POOL = ThreadPoolExecutor(max_workers=8, thread_name_prefix="context-read")
SLOW_READ: dict = {}            # {"host", "urls", "future"} of the latest timed-out read, until a refresh takes it
SLOW_READ_LOCK = threading.Lock()


def take_slow_read(urls: dict):
    """A build(urls, refresh) for refresh() that returns the timed-out onboarding read of this same site, or None
    (no such read, or another site). If that read failed or is still running after AGENT_DEADLINE_S, it reads
    the site fresh, as the refresh would have without it."""
    with SLOW_READ_LOCK:
        held = dict(SLOW_READ)
        SLOW_READ.clear()
    if not held or held["host"] != host_of(urls.get("website")) or held["future"].cancelled():
        return None
    future, typed = held["future"], held["urls"]

    def build(read_urls: dict, refresh: bool = True) -> dict:
        try:
            result = future.result(timeout=config.AGENT_DEADLINE_S)
            log.info("background refresh reused the onboarding read of %s", held["host"])
            return with_user_urls(result, typed) or result
        except Exception as e:      # that read failed or never finished: read the site now
            log.warning("onboarding read unusable (%s); reading again", type(e).__name__)
            from service.org_context import build_context
            return build_context(read_urls, refresh=refresh)

    return build


@app.post("/context/run")
async def context_run(req: ContextRun) -> dict:
    """Onboarding screen 2, synchronous: reads the website (≤ CONTEXT_DEADLINE_S), saves, returns per-source status.

    served_from: "live" (always: the site is read on every run; `refresh` is accepted and ignored) or
    "fallback" (the read timed out or failed: cached: true, every fact flagged cached, still 200, so the
    screen moves on). Same-host saved facts and the typed organization identity/URLs are persisted for the
    dashboard; a background refresh can continue reading. No website: state "failed", detail
    "no website provided", served_from null, empty context, nothing saved.
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
    with SLOW_READ_LOCK:
        SLOW_READ.clear()                            # a new run supersedes an older slow read
    events_job = start_events_search(req.website)    # in parallel with the website read: same wait, not double
    read = READ_POOL.submit(build_context, urls, True)
    waiting = asyncio.wrap_future(read)
    waiting.add_done_callback(lambda f: f.cancelled() or f.exception())   # read later, or never: no warning
    try:
        # shield: a timeout stops the wait, not the read, so a background refresh can still use it
        result = await asyncio.wait_for(asyncio.shield(waiting), config.CONTEXT_DEADLINE_S)
        result = with_user_urls(result, urls)
        state, cached, detail = "done", False, None
        served_from = "live"
    except Exception as e:  # timeout, model error, site error: fall back, never leave the screen hanging
        keep_urls = not isinstance(e, ValueError)   # a timeout or model error, not a missing/invalid website
        if isinstance(e, asyncio.TimeoutError):
            detail = f"website read took longer than {config.CONTEXT_DEADLINE_S:.0f} s"
            with SLOW_READ_LOCK:
                SLOW_READ.update(host=host_of(req.website), urls=urls, future=read)
        else:
            detail = f"{type(e).__name__}: {e}"
        log.warning("context run failed, serving cached context: %s", detail)
        result = with_user_urls(cached_context(req.website), urls)
        if result:                                      # label every fact so the UI can say "cached"
            result = {**result, "facts": [{**f, "cached": True} for f in result.get("facts") or []]}
        state, cached, served_from = "failed", bool(result and result.get("facts")), "fallback"

    if served_from != "fallback" and result:
        result = add_cached_partial_sources(result, req.website)
    sources = source_progress(req, result, fallback=served_from == "fallback")
    saved, calendar = None, None
    if served_from != "fallback":
        state = run_state(sources)
        if state == "failed" and not detail:            # say why at the top, not only per source
            detail = failure_detail(req.website, sources)
        # A failed run saves nothing: a typo'd URL must not wipe the saved profile or facts
        if state != "failed":
            saved = await run_in_threadpool(persist_context, savable(result, sources))
            # the first calendar: events + prep tasks before this returns, invites in the background
            calendar = await onboarding_calendar(events_job) if saved is not None else None
    elif keep_urls:
        # The site is still worth reading: keep what the user typed (never their facts) so
        # POST /context/refresh can finish the job in the background on these URLs.
        saved = await run_in_threadpool(persist_fallback_context, urls, sources, result)
        # The events search started with the read and is usually nearly done: give it a short grace so the
        # dashboard lands with events and prep tasks. Invites wait for that background refresh (step 3), so
        # this job never holds the refresh slot the web is about to ask for.
        calendar = await onboarding_calendar(events_job, wait_s=config.ONBOARDING_EVENTS_GRACE_S, invites=False)
    return {"state": state, "cached": cached, "served_from": served_from, "detail": detail,
            "started_at": started_at, "finished_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "sources": sources,
            "profile": (result or {}).get("profile"), "facts": (result or {}).get("facts", []),
            "saved": saved, "calendar": calendar}


def start_events_search(website: str | None):
    """The events agent's read of the org's site, started next to build_context (None if it hasn't landed,
    or ONBOARDING_EVENTS=off, which the tests set)."""
    if not website or os.getenv("ONBOARDING_EVENTS", "on").lower() == "off" or not module_present("service.events_agent"):
        return None
    return asyncio.ensure_future(run_in_threadpool(find_onboarding_events, website))


ONBOARDING_SEARCHES = 3


def find_onboarding_events(website: str) -> list[dict]:
    """The events agent's search, run ONBOARDING_SEARCHES times in parallel and merged: one hosted search
    sometimes misses an event (a live run once found 3 of the 4). Events found before for this site go in as
    hints only; every event still has to pass the search-returned URL and page check. Duplicates are merged
    with the refresh's own same-event rule (same date, overlapping title)."""
    from concurrent.futures import ThreadPoolExecutor

    from service import events_agent as ea
    from service.refresh import same_event

    host = ea.site_host(website)
    known = [e for path in (ea.EVENTS_LIVE, ea.EVENTS_CACHE) for e in ea.read_runs(path).get(host, [])]
    hints = [{"fact": f"{e['title']} on {e['starts_at'][:10]}" + (f" at {e['place']}" if e.get("place") else ""),
              "posted_at": None} for e in known]
    with ThreadPoolExecutor(max_workers=ONBOARDING_SEARCHES) as pool:
        runs = list(pool.map(lambda _: _safe_extract(ea, hints, website), range(ONBOARDING_SEARCHES)))
    merged: list[dict] = []
    for run in runs:
        for e in run:
            if not any(same_event(e, m) for m in merged):
                merged.append(e)
    return sorted(merged, key=lambda e: e["starts_at"])


def _safe_extract(ea, hints: list[dict], website: str) -> list[dict]:
    try:
        return ea.extract_events(hints, True, website)
    except Exception as e:  # one search failing must not sink the other
        log.warning("onboarding events search failed: %s", e)
        return []


async def onboarding_calendar(events_job, wait_s: float | None = None, invites: bool = True) -> dict | None:
    """The first run's calendar, so the dashboard isn't empty after onboarding: save the events the search
    found and generate tasks (prep tasks for events within 14 days) before step 3 answers; then draft every
    event's invites in the background (GET /context/refresh shows that job). A search that failed or found
    nothing leaves the calendar as it was. invites=False (a slow read) leaves the invites to the background
    refresh the web starts next."""
    if events_job is None:
        return None
    try:
        events = await asyncio.wait_for(events_job, config.CONTEXT_DEADLINE_S if wait_s is None else wait_s)
    except Exception as e:  # timeout or search error: the daily refresh (or "Refresh now") will pick events up
        log.warning("onboarding events search failed: %s", e)
        return {"events": 0, "prep_tasks": 0, "invites": "not started", "detail": f"{type(e).__name__}: {e}"[:200]}
    if not events:
        return {"events": 0, "prep_tasks": 0, "invites": "not started", "detail": "no upcoming events found"}
    out, ids, stored = await run_in_threadpool(save_onboarding_calendar, events)
    if invites:
        out["invites"] = start_invites_job(events, ids, stored)["status"]
    else:   # the refresh only drafts for new/changed events, and these are now saved: hand them to its next pass
        with REFRESH_LOCK:
            PENDING_INVITES[:] = [(events, ids, stored)]
        out["invites"] = "with the background read"
    return out


def save_onboarding_calendar(events: list[dict]) -> tuple[dict, dict, bool]:
    from service import tasks
    from service.refresh import save_found_events

    conn = db.connect()
    try:
        db.create_schema(conn)
        ids, stored = save_found_events(conn, events)
        tasks.generate_safely(conn, after="onboarding")
        prep = conn.execute("SELECT COUNT(*) FROM tasks WHERE kind = 'prep' AND done = 0 AND deleted_at IS NULL").fetchone()[0]
        n = sum(1 for i in ids.values() if i is not None) if stored else len(events)
        return {"events": n, "prep_tasks": prep, "detail": None}, ids, stored
    finally:
        conn.close()


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
    """{reply, tab, steps: [{tool, args, summary, status, undo_token}], run_id, approvals, pending_batch, batches}.

    Edits apply at once (each step carries an undo_token for POST /undo/{token}). Sends, merges and deletes pause
    the run: approvals lists them, and POST /chat/approve resumes it after a person decides.
    """
    from service.chat_agent import SCREEN_TAB, run_chat

    if not config.HAS_OPENAI_KEY:
        raise HTTPException(503, "OPENAI_API_KEY is not set in .env")
    screen = req.context or ChatScreen()
    tab = req.tab or SCREEN_TAB[screen.screen]
    selection = req.selection or ([screen.person_id] if screen.person_id is not None else [])
    return await capped("chat", config.CHAT_DEADLINE_S, run_chat, req.message, tab, selection,
                        [t.model_dump() for t in req.history], screen.event_id)


@app.post("/chat/stream")
async def chat_stream(req: ChatRequest):
    """POST /chat, streamed to assistant-ui (assistant-stream data stream): text deltas, one tool-call part per
    step (result has summary + undo_token), and a data chunk {type: "approvals", run_id, approvals} when the
    run pauses for approval (resume with POST /chat/approve)."""
    from service.chat_agent import SCREEN_TAB
    from service.chat_stream import stream_chat

    if not config.HAS_OPENAI_KEY:
        raise HTTPException(503, "OPENAI_API_KEY is not set in .env")
    screen = req.context or ChatScreen()
    tab = req.tab or SCREEN_TAB[screen.screen]
    selection = req.selection or ([screen.person_id] if screen.person_id is not None else [])
    return stream_chat(req.message, tab, selection, [t.model_dump() for t in req.history], screen.event_id)


class ApprovalDecision(BaseModel):
    call_id: str
    approve: bool


class ApproveRequest(BaseModel):
    run_id: str
    approved_by: str = Field(min_length=1, max_length=120)
    approvals: list[ApprovalDecision] = Field(default_factory=list,
                                              description="The calls decided now; any left out stays pending (the response "
                                                          "pauses on it again under a new run_id)")


@app.post("/chat/approve")
async def chat_approve(req: ApproveRequest) -> dict:
    """Resume a run paused on approval cards. Same response shape as POST /chat."""
    from service.chat_agent import resume_chat

    if not req.approved_by.strip():
        raise HTTPException(422, "approved_by must name a person")
    try:
        return await capped("chat", config.CHAT_DEADLINE_S, resume_chat, req.run_id,
                            {d.call_id: d.approve for d in req.approvals}, req.approved_by.strip())
    except KeyError as e:
        raise HTTPException(404, str(e))


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
    from service import tasks
    from service.refresh import refresh

    conn = db.connect()
    try:
        db.create_schema(conn)
        urls = org_urls(conn)
        if urls is None:
            return {"state": "failed", "detail": "no website saved yet: run onboarding first", "changes": None}
        build = take_slow_read(urls)                 # a timed-out onboarding read of this site: reuse it
        changes = refresh(conn, urls, build=build) if build else refresh(conn, urls)
        try:   # §21 B11: new events -> prep tasks; never fails a refresh already saved
            tasks.generate(conn)
        except Exception:
            conn.rollback()
            log.exception("task generator failed after refresh")
        failed = (changes.get("invites") or {}).get("failed")   # never "done" with 0 of N invites
        return {"state": "failed" if failed else "done", "detail": failed, "changes": changes}
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


def start_invites_job(events: list[dict], ids: dict, stored: bool) -> dict:
    """Draft invites for the onboarding events in the background; GET /context/refresh reports it. If a refresh
    is already running, the invites wait for it and start right after (never dropped)."""
    with REFRESH_LOCK:
        if REFRESH_JOB["status"] == "refreshing":
            threading.Thread(target=invites_after_running_job, args=(events, ids, stored), daemon=True,
                             name="onboarding-invites-queued").start()
            return dict(REFRESH_JOB) | {"queued": "invites start when this job finishes"}
        REFRESH_JOB.update(status="refreshing", started_at=datetime.now(timezone.utc).isoformat(timespec="seconds"),
                           finished_at=None, detail="drafting event invites", changes=None)
        started = dict(REFRESH_JOB)
    threading.Thread(target=invites_job, args=(events, ids, stored), daemon=True, name="onboarding-invites").start()
    return started


def invites_after_running_job(events: list[dict], ids: dict, stored: bool, poll_s: float = 1.0) -> None:
    deadline = time.monotonic() + 2 * config.REFRESH_DEADLINE_S
    while time.monotonic() < deadline:
        with REFRESH_LOCK:
            busy = REFRESH_JOB["status"] == "refreshing"
        if not busy:
            start_invites_job(events, ids, stored)
            return
        time.sleep(poll_s)
    log.warning("onboarding invites gave up waiting for the running refresh")


def invites_job(events: list[dict], ids: dict, stored: bool) -> None:
    from service.refresh import draft_invites_for, invites_failed
    conn = db.connect()
    try:
        out = draft_invites_for(conn, events, ids, stored, per_event=config.SETUP_DRAFTS_PER_EVENT)
        detail = invites_failed(out)                         # never "done" with 0 of N invites
        status = "failed" if detail else "done"
        changes = {"drafts": out["drafts"], "attempted": out.get("attempted"), "drafted": out.get("drafted"),
                   "errors": out["errors"][:10], "stats": out.get("stats")}
    except Exception as e:
        log.warning("onboarding invites failed: %s", e)
        status, detail, changes = "failed", f"{type(e).__name__}: {e}", None
    finally:
        conn.close()
    with REFRESH_LOCK:
        REFRESH_JOB.update(status=status, detail=detail, changes=changes,
                           finished_at=datetime.now(timezone.utc).isoformat(timespec="seconds"))


# Onboarding events saved after a slow read, whose invites the next refresh pass drafts (it skips known events).
PENDING_INVITES: list[tuple[list[dict], dict, bool]] = []


def pending_invites(changes: dict | None) -> tuple[dict | None, str | None]:
    """Draft the invites a slow onboarding left for this pass: (changes with "onboarding_invites", error or None)."""
    with REFRESH_LOCK:
        pending, PENDING_INVITES[:] = PENDING_INVITES[:], []
    if not pending:
        return changes, None
    from service.refresh import draft_invites_for, invites_failed
    events, ids, stored = pending[0]
    conn = db.connect()
    try:
        out = draft_invites_for(conn, events, ids, stored, per_event=config.SETUP_DRAFTS_PER_EVENT)
        summary = {"drafts": out["drafts"], "attempted": out.get("attempted"), "drafted": out.get("drafted"),
                   "errors": out["errors"][:10], "stats": out.get("stats")}
        failed = invites_failed(out)                         # 0 of N handed-over invites is a failure, not done
        return {**(changes or {}), "onboarding_invites": summary}, (f"onboarding invites: {failed}" if failed else None)
    except Exception as e:
        log.warning("onboarding invites (after the refresh) failed: %s", e)
        return changes, f"onboarding invites: {type(e).__name__}: {e}"
    finally:
        conn.close()


def refresh_job() -> None:
    try:
        result = run_refresh()
        status, detail, changes = result["state"], result["detail"], result["changes"]
    except Exception as e:  # a site or model error: report it, keep the saved context and calendar
        log.warning("context refresh failed: %s", e)
        status, detail, changes = "failed", f"{type(e).__name__}: {e}", None
    changes, invites_error = pending_invites(changes)     # still "refreshing" until these are drafted too
    if invites_error and status != "failed":
        status, detail = "failed", invites_error
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
def migrate_schema() -> None:
    """Create/upgrade donors.db once, before the first request: parallel first page loads then find the schema
    current (create_schema is also locked and idempotent, and a migrated db file is not migrated again)."""
    conn = db.connect()
    try:
        db.create_schema(conn)
    finally:
        conn.close()


@app.on_event("startup")
def migrate_crm_tasks() -> None:
    """One task store: copy any Donors-tab tasks saved in crm_tasks into tasks (idempotent; routes_crm also does it)."""
    from service import tasks

    conn = db.connect()
    try:
        db.create_schema(conn)
        copied = tasks.migrate_crm_tasks(conn)
        if copied:
            log.info("moved %d Donors-tab tasks into the tasks table", copied)
    finally:
        conn.close()


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
    """One refresh pass now (context + events + invites for what's new or changed + tasks), waited for:
    {state, detail, changes}. "Refresh now" is the background version (POST /context/refresh)."""
    events_agent()                                   # 503 until the events agent has landed
    return await capped("events", config.REFRESH_DEADLINE_S, run_refresh)


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
# Registered last: routes are matched in registration order, so the real route (routes_data.router, gift
# alerts, mounted above) answers first as soon as it exists; the path check below only skips obvious duplicates.
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

