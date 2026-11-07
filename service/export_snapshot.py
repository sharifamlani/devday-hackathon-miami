"""Export everything the UI shows into one JSON for VITE_DATA_MODE=snapshot (the Vercel build).

The shapes come from the route functions themselves, so the UI parses both modes the same way:

    {
      "meta":       {"as_of", "generated_at", "label": "Cached sample", "donor_count", "source"},
      "donors":     [...]          # == GET /donors
      "donor_details": {"<id>": {...}}   # == GET /donors/{id}, keyed by id as a string
      "duplicates": [...]          # == GET /duplicates
      "icp":        {...} | null   # == GET /icp (null before the ICP stage has run)
      "prospects":  [...]          # == GET /prospects
      "prospect_details": {"<id>": {...}}  # == GET /prospects/{id}
      "context":    {"profile": GET /org-profile | null, "facts": GET /context}
    }

    python -m service.export_snapshot                    # rescore as of the demo date, write web/public/snapshot.json
    python -m service.export_snapshot --no-rescore --out other.json
"""

from __future__ import annotations

import argparse
import json
from datetime import date, datetime, timezone
from pathlib import Path

from service import dedupe, score
from service.db import REPO_ROOT, connect, create_schema
from service.routes_data import (get_donor, get_org_profile_or_none, get_prospect, latest_icp, list_context,
                                 list_donors, list_duplicates, list_prospects)

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
        "donor_details": {str(d["id"]): get_donor(d["id"], conn) for d in donors},
        "duplicates": list_duplicates(conn),
        "icp": latest_icp(conn),
        "prospects": (prospects := list_prospects(include_dismissed=False, conn=conn)),
        "prospect_details": {str(p["id"]): get_prospect(p["id"], conn) for p in prospects},
        "context": {"profile": get_org_profile_or_none(conn), "facts": list_context(conn)},
    }


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
