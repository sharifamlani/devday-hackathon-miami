"""Export everything the UI shows into one JSON for VITE_DATA_MODE=snapshot (the Vercel build).

The shapes come from the route functions themselves, so the UI parses both modes the same way:

    {
      "meta":       {"as_of", "generated_at", "label": "Cached sample", "donor_count", "source", "snapshot_id"},
      "donors":     [...]          # == GET /donors
      "donor_details": {"<id>": {...}}   # == GET /donors/{id}, keyed by id as a string; call_notes always []
      "duplicates": [...]          # == GET /duplicates
      "people":     {"counts": {...}, "giver": [...], "neighbor": [...], "community": [...]}  # == GET /people?type=
      "events":     [...]          # == GET /events
      "event_details": {"<id>": {...}}     # == GET /events/{id}
      "community_stats": {...}     # == GET /community/stats
      "context_status": {...}      # == GET /context/status
      "auto_merges": {"<id>": {...}}  # == GET /people/{id}/merges for each flagged person; contacts masked,
                                      #    gift_ids dropped (gift_count kept); open merges only. Read-only on Vercel.
      (donor_details covers every person in every tab, so the drawer works on all three.)
      "icp":        {...} | null   # == GET /icp (null before the ICP stage has run)
      "prospects":  [...]          # == GET /prospects
      "prospect_details": {"<id>": {...}}  # == GET /prospects/{id}
      "context":    {"profile": GET /org-profile | null, "facts": GET /context}
      "targets":    {"month": {...}, "quarter": {...}}  # == GET /targets (SAMPLE goals; donor_ids per period)
      "campaigns_demo": {"label", "campaigns": [GET /campaigns/{id}], "outbox": [], "drafts": {...}}
                     # #38: one precomputed sample campaign + template drafts per donor (no API, no writes)
      "ask_examples": [...]        # Ask Donor Desk: rules answers to ask_agent.EXAMPLE_QUESTIONS
      plan.md §21 home (live-only routes, read from here by the snapshot build):
      "home_summary": {...}        # == GET /home/summary
      "people_attention": [...]    # == GET /people/attention?limit=50 (the UI slices)
      "tasks": [...]               # == GET /tasks minus the Donors tab's private tasks (the UI filters from/to/person)
      "tasks_today": [...]         # == GET /tasks?due=today, same exclusion (and home_summary.tasks_today counts it)
      "calendar": [...]            # == GET /calendar, same exclusion (whole range; the UI filters from/to)
      "artifacts": [...]           # == GET /artifacts, minus call notes (they stay on the laptop)
      "target_quarters": {...}     # == GET /targets/quarters
    }

Never exported: the Donors tab's notes, tasks and tags (crm_* tables and tasks rows with tasks.crm, routes_crm.py). They are private staff
notes; in snapshot mode the browser keeps its own in localStorage, tied to meta.snapshot_id: a hash of every
donor's id and name, so re-exporting the same donors keeps them and a snapshot whose ids mean other donors
starts clean.

    python -m service.export_snapshot                    # rescore as of the demo date, write web/public/snapshot.json
    python -m service.export_snapshot --no-rescore --out other.json
"""

from __future__ import annotations

import argparse
import hashlib
import json
from datetime import date, datetime, timezone
from pathlib import Path

from service import dedupe, donor_summary, public_mode, score, targets, tasks
from service.ask_agent import snapshot_examples
from service.db import REPO_ROOT, connect, create_schema
from service.routes_data import (get_donor, get_org_profile_or_none, get_prospect, latest_icp, list_context,
                                 list_donors, list_duplicates, list_prospects)

from service.routes_data import (community_stats, context_status, event_detail, list_events, list_people,  # 5E
                                 people_counts)

DEFAULT_OUT = REPO_ROOT / "web" / "public" / "snapshot.json"
MAX_BYTES = 2 * 1024 * 1024


