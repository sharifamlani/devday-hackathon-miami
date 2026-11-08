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


def test_campaign_drafts_cover_every_giver_and_only_givers(db_file):
    conn = db.connect(db_file)
    snap = build_snapshot(conn, rescore=False)
    givers = {str(r[0]) for r in conn.execute("SELECT id FROM donors WHERE contact_type = 'giver'")}
    conn.close()
    demo = snap["campaigns_demo"]
    if demo is None:
        return                                                 # outreach lane absent on this build
    assert set(demo["drafts"]) <= givers                       # nothing unreachable from the Givers-only picker
    reachable = {str(d["id"]) for d in client().get("/donors").json()}
    assert reachable <= set(demo["drafts"]) or len(reachable) > 60   # every pickable donor has its drafts
    assert all(len(v) == 6 for v in demo["drafts"].values())  # all intent x channel combinations kept


def test_the_written_file_masks_contacts_and_blanks_staff_text(db_file, tmp_path):
    """The public preview reads this file: no full email or phone, no transcript or call notes (#137/#189)."""
    import re
    from service.export_snapshot import public_snapshot
    from service.public_mode import EMAIL_RE, PHONE_RE
    conn = db.connect(db_file)
    snap = build_snapshot(conn, rescore=False)
    conn.close()
    snap["donor_details"]["x"] = {"email": "maria.delgado@example.com", "phone": "305-555-0101",
                                  "notes": "met at gala", "transcript": "she said yes", "bio": "call 305-555-0102"}
    out = tmp_path / "snapshot.json"
    write_snapshot(public_snapshot(snap), out)
    text = out.read_text(encoding="utf-8")
    assert [e for e in EMAIL_RE.findall(text) if "***@" not in e] == []
    assert PHONE_RE.findall(text) == []
    assert "maria.delgado" not in text and "she said yes" not in text and "met at gala" not in text
    x = json.loads(text)["donor_details"]["x"]
    assert (x["email"], x["phone"], x["bio"]) == ("m***@example.com", "***-***-0101", "call ***-***-0102")
    assert snap["donor_details"]["x"]["email"] == "maria.delgado@example.com"     # the mirror itself is untouched
