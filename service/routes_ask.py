"""POST /ask: Ask Donor Desk (issue #36). main.py mounts this router.

    POST /ask {"question": "...", "filter": {...}?, "intent": {...}?}

The model only interprets the question into an AskFilter (service/ask_agent.py); apply_filter runs it in
plain code. Order of answers: an edited `filter` in the body (no model) → this process's cache of earlier
model answers → the model (one traced Agents SDK run, capped at ASK_DEADLINE_S) → the keyword rules for
the example questions (no key, timeout or model error). Nothing here writes to the database.

Response:
    {"question", "interpretation", "understood": bool, "filter": AskFilter, "intent": {kind, channel_hint},
     "donor_ids": [...], "donors": [GET /donors rows + "ask": {period_total, period_gifts, last_gift_date}],
     "next_action": {"label", "intent", "donor_ids"}, "as_of",
     "served_from": "model" | "cache" | "rules" | "edited", "trace_id": str | null, "detail": str | null}
"""

from __future__ import annotations

import asyncio
import logging
import os
import re
from datetime import date

from fastapi import APIRouter
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel, Field

from service import config, score
from service.ask_agent import AskFilter, AskIntent, AskPlan, apply_filter, interpret, rules_plan
from service.db import connect, create_schema

log = logging.getLogger("service.ask")
router = APIRouter(tags=["ask"])

# A search box should answer fast; past this the rules answer instead
ASK_DEADLINE_S = float(os.getenv("ASK_DEADLINE_S", "20"))
NOT_UNDERSTOOD = ("I can only answer the example questions without the AI model. "
                  "Try one of them, or ask on the demo laptop with the model running.")
NEXT_ACTION = {"thank_you": "Draft thank-you notes", "re_engage": "Draft re-engagement notes",
               "check_in": "Draft check-in messages"}

# normalized question + as-of date → (plan, trace_id) from an earlier model run in this process
_model_cache: dict[tuple[str, str], tuple[AskPlan, str | None]] = {}


class AskRequest(BaseModel):
    question: str = Field(min_length=1, max_length=500)
    filter: AskFilter | None = Field(None, description="A chip-edited filter: applied as given, no model call")
    intent: AskIntent | None = Field(None, description="Kept with an edited filter")


def normalized(question: str) -> str:
    return re.sub(r"\s+", " ", question.strip().lower().replace("’", "'"))


def matching_rows(spec: AskFilter, as_of: date) -> list[dict]:
    conn = connect()
    try:
        create_schema(conn)
        return apply_filter(conn, spec, as_of)
    finally:
        conn.close()


async def plan_for(question: str, as_of: date) -> tuple[AskPlan | None, str, str | None, str | None]:
    """(plan, served_from, trace_id, detail). plan is None when nothing could read the question."""
    key = (normalized(question), as_of.isoformat())
    if key in _model_cache:
        plan, trace_id = _model_cache[key]
        return plan, "cache", trace_id, None
    if config.HAS_OPENAI_KEY:
        try:
            plan, trace_id = await asyncio.wait_for(interpret(question, as_of, config.MODEL_FAST),
                                                    ASK_DEADLINE_S)
            _model_cache[key] = (plan, trace_id)
            return plan, "model", trace_id, None
        except asyncio.TimeoutError:
            detail = f"the model took longer than {ASK_DEADLINE_S:.0f} s; answered by the rules"
        except Exception as e:  # model error, refusal, bad output: the rules still answer the examples
            detail = f"model error ({type(e).__name__}); answered by the rules"
        log.warning("ask: %s", detail)
    else:
        detail = "OPENAI_API_KEY is not set; answered by the rules"
    return rules_plan(question, as_of), "rules", None, detail


@router.post("/ask")
async def ask(req: AskRequest) -> dict:
    as_of = score.default_as_of()  # the same pinned date the scores use (config.SCORE_AS_OF)
    question = req.question.strip()

    if req.filter is not None:
        plan = AskPlan(interpretation=f"Your edited filter for “{question}”.", filter=req.filter,
                       intent=req.intent or AskIntent(kind="check_in"))
        served_from, trace_id, detail = "edited", None, None
    else:
        plan, served_from, trace_id, detail = await plan_for(question, as_of)

    if plan is None:
        return {"question": question, "interpretation": NOT_UNDERSTOOD, "understood": False,
                "filter": AskFilter().model_dump(), "intent": None, "donor_ids": [], "donors": [],
                "next_action": None, "as_of": as_of.isoformat(), "served_from": served_from,
                "trace_id": trace_id, "detail": detail}

    rows = await run_in_threadpool(matching_rows, plan.filter, as_of)
    ids = [r["id"] for r in rows]
    return {"question": question, "interpretation": plan.interpretation, "understood": True,
            "filter": plan.filter.model_dump(), "intent": plan.intent.model_dump(),
            "donor_ids": ids, "donors": rows,
            "next_action": {"label": f"{NEXT_ACTION[plan.intent.kind]} for these {len(ids)}",
                            "intent": plan.intent.model_dump(), "donor_ids": ids} if ids else None,
            "as_of": as_of.isoformat(), "served_from": served_from, "trace_id": trace_id, "detail": detail}