def build_snapshot(conn, as_of: date | None = None, rescore: bool = True) -> dict:
    create_schema(conn)
    if rescore:
        score.run(conn, as_of)
        dedupe.run(conn)
    # Tasks first (idempotent; home_snapshot runs it too): every next_step below reads them.
    tasks.generate(conn, as_of or score.default_as_of())
    # next_step without the Donors tab's private tasks (tasks.crm), everywhere the snapshot carries it
    donors = tasks.with_next_steps(conn, list_donors(conn), as_of, public_only=True)
    as_of_values = sorted({d["score_as_of"] for d in donors if d.get("score_as_of")})
    return {
        "meta": {
            "as_of": as_of_values[-1] if as_of_values else None,
            "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "label": "Cached sample",
            "donor_count": len(donors),
            "source": "service/export_snapshot.py from data/donors.db",
            "snapshot_id": snapshot_id(donors),
        },
        "donors": donors,
        "donor_details": {str(r[0]): snapshot_donor(r[0], conn) for r in conn.execute("SELECT id FROM donors ORDER BY id")},
        "duplicates": list_duplicates(conn),
        # next_step recomputed without the Donors tab's private tasks (tasks.crm), like home_snapshot's task lists
        "people": {"counts": people_counts(conn), **{t: tasks.with_next_steps(conn, list_people(conn, t), as_of, public_only=True)
                                                     for t in ("giver", "neighbor", "community")}},
        "events": (events := list_events(conn)),
        "event_details": {str(e["id"]): snapshot_event(conn, e["id"]) for e in events},
        "community_stats": community_stats(conn),
        "context_status": context_status(conn),
        "auto_merges": auto_merges_snapshot(conn),
        "icp": latest_icp(conn),
        "prospects": (prospects := list_prospects(include_dismissed=False, conn=conn)),
        "prospect_details": {str(p["id"]): get_prospect(p["id"], conn) for p in prospects},
        "context": {"profile": get_org_profile_or_none(conn), "facts": list_context(conn)},
        "targets": targets.compute_all(conn, as_of),
        "campaigns_demo": campaigns_snapshot(conn),
        "ask_examples": snapshot_examples(conn, as_of_values[-1] if as_of_values else as_of),
        **home_snapshot(conn, as_of),
    }


def home_snapshot(conn, as_of: date | None) -> dict:
    """The home board's live-only routes (plan.md §21), from the same functions the routes call.

    Runs the task generator first: it is idempotent, and the pipeline's sample DB otherwise has no tasks.
    Call-note artifacts are left out, like donor_details' call_notes: transcripts never go public.
    """
    from service import tasks
    from service.routes_home import attention, home_summary

    today = as_of or score.default_as_of()
    tasks.generate(conn, today)
    # The Donors tab's tasks are private staff records (like crm notes): never in the public snapshot, not
    # even as a count. Generated and agent tasks stay.
    tasks_today = tasks.list_tasks(conn, due="today", as_of=today, public_only=True)
    summary = {**home_summary(as_of=today, conn=conn), "tasks_today": sum(1 for t in tasks_today if not t["done"])}
    return {
        "home_summary": summary,
        "people_attention": attention(conn, today, 50),
        "tasks": tasks.list_tasks(conn, as_of=today, public_only=True),
        "tasks_today": tasks_today,
        "calendar": tasks.calendar(conn, None, None, public_only=True),
        "artifacts": [a for a in tasks.artifacts(conn, 50) if a.get("kind") != "call_note"],
        "target_quarters": targets.quarters(conn, today),
    }


def snapshot_id(donors: list[dict]) -> str:
    """Which donors this snapshot's ids stand for: stable across re-exports of the same donors, different as
    soon as an id names someone else. The browser keys its saved notes to it (crmPersistence.ts)."""
    pairs = sorted((int(d["id"]), d.get("full_name") or "") for d in donors)
    return hashlib.sha256(json.dumps(pairs, ensure_ascii=False).encode()).hexdigest()[:16]


def snapshot_donor(donor_id: int, conn) -> dict:
    """GET /donors/{id}, minus saved call notes and the agent's summary (written from calls and chats): they stay
    on the laptop, never in the public snapshot."""
    detail = tasks.with_next_steps(conn, [get_donor(donor_id, conn)], public_only=True)[0]
    return {**detail, "call_notes": [], **donor_summary.BLANK}


# The snapshot has a 2 MB budget. Each event lists at most this many drafted invites; every invite is still in its
# person's donor_details, and drafts_ready / audience_count stay exact (computed in SQL).
SNAPSHOT_DRAFTS_PER_EVENT = 10


