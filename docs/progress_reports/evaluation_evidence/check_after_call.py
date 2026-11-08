"""c9 evaluator: 3 live (model) runs of the after-call agent on the demo transcript, then one Apply."""
import json, os, sys, tempfile
from collections import Counter
from pathlib import Path
from dotenv import load_dotenv
load_dotenv(sys.argv[1])
os.environ.pop("AFTER_CALL_DRAFTER", None)
from service.tests import test_after_call as t
from service import after_call_agent as aca, db
WANT = {"create_task": 1, "record_pledge": 1, "rsvp_event": 1, "add_context_note": 2}
for run in (1, 2, 3):
    tmp = Path(tempfile.mkdtemp()); os.environ["DONORS_DB"] = str(tmp / "d.db"); os.environ["SCORE_AS_OF"] = t.TODAY.isoformat()
    aca.PROPOSALS_FILE = tmp / "proposals.json"; aca._PROPOSALS.clear()
    gen = t.env.__wrapped__(tmp, type("MP", (), {"setenv": staticmethod(lambda k, v: os.environ.__setitem__(k, v)),
                                                  "setattr": staticmethod(lambda o, n, v: setattr(o, n, v))})())
    conn, rosa, beach = next(gen)
    os.environ.pop("AFTER_CALL_DRAFTER", None)              # the fixture sets "rules" when it runs; this run uses the model
    before = t.counts(conn)
    got = aca.propose(conn, "note-1", t.TODAY)
    types = Counter(a["type"] for a in got["actions"])
    pledge = next((a["payload"] for a in got["actions"] if a["type"] == "record_pledge"), {})
    rsvp = next((a["payload"] for a in got["actions"] if a["type"] == "rsvp_event"), {})
    after_propose = t.counts(conn)
    exact = dict(types) == WANT and (pledge.get("amount"), pledge.get("frequency")) == (50.0, "monthly") and rsvp.get("event_id") == beach
    print(f"run {run}: drafted_by={got.get('drafted_by')} actions={dict(types)} pledge={pledge.get('amount')}/{pledge.get('frequency')} rsvp_event={'beach' if rsvp.get('event_id') == beach else rsvp.get('event_id')} | writes before Apply: {after_propose != before} | exact: {exact}")
    if run == 3:
        applied = aca.apply(conn, "note-1", [a["id"] for a in got["actions"]])
        print("run 3 Apply ->", t.counts(conn))
    conn.close()
