"""c9 evaluator: agent write tools through POST /chat (live model), each checked in SQL, then undone."""
import json, os, sqlite3, sys, httpx
DB = os.environ["DONORS_DB"]; api = httpx.Client(base_url="http://127.0.0.1:8016", timeout=240)
sql = lambda q, *a: sqlite3.connect(DB).execute(q, a).fetchall()
pid = sql("select id from donors where full_name='Priya Raman'")[0][0]
gmd = sql("select id from events where title='Give Miami Day'")[0][0]
# Priya must be in Give Miami Day's audience for an RSVP
aud = sql("select count(*) from event_audience where event_id=? and person_id=?", gmd, pid)[0][0]
def chat(msg, tab="givers"):
    r = api.post("/chat", json={"message": msg, "tab": tab, "context": {"screen": "home"}})
    b = r.json(); steps = b.get("steps") or []
    return r.status_code, b, [(s.get("tool"), s.get("status"), (s.get("summary") or "")[:70], bool(s.get("undo_token"))) for s in steps]
def undo_all(b):
    out = []
    for s in b.get("steps") or []:
        if s.get("undo_token"):
            out.append(api.post(f"/undo/{s['undo_token']}").status_code)
    return out
res = {}
cases = [
  ("update_person", f"Set the city of person id {pid} to Hialeah.", lambda: sql("select city from donors where id=?", pid)[0][0]),
  ("create_task", f"Create a call task for person id {pid} titled 'c9 agent task' due 2026-11-09.", lambda: sql("select count(*) from tasks where title='c9 agent task' and deleted_at is null")[0][0]),
  ("add_calendar_item", "Add a calendar item 'c9 board prep' on 2026-11-12 at 10:00.", lambda: sql("select count(*) from tasks where title='c9 board prep' and deleted_at is null")[0][0]),
  ("add_contact", "Add a new contact named 'Ximena Castellano-Ruiz', an individual giver in Miami.", lambda: sql("select count(*) from donors where full_name='Ximena Castellano-Ruiz'")[0][0]),
  ("rsvp_event", f"RSVP person id {pid} as yes to event id {gmd}.", lambda: sql("select rsvp from event_audience where event_id=? and person_id=?", gmd, pid)),
]
print(f"Priya id {pid}; Give Miami Day event {gmd}; Priya in its audience: {bool(aud)}")
for tool, msg, probe in cases:
    before = probe(); code, b, steps = chat(msg); after = probe()
    used = [s for s in steps if s[0] == tool]
    undo = undo_all(b); restored = probe()
    print(f"[{tool}] HTTP {code} | steps {steps} | db before {before} -> after {after} | undo {undo} -> {restored}")
for tool, msg in (("delete_task", "Delete task 22."), ("merge_duplicate", "Merge duplicate suggestion 1, keep the first record.")):
    before = sql("select count(*) from tasks where deleted_at is null")[0][0], sql("select count(*) from duplicate_suggestions where status='pending'")[0][0]
    code, b, steps = chat(msg)
    after = sql("select count(*) from tasks where deleted_at is null")[0][0], sql("select count(*) from duplicate_suggestions where status='pending'")[0][0]
    print(f"[{tool}] HTTP {code} | steps {steps} | approvals pending {[a.get('tool') for a in (b.get('approvals') or [])]} | (open tasks, pending dups) before {before} -> after {after} (unchanged = waited for a click)")
