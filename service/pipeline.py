"""Precompute the whole demo in one command, so nothing slow runs on stage.

    python -m service.pipeline --as-of 2026-11-08

Stages, in order:
    1. rebuild   drop + recreate data/donors.db with the SAMPLE seed, score and dedupe
                 (--keep-db / --no-seed: never seed; keep the rows ingest wrote, just rescore + dedupe)
    1b. context  read the Foundation's website + social URLs (service/org_config.json) into the local
                 context dataset (org_profile, org_context) so ICP, prospects and drafts can use it.
                 build_context is pure; db.save_context is the only writer.
    1c. events   the Foundation's upcoming events (events_agent, 86) -> save_events -> an audience across the
                 three tabs -> pre-drafted invites (outreach_drafts linked by event_drafts). One
                 context_refresh_log row covers context + events.
    2. enrich    research ORGANIZATION donors only (policy: fictional sample individuals are never
                 researched). Cache first (data/research_cache.json); uncached orgs are skipped unless
                 --live-enrich. Writes research_facts via enrich_agent.save_facts.
    3. outreach  draft for the top N donors plus every ★ donor (live model calls, run in parallel),
                 using service/org_facts.json. Writes outreach_drafts via outreach_agent.save_draft.
    3b. icp      ideal donor profile from the org donors → new organization prospects → a first-touch
                 draft for each (icp_agent is pure; db.save_icp / save_prospects are the only writers;
                 drafts are saved with prospect_id, always 'draft').
    4. export    web/public/snapshot.json for the Vercel build

Enrich and outreach are imported lazily: if one isn't on this branch yet, that stage is reported as
MISSING with the reason and the rest still runs.
"""

from __future__ import annotations

import argparse
import importlib
import sqlite3
import json
import os
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timezone
from pathlib import Path

from service import db, dedupe, score
from service.export_snapshot import DEFAULT_OUT, build_snapshot, write_snapshot
from service.routes_data import get_donor, get_prospect

ORG_CONFIG = Path(__file__).resolve().parent / "org_config.json"
CONTEXT_MODULES = ["service.context_agent", "service.org_context"]   # whichever has build_context

