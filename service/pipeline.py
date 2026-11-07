"""Precompute the whole demo in one command, so nothing slow runs on stage.

    python -m service.pipeline --as-of 2026-11-08

Stages, in order:
    1. rebuild   drop + recreate data/donors.db with the SAMPLE seed, score and dedupe
                 (--keep-db: keep the rows ingest wrote, just rescore + dedupe)
    2. enrich    research ORGANIZATION donors only (policy: fictional sample individuals are never
                 researched). Cache first (data/research_cache.json); uncached orgs are skipped unless
                 --live-enrich. Writes research_facts via enrich_agent.save_facts.
    3. outreach  draft for the top N donors plus every ★ donor (live model calls, run in parallel),
                 using service/org_facts.json. Writes outreach_drafts via outreach_agent.save_draft.
    4. export    web/public/snapshot.json for the Vercel build

Enrich and outreach are imported lazily: if one isn't on this branch yet, that stage is reported as
MISSING with the reason and the rest still runs.
"""

from __future__ import annotations

import argparse
import importlib
import os
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import date
from pathlib import Path

from service import db, dedupe, score
from service.export_snapshot import DEFAULT_OUT, build_snapshot, write_snapshot
from service.routes_data import get_donor

STAGE_MODULES = {
    "enrich": ["service.enrich_agent"],
    "outreach": ["service.outreach_agent", "service.org_context"],
}
MISSING_HINT = {
    "enrich": "service/enrich_agent.py (PR #5, feat/enrich)",
    "outreach": "service/outreach_agent.py + service/org_context.py (PR #7, feat/outreach)",
}


class StageMissing(Exception):
    pass


def load_stage(stage: str) -> list:
    modules = []
    for name in STAGE_MODULES[stage]:
        try:
            modules.append(importlib.import_module(name))
        except ImportError as e:
            raise StageMissing(f"{stage} stage unavailable: needs {MISSING_HINT[stage]} ({e})") from e
    return modules


def stage_rebuild(as_of: date, keep_db: bool) -> str:
    if keep_db:
        conn = db.connect()
        db.create_schema(conn)
        n = score.run(conn, as_of)
        pending = dedupe.run(conn)
        conn.close()
        return f"kept existing rows; scored {n}, {pending} pending duplicates"
    db.rebuild(as_of=as_of)
    return "rebuilt with SAMPLE seed"


def stage_enrich(live: bool) -> str:
    (enrich_agent,) = load_stage("enrich")
    cache = enrich_agent.read_cache()
    conn = db.connect()
    orgs = [dict(r) for r in conn.execute(
        "SELECT id, full_name, org_name, city FROM donors WHERE donor_type = 'organization' ORDER BY id")]
    individuals = conn.execute("SELECT COUNT(*) FROM donors WHERE donor_type = 'individual'").fetchone()[0]
    conn.close()

    run_id = f"pipeline-{uuid.uuid4().hex[:8]}"
    enriched, skipped, facts_total = [], [], 0
    for org in orgs:
        name = org["org_name"] or org["full_name"]
        if name not in cache and not live:
            skipped.append(name)
            continue
        facts = enrich_agent.enrich_donor(name, org_name=org["org_name"], city=org["city"])
        conn = db.connect()
        with conn:
            conn.execute("DELETE FROM research_facts WHERE donor_id = ?", (org["id"],))
        conn.close()
        facts_total += enrich_agent.save_facts(org["id"], facts, run_id)
        enriched.append(name)
    detail = f"{facts_total} facts for {len(enriched)} orgs; {individuals} individuals skipped by policy"
    if skipped:
        detail += f"; not cached (use --live-enrich): {', '.join(skipped)}"
    return detail


def outreach_targets(conn, top_n: int) -> list[int]:
    top = [r[0] for r in conn.execute("SELECT donor_id FROM donor_scores ORDER BY score DESC, donor_id LIMIT ?", (top_n,))]
    stars = [r[0] for r in conn.execute("SELECT donor_id FROM donor_scores WHERE is_star = 1 ORDER BY score DESC")]
    return list(dict.fromkeys(top + stars))


MODEL_TIMEOUT_S = 90


def bound_model_calls(timeout_s: float = MODEL_TIMEOUT_S) -> None:
    """The Agents SDK's default OpenAI client waits up to 600 s per request; one stalled call
    once hung a demo build for 10+ minutes. Fail fast instead (with retries) so the run finishes."""
    try:
        from agents import set_default_openai_client
        from dotenv import load_dotenv
        from openai import AsyncOpenAI
    except ImportError:
        return                                      # stub stages in tests; nothing to bound
    load_dotenv(db.REPO_ROOT / ".env")
    if os.environ.get("OPENAI_API_KEY"):
        set_default_openai_client(AsyncOpenAI(timeout=timeout_s, max_retries=2))


