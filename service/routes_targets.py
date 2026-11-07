"""Donation target routes (issue #37). main.py mounts this router:

    from service.routes_targets import router as targets_router
    app.include_router(targets_router)

GET /targets                  {"month": {...}, "quarter": {...}}: raised vs. SAMPLE goal (service/targets.py)
GET /targets?period=quarter   one period's object
GET /targets/donors?period=   donors who gave in the period, biggest giver first; rows shaped like GET /donors
                              (feeds the thank-you flow)

Both take ?as_of=YYYY-MM-DD; the default is $SCORE_AS_OF or the demo date, like scoring.
"""

from __future__ import annotations

import sqlite3
from datetime import date
from typing import Literal

from fastapi import APIRouter, Depends, Query

from service import targets
from service.routes_data import get_conn, list_donors

router = APIRouter(tags=["targets"])

Period = Literal["month", "quarter"]


@router.get("/targets")
def get_targets(period: Period | None = Query(None), as_of: date | None = Query(None),
                conn: sqlite3.Connection = Depends(get_conn)) -> dict:
    if period is None:
        return targets.compute_all(conn, as_of)
    return targets.compute(conn, period, as_of)


@router.get("/targets/donors")
def get_target_donors(period: Period = Query("month"), as_of: date | None = Query(None),
                      conn: sqlite3.Connection = Depends(get_conn)) -> list[dict]:
    order = {donor_id: i for i, donor_id in enumerate(targets.compute(conn, period, as_of)["donor_ids"])}
    rows = [d for d in list_donors(conn) if d["id"] in order]
    return sorted(rows, key=lambda d: order[d["id"]])