STAGE_MODULES = {
    "enrich": ["service.enrich_agent"],
    "outreach": ["service.outreach_agent", "service.org_context"],
    "icp": ["service.icp_agent", "service.outreach_agent", "service.org_context"],
}
MISSING_HINT = {
    "events": "service/events_agent.py (86, PR #49)",
    "context": "build_context in service/context_agent.py or service/org_context.py (86, plan §15)",
    "enrich": "service/enrich_agent.py (PR #5, feat/enrich)",
    "outreach": "service/outreach_agent.py + service/org_context.py (PR #7, feat/outreach)",
    "icp": "service/icp_agent.py (42, feat/icp)",
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
    db.rebuild(as_of=as_of, with_seed=True)   # the Vercel snapshot is built from the SAMPLE seed
    return "rebuilt with SAMPLE seed"


def load_org_config(path: Path = ORG_CONFIG) -> dict:
    config = json.loads(path.read_text(encoding="utf-8"))
    return {k: v for k, v in config.items() if not k.startswith("_")}


def stage_context(refresh_cache: bool = False, config_path: Path = ORG_CONFIG, state: dict | None = None) -> str:
    build_context = None
    for name in CONTEXT_MODULES:
        try:
            build_context = getattr(importlib.import_module(name), "build_context", None)
        except ImportError:
            continue
        if build_context:
            break
    if build_context is None:
        raise StageMissing(f"context stage unavailable: needs {MISSING_HINT['context']}")
    bound_model_calls()
    urls = load_org_config(config_path)
    # Default: read the db/cache and never rewrite the reviewed service/context_cache.json.
    # --refresh-demo-cache fetches live and rewrites it (86's write_cache=True).
    result = (build_context(urls, refresh=True, write_cache=True) if refresh_cache
              else build_context(urls, refresh=False))
    conn = db.connect()
    saved = db.save_context(conn, result)
    conn.close()
    statuses = result.get("sources") or {}
    if state is not None:
        state.update(context=saved, sources=statuses)
    detail = (f"{len(saved['context_ids'])} facts from {', '.join(saved['replaced_sources']) or 'no source'}"
              f"; status {json.dumps(statuses, sort_keys=True)}")
    if saved["skipped_facts"]:
        detail += f"; {saved['skipped_facts']} facts without a URL dropped"
    return detail


def stage_events(as_of: date, refresh: bool = False, state: dict | None = None, workers: int = 4) -> str:
    try:
        events_agent = importlib.import_module("service.events_agent")
    except ImportError as e:
        raise StageMissing(f"events stage unavailable: needs {MISSING_HINT['events']} ({e})") from e
    bound_model_calls()
    from service.routes_data import list_context, list_people

    conn = db.connect()
    found = events_agent.extract_events(list_context(conn), refresh=refresh)
    # A non-empty, successful extraction is a complete refresh; an empty one never removes anything.
    saved = db.save_events(conn, found, complete=bool(found))
    people = list_people(conn)
    kept = [i for i in saved["ids"] if i is not None]
    events = [dict(r) for r in conn.execute(
        f"SELECT * FROM events WHERE id IN ({', '.join('?' * len(kept)) or 'NULL'}) AND status != 'past'", kept)]
    conn.close()
    if state is not None:
        state["events"] = saved

    by_id = {p["id"]: p for p in people}
    jobs, audiences = [], 0
    for event in events:
        audience = events_agent.suggest_audience(event, people)
        conn = db.connect()
        audiences += db.save_event_audience(conn, event["id"], audience)
        conn.close()
        jobs += [(event, by_id[pid]) for pid in audience.get("person_ids") or [] if pid in by_id]

    def draft(job):
        event, person = job
        try:
            return event, person, events_agent.draft_event_invite(event, person), None
        except Exception as e:                      # one bad invite must not sink the demo run
            return event, person, None, f"{type(e).__name__}: {e}"

    with ThreadPoolExecutor(max_workers=workers) as pool:
        results = list(pool.map(draft, jobs))
    saved_drafts, failed = 0, []
    conn = db.connect()
    for event, person, invite, error in results:
        if error is None:
            try:
                db.save_event_draft(conn, event["id"], person["id"], invite)
                saved_drafts += 1
                continue
            except sqlite3.IntegrityError as e:     # e.g. a star invite marked 'ready'
                error = f"IntegrityError: {e}"
        failed.append(f"{event['title']} / {person['full_name']} ({error})")
    conn.close()
    detail = (f"{len(kept)} events ({saved['added']} new, {saved['changed']} changed, {saved['removed']} removed); "
              f"{audiences} audience picks; {saved_drafts} invites drafted")
    if failed:
        detail += f"; FAILED: {'; '.join(failed[:5])}" + (f" (+{len(failed) - 5} more)" if len(failed) > 5 else "")
    return detail


def stage_enrich(live: bool) -> str:
    (enrich_agent,) = load_stage("enrich")
    cache = enrich_agent.read_cache()
    conn = db.connect()
    orgs = [dict(r) for r in conn.execute(
        "SELECT id, full_name, org_name, city, state, email FROM donors WHERE donor_type = 'organization' "
        "AND contact_type = 'giver' ORDER BY id")]
    individuals = conn.execute("SELECT COUNT(*) FROM donors WHERE donor_type = 'individual' "
                               "AND contact_type = 'giver'").fetchone()[0]
    conn.close()

    run_id = f"pipeline-{uuid.uuid4().hex[:8]}"
    enriched, skipped, facts_total = [], [], 0
    for org in orgs:
        name = org["org_name"] or org["full_name"]
        if name not in cache and not live:
            skipped.append(name)
            continue
        facts = enrich_agent.enrich_donor(name, org_name=org["org_name"], city=org["city"], use_cache=True,
                                          state=org["state"], email=org["email"])
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
            # Replace only this stage's own donor draft; event invites (event_drafts) are kept.
            conn.execute("DELETE FROM outreach_drafts WHERE donor_id = ? AND id NOT IN (SELECT draft_id FROM event_drafts)",
                         (donor_id,))
        conn.close()
        outreach_agent.save_draft(donor_id, result)
        saved.append(f"{name} [{result.status}]")
    detail = f"{len(saved)} drafts: {', '.join(saved)}"
    if failed:
        detail += f"; FAILED: {'; '.join(failed)}"
    return detail


def stage_icp(as_of: date, refresh: bool = False, workers: int = 4) -> str:
    icp_agent, outreach_agent, org_context = load_stage("icp")
    can_draft = hasattr(outreach_agent, "draft_prospect")      # 86's piece may land after 42's
    bound_model_calls()

    conn = db.connect()
    exclude = {r[0] for r in conn.execute("SELECT full_name FROM donors")}
    exclude |= {r[0] for r in conn.execute("SELECT org_name FROM donors WHERE org_name IS NOT NULL")}
    conn.close()

    # the snapshot build serves the committed cache on purpose; the app itself only falls back to it on failure
    profile = icp_agent.build_profile(refresh=refresh, use_cache=True)
    found = icp_agent.find_prospects(profile, exclude, refresh=refresh, use_cache=True)
    conn = db.connect()
    db.save_icp(conn, profile)
    ids = db.save_prospects(conn, found)
    prospects = [get_prospect(i, conn) for i in ids]
    conn.close()
    targets = [p for p in prospects if p["status"] != "dismissed"] if can_draft else []

    org_facts = org_context.load_org_facts()

    def draft(p: dict):
        try:
            return p, outreach_agent.draft_prospect(p, profile, org_facts, today=as_of), None
        except Exception as e:                      # one bad draft must not sink the demo run
            return p, None, f"{type(e).__name__}: {e}"

    with ThreadPoolExecutor(max_workers=workers) as pool:
        results = list(pool.map(draft, targets))

    saved, failed = 0, []
    conn = db.connect()
    with conn:
        for p, d, error in results:
            if error:
                failed.append(f"{p['name']} ({error})")
                continue
            conn.execute("DELETE FROM outreach_drafts WHERE prospect_id = ?", (p["id"],))
            conn.execute(
                "INSERT INTO outreach_drafts (prospect_id, channel, subject, body, call_script, facts_used, status) "
                "VALUES (?, 'email', ?, ?, ?, ?, 'draft')",
                (p["id"], d.subject, d.body, d.call_script,
                 json.dumps([f.model_dump() if hasattr(f, "model_dump") else dict(f) for f in d.facts_used])))
            conn.execute("UPDATE prospects SET status = 'drafted' WHERE id = ? AND status = 'new'", (p["id"],))
            saved += 1
    conn.close()
    detail = f"profile with {len(profile.get('traits') or [])} traits; {len(ids)} prospects; {saved} first-touch drafts"
    if not can_draft:
        detail += "; first-touch drafts skipped: needs outreach_agent.draft_prospect (86)"
    if len(found) != len(ids):
        detail += f"; {len(found) - len(ids)} dropped as current donors"
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
                 skip: tuple[str, ...] = (), out: Path = DEFAULT_OUT, refresh_demo_cache: bool = False) -> list[dict]:
    """Run every stage, timing each. Returns [{stage, status, seconds, detail}]; status is
    ok | skipped | missing | failed."""
    # Context first so ICP, prospects and donor drafts can all use it; ICP before outreach.
    state: dict = {"started_at": datetime.now(timezone.utc).isoformat(timespec="seconds")}
    stages = [
        ("rebuild", lambda: stage_rebuild(as_of, keep_db)),
        ("context", lambda: stage_context(refresh_demo_cache, state=state)),
        ("events", lambda: stage_events(as_of, state=state)),
        ("enrich", lambda: stage_enrich(live_enrich)),
        ("icp", lambda: stage_icp(as_of)),
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
        if name == "events":                    # log before export so the snapshot carries it
            log_refresh(state, report)
    if not any(r["stage"] == "events" for r in report):
        log_refresh(state, report)
    return report


def log_refresh(state: dict, report: list[dict]) -> None:
    """One context_refresh_log row for this run's context + events stages (when either ran)."""
    ran = {r["stage"]: r for r in report if r["stage"] in ("context", "events") and r["status"] != "skipped"}
    if not ran:
        return
    errors = [f"{r['stage']}: {r['detail']}" for r in ran.values() if r["status"] in ("missing", "failed")]
    conn = db.connect()
    db.log_context_refresh(conn, state["started_at"], state.get("sources"), state.get("context"),
                           state.get("events"), errors)
    conn.close()


def main() -> int:
    parser = argparse.ArgumentParser(description="Precompute the demo: rebuild -> context -> events -> enrich -> icp -> outreach -> export")
    parser.add_argument("--as-of", default=None, help="YYYY-MM-DD (default: $SCORE_AS_OF or 2026-11-08)")
    parser.add_argument("--top", type=int, default=3, help="draft outreach for the top N donors (plus every star donor)")
    parser.add_argument("--keep-db", "--no-seed", dest="keep_db", action="store_true",
                        help="run on whatever ingest wrote (empty is fine): no rebuild, no seed; just rescore + dedupe")
    parser.add_argument("--live-enrich", action="store_true", help="web-search orgs missing from the cache")
    parser.add_argument("--refresh-demo-cache", action="store_true",
                        help="fetch the Foundation's context live and REWRITE the committed service/context_cache.json")
    parser.add_argument("--skip", action="append", default=[], choices=["context", "events", "enrich", "icp", "outreach", "export"])
    parser.add_argument("--out", default=str(DEFAULT_OUT))
    args = parser.parse_args()

    as_of = date.fromisoformat(args.as_of) if args.as_of else score.default_as_of()
    report = run_pipeline(as_of, args.top, args.keep_db, args.live_enrich, tuple(args.skip), Path(args.out),
                          args.refresh_demo_cache)

    print(f"pipeline as of {as_of.isoformat()}")
    for r in report:
        print(f"  {r['stage']:<9} {r['status'].upper():<8} {r['seconds']:>7.2f}s  {r['detail']}")
    print("  rows: " + ", ".join(f"{t}={n}" for t, n in table_counts().items()))
    return 0 if all(r["status"] in ("ok", "skipped") for r in report) else 1


if __name__ == "__main__":
    raise SystemExit(main())
