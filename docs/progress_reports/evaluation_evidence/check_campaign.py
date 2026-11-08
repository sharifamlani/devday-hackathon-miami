"""c9 evaluator: check the newest campaign's drafts cite all three story kinds and invent no figures."""
import os, re, json, sqlite3
from fastapi.testclient import TestClient
from service.main import app
conn = sqlite3.connect(os.environ["DONORS_DB"]); conn.row_factory = sqlite3.Row
cid = conn.execute("select max(id) from campaigns").fetchone()[0]
with TestClient(app) as c:
    camp = c.get(f"/campaigns/{cid}").json()
msgs = camp.get("messages") or []
print(f"campaign {cid}: {len(msgs)} drafts; message keys: {sorted(msgs[0]) if msgs else None}")
num = re.compile(r"\$?\d[\d,]*(?:\.\d+)?%?")
need = {"success_story", "use_of_funds", "org_health"}
allok, flagged = 0, []
for m in msgs:
    used = m.get("facts_used") or []
    used = json.loads(used) if isinstance(used, str) else used
    srcs = m.get("sources") or []
    kinds = {s.get("kind") for s in srcs if isinstance(s, dict)} | {u.get("kind") for u in used if isinstance(u, dict)}
    ok = need <= kinds
    allok += ok
    gifts = " ".join(f"{g['amount']} {g['gift_date']}" for g in conn.execute(
        "select amount, gift_date from gifts where donor_id = ?", (m["donor_id"],)))
    hay = (json.dumps(used) + json.dumps(srcs) + " " + gifts).replace(",", "")
    figs = [f for f in num.findall(m.get("body") or "") if len(re.sub(r"\D", "", f)) >= 2]
    norm = lambda f: f.replace("$", "").replace(",", "").rstrip("%").rstrip(".")
    missing = [f for f in figs if norm(f) not in hay and norm(f).split(".")[0] not in hay]
    if missing:
        flagged.append((m["donor_id"], missing))
    print(f"--- donor {m['donor_id']}: kinds {sorted(k for k in kinds if k)} -> all three: {ok}; figures {figs}; not in cited facts or gifts: {missing}")
    print("    subject:", m.get("subject"))
    print("    body:", (m.get("body") or "").replace("\n", " / ")[:900])
print(f"SUMMARY: {allok}/{len(msgs)} drafts cite all three kinds; drafts with unmatched figures: {flagged}")