def stage_outreach(as_of: date, top_n: int, workers: int = 4) -> str:
    outreach_agent, org_context = load_stage("outreach")
    bound_model_calls()
    org_facts = org_context.load_org_facts()

    conn = db.connect()
    targets = outreach_targets(conn, top_n)
    details = {i: get_donor(i, conn) for i in targets}
    conn.close()

    def draft(donor_id: int):
        d = details[donor_id]
        try:
            return donor_id, outreach_agent.draft_outreach(
                d, d["gifts"], d["why"], d["research_facts"], org_facts, today=as_of), None
        except Exception as e:                      # one bad draft must not sink the demo run
            return donor_id, None, f"{type(e).__name__}: {e}"

    with ThreadPoolExecutor(max_workers=workers) as pool:
        results = list(pool.map(draft, targets))

    saved, failed = [], []
    for donor_id, result, error in results:
        name = details[donor_id]["full_name"]
        if error:
            failed.append(f"{name} ({error})")
            continue
        conn = db.connect()
        with conn:
            conn.execute("DELETE FROM outreach_drafts WHERE donor_id = ?", (donor_id,))
        conn.close()
        outreach_agent.save_draft(donor_id, result)
        saved.append(f"{name} [{result.status}]")
    detail = f"{len(saved)} drafts: {', '.join(saved)}"
    if failed:
        detail += f"; FAILED: {'; '.join(failed)}"
    return detail


def stage_export(out: Path) -> str:
    conn = db.connect()
    snapshot = build_snapshot(conn, rescore=False)
    conn.close()
    size = write_snapshot(snapshot, out)
    return f"{out} ({size:,} bytes)"


def table_counts() -> dict[str, int]:
    conn = db.connect()
    counts = {t: conn.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0] for t in reversed(db.TABLES)}
    conn.close()
    return counts


def run_pipeline(as_of: date, top_n: int = 3, keep_db: bool = False, live_enrich: bool = False,
                 skip: tuple[str, ...] = (), out: Path = DEFAULT_OUT) -> list[dict]:
    """Run every stage, timing each. Returns [{stage, status, seconds, detail}]; status is
    ok | skipped | missing | failed."""
    stages = [
        ("rebuild", lambda: stage_rebuild(as_of, keep_db)),
        ("enrich", lambda: stage_enrich(live_enrich)),
        ("outreach", lambda: stage_outreach(as_of, top_n)),
        ("export", lambda: stage_export(out)),
    ]
    report = []
    for name, fn in stages:
        if name in skip:
            report.append({"stage": name, "status": "skipped", "seconds": 0.0, "detail": "--skip"})
            continue
        start = time.perf_counter()
        try:
            status, detail = "ok", fn()
        except StageMissing as e:
            status, detail = "missing", str(e)
        except Exception as e:
            status, detail = "failed", f"{type(e).__name__}: {e}"
        report.append({"stage": name, "status": status, "seconds": round(time.perf_counter() - start, 2),
                       "detail": detail})
        if status == "failed" and name == "rebuild":
            break
    return report


def main() -> int:
    parser = argparse.ArgumentParser(description="Precompute the demo: rebuild → enrich → outreach → export")
    parser.add_argument("--as-of", default=None, help="YYYY-MM-DD (default: $SCORE_AS_OF or 2026-11-08)")
    parser.add_argument("--top", type=int, default=3, help="draft outreach for the top N donors (plus every ★)")
    parser.add_argument("--keep-db", action="store_true", help="keep ingested rows; don't rebuild from the seed")
    parser.add_argument("--live-enrich", action="store_true", help="web-search orgs missing from the cache")
    parser.add_argument("--skip", action="append", default=[], choices=["enrich", "outreach", "export"])
    parser.add_argument("--out", default=str(DEFAULT_OUT))
    args = parser.parse_args()

    as_of = date.fromisoformat(args.as_of) if args.as_of else score.default_as_of()
    report = run_pipeline(as_of, args.top, args.keep_db, args.live_enrich, tuple(args.skip), Path(args.out))

    print(f"pipeline as of {as_of.isoformat()}")
    for r in report:
        print(f"  {r['stage']:<9} {r['status'].upper():<8} {r['seconds']:>7.2f}s  {r['detail']}")
    print("  rows: " + ", ".join(f"{t}={n}" for t, n in table_counts().items()))
    return 0 if all(r["status"] in ("ok", "skipped") for r in report) else 1


if __name__ == "__main__":
    raise SystemExit(main())
