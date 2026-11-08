import json

from service import db
from service.export_snapshot import MAX_BYTES, build_snapshot, write_snapshot
from service.tests.test_routes_data import client
from service.tests.test_targets import client as targets_client


def test_snapshot_mirrors_routes(db_file, tmp_path):
    conn = db.connect(db_file)
    snap = build_snapshot(conn)
    conn.close()
    out = tmp_path / "snapshot.json"
    size = write_snapshot(snap, out)
    assert 0 < size < MAX_BYTES
    loaded = json.loads(out.read_text(encoding="utf-8"))

    c = client()
    donors = c.get("/donors").json()
    assert loaded["donors"][0] == donors[0]
    assert loaded["donors"] == donors
    assert loaded["donor_details"][str(donors[0]["id"])] == c.get(f"/donors/{donors[0]['id']}").json()
    assert loaded["duplicates"] == c.get("/duplicates").json()
    # Subset, not equality: several lanes add their own keys.
    assert {"meta", "donors", "donor_details", "duplicates", "icp", "prospects", "prospect_details", "context",
            "targets", "campaigns_demo", "ask_examples",                                   # campaigns lane
            "people", "events", "event_details", "community_stats", "context_status"} <= set(loaded)   # 5E
    assert loaded["targets"] == targets_client().get("/targets").json()
    assert loaded["context"] == {"profile": None, "facts": []}
    assert loaded["icp"] is None and loaded["prospects"] == [] and loaded["prospect_details"] == {}
    assert loaded["meta"]["label"] == "Cached sample"
    assert loaded["meta"]["as_of"] == "2026-11-07"     # conftest pins SCORE_AS_OF
    assert loaded["meta"]["donor_count"] == 12                        # givers
    assert len(loaded["donor_details"]) == 18                          # every person, every tab
