"""Export everything the UI shows into one JSON for VITE_DATA_MODE=snapshot (the Vercel build).

The shapes come from the route functions themselves, so the UI parses both modes the same way:

    {
      "meta":       {"as_of", "generated_at", "label": "Cached sample", "donor_count", "source"},
      "donors":     [...]          # == GET /donors
      "donor_details": {"<id>": {...}}   # == GET /donors/{id}, keyed by id as a string; call_notes always []
      "duplicates": [...]          # == GET /duplicates
      "people":     {"counts": {...}, "giver": [...], "neighbor": [...], "community": [...]}  # == GET /people?type=
      "events":     [...]          # == GET /events
      "event_details": {"<id>": {...}}     # == GET /events/{id}
      "community_stats": {...}     # == GET /community/stats
      "context_status": {...}      # == GET /context/status
      (donor_details covers every person in every tab, so the drawer works on all three.)
      "icp":        {...} | null   # == GET /icp (null before the ICP stage has run)
      "prospects":  [...]          # == GET /prospects
      "prospect_details": {"<id>": {...}}  # == GET /prospects/{id}
      "context":    {"profile": GET /org-profile | null, "facts": GET /context}
      "targets":    {"month": {...}, "quarter": {...}}  # == GET /targets (SAMPLE goals; donor_ids per period)
      "campaigns_demo": {"label", "campaigns": [GET /campaigns/{id}], "outbox": [], "drafts": {...}}
                     # #38: one precomputed sample campaign + template drafts per donor (no API, no writes)
      "ask_examples": [...]        # Ask Donor Desk: rules answers to ask_agent.EXAMPLE_QUESTIONS
    }

Never exported: the Donors tab's notes, tasks and tags (crm_* tables, routes_crm.py). They are private staff
notes; in snapshot mode the browser keeps its own in localStorage.

    python -m service.export_snapshot                    # rescore as of the demo date, write web/public/snapshot.json
    python -m service.export_snapshot --no-rescore --out other.json
"""

from __future__ import annotations

import argparse
import json
from datetime import date, datetime, timezone
from pathlib import Path

from service import dedupe, score, targets
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
    donors = list_donors(conn)
    as_of_values = sorted({d["score_as_of"] for d in donors if d.get("score_as_of")})
    return {
        "meta": {
            "as_of": as_of_values[-1] if as_of_values else None,
            "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "label": "Cached sample",
            "donor_count": len(donors),
            "source": "service/export_snapshot.py from data/donors.db",
        },
        "donors": donors,
        "donor_details": {str(r[0]): snapshot_donor(r[0], conn) for r in conn.execute("SELECT id FROM donors ORDER BY id")},
        "duplicates": list_duplicates(conn),
        "people": {"counts": people_counts(conn), **{t: list_people(conn, t) for t in ("giver", "neighbor", "community")}},
        "events": (events := list_events(conn)),
        "event_details": {str(e["id"]): event_detail(conn, e["id"]) for e in events},
        "community_stats": community_stats(conn),
        "context_status": context_status(conn),
        "icp": latest_icp(conn),
        "prospects": (prospects := list_prospects(include_dismissed=False, conn=conn)),
        "prospect_details": {str(p["id"]): get_prospect(p["id"], conn) for p in prospects},
        "context": {"profile": get_org_profile_or_none(conn), "facts": list_context(conn)},
        "targets": targets.compute_all(conn, as_of),
        "campaigns_demo": campaigns_snapshot(conn),
        "ask_examples": snapshot_examples(conn, as_of_values[-1] if as_of_values else as_of),
    }


def snapshot_donor(donor_id: int, conn) -> dict:
    """GET /donors/{id}, minus saved call notes: transcripts stay on the laptop, never in the public snapshot."""
    return {**get_donor(donor_id, conn), "call_notes": []}


def campaigns_snapshot(conn) -> dict | None:
    """#38's sample campaign + template drafts; null when the outreach lane isn't on this build."""
    try:
        from service.routes_campaigns import campaigns_demo
        return campaigns_demo(conn)
    except ImportError:
        return None


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
    size = write_snapshot(snapshot, out)
    top = snapshot["donors"][0] if snapshot["donors"] else None
    print(f"{out}: {size:,} bytes, {snapshot['meta']['donor_count']} donors, "
          f"{len(snapshot['duplicates'])} duplicates, as_of {snapshot['meta']['as_of']}"
          + (f", #1 {top['full_name']} ({top['score']})" if top else ""))


if __name__ == "__main__":
    main()