def snapshot_event(conn, event_id: int) -> dict:
    """GET /events/{id}, with the drafts list capped; drafts_total says how many there are when capped."""
    event = event_detail(conn, event_id)
    if len(event.get("drafts") or []) > SNAPSHOT_DRAFTS_PER_EVENT:
        event["drafts_total"] = len(event["drafts"])
        event["drafts"] = event["drafts"][:SNAPSHOT_DRAFTS_PER_EVENT]
    return event


def auto_merges_snapshot(conn) -> dict:
    """The "!" dialog's source records for every person with an open automatic merge (#125), so the Vercel
    build can list them (Keep/Split stay live-only). Emails and phones masked like campaign addresses."""
    try:
        from service.routes_campaigns import mask_address
        from service.routes_data import person_merges
    except ImportError:
        return {}
    has_table = conn.execute("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'auto_merges'").fetchone()
    if not has_table:
        return {}
    out = {}
    for (person_id,) in conn.execute("SELECT DISTINCT donor_id FROM auto_merges WHERE reviewed_at IS NULL "
                                     "AND donor_id IN (SELECT id FROM donors) ORDER BY donor_id"):
        body = person_merges(conn, person_id)
        body["merges"] = [
            {**m, "reviewed_by": None,
             "sources": [{**src, "email": mask_address(src.get("email"), "email"),
                          "phone": mask_address(src.get("phone"), "text"), "gift_ids": []}
                         for src in m["sources"]]}
            for m in body["merges"] if m["reviewed_at"] is None]
        out[str(person_id)] = body
    return out


def campaigns_snapshot(conn) -> dict | None:
    """#38's sample campaign + template drafts; null when the outreach lane isn't on this build."""
    try:
        from service.routes_campaigns import campaigns_demo
        demo = campaigns_demo(conn)
    except ImportError:
        return None
    # The campaign picker offers Givers only (GET /donors), so cached drafts for Neighbors and Community can never
    # be used on Vercel: drop them to stay inside the 2 MB budget. Every selectable donor keeps all six drafts.
    givers = {str(r[0]) for r in conn.execute("SELECT id FROM donors WHERE contact_type = 'giver'")}
    if demo and isinstance(demo.get("drafts"), dict):
        demo["drafts"] = {k: v for k, v in demo["drafts"].items() if k in givers}
    return demo


def public_snapshot(snapshot: dict) -> dict:
    """What the public preview may show: build_snapshot mirrors the routes unmasked (the tests compare them), so the
    file is masked on the way out the same way public mode masks a live response: emails and phones masked, call
    transcripts and staff free text blanked."""
    return public_mode.mask_json(snapshot)


def write_snapshot(snapshot: dict, out: Path) -> int:
    text = json.dumps(snapshot, ensure_ascii=False, indent=1)
    size = len(text.encode("utf-8"))
    if size > MAX_BYTES:
        raise SystemExit(f"snapshot is {size:,} bytes, over the {MAX_BYTES:,} byte limit")
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(text + "\n", encoding="utf-8", newline="\n")
    return size


def main() -> None:
    parser = argparse.ArgumentParser(description="Write the UI snapshot JSON")
    parser.add_argument("--out", default=str(DEFAULT_OUT))
    parser.add_argument("--db", default=None, help="db path (default: data/donors.db or $DONORS_DB)")
    parser.add_argument("--as-of", default=None, help="YYYY-MM-DD (default: $SCORE_AS_OF or 2026-11-08)")
    parser.add_argument("--no-rescore", action="store_true", help="export scores as stored")
    args = parser.parse_args()

    conn = connect(args.db)
    try:
        snapshot = build_snapshot(conn, date.fromisoformat(args.as_of) if args.as_of else None,
                                  rescore=not args.no_rescore)
    finally:
        conn.close()
    out = Path(args.out)
    size = write_snapshot(public_snapshot(snapshot), out)
    top = snapshot["donors"][0] if snapshot["donors"] else None
    print(f"{out}: {size:,} bytes, {snapshot['meta']['donor_count']} donors, "
          f"{len(snapshot['duplicates'])} duplicates, as_of {snapshot['meta']['as_of']}"
          + (f", #1 {top['full_name']} ({top['score']})" if top else ""))


if __name__ == "__main__":
    main()
