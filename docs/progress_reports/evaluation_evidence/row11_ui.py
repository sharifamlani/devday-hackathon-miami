"""c9 row 11 UI: home chat write -> step card + Undo; panel updates without reload; delete -> approval card -> Approve."""
import json, re, time, urllib.request
from playwright.sync_api import sync_playwright
api = lambda p: json.load(urllib.request.urlopen("http://localhost:8017" + p))
TITLE = "c9 row11 call Priya"
errors, bad = [], []
with sync_playwright() as p:
    b = p.chromium.launch(); pg = b.new_page(viewport={"width": 1440, "height": 1000})
    pg.on("console", lambda m: m.type == "error" and errors.append(m.text[:150]))
    pg.on("pageerror", lambda e: errors.append("pageerror " + str(e)[:150]))
    pg.on("response", lambda r: r.status >= 400 and bad.append(f"{r.status} {r.url[:90]}"))
    pg.goto("http://localhost:5193/"); pg.wait_for_timeout(4000)
    onb = pg.locator(".onb-screen")
    if onb.count() and onb.first.is_visible(): onb.first.get_by_role("button", name="Finish later").click(); pg.wait_for_timeout(1200)
    def ask(msg, until, limit=120):
        box = pg.get_by_placeholder(re.compile("Ask the agent", re.I)).first; box.fill(msg); box.press("Enter")
        t = time.time()
        while time.time() - t < limit and not until(): pg.wait_for_timeout(2000)
        return time.time() - t
    # 1. a write: create a task -> step card with Undo; the home Tasks panel shows it without a reload
    secs = ask(f"Create a call task for Priya Raman titled '{TITLE}' due today.", lambda: any(t["title"] == TITLE for t in api("/tasks")))
    pg.wait_for_timeout(2500)
    task = next((t for t in api("/tasks") if t["title"] == TITLE), None)
    undo_btns = [x for x in pg.get_by_role("button", name="Undo").all() if x.is_visible()]
    print(f"1. write: task in API after {secs:.0f}s: {bool(task)} | Undo buttons on step cards: {len(undo_btns)} | Tasks panel shows it (no reload): {TITLE in pg.inner_text('body')}")
    pg.screenshot(path=r"C:/Users/Shari/AppData/Local/Temp/claude/c--Users-Shari-Dropbox--Personal--GenAI-Company-Projects-devday-hackathon/776d32ad-563f-4806-b5f0-7ea5b7e006e8/scratchpad/evidence/row11_1_write.png", full_page=True)
    if undo_btns:
        undo_btns[-1].click(); pg.wait_for_timeout(3000)
        print(f"   Undo: task still in API: {any(t['title'] == TITLE for t in api('/tasks'))} | card shows 'Undone': {'Undone' in pg.inner_text('body')} | panel still shows it: {pg.locator('text=' + TITLE).count() > 0 and 'Undone' not in pg.inner_text('body')}")
    # 2. a delete needs a click: approval card, nothing deleted until Approve
    victim = next(t for t in api("/tasks?due=today") if t["kind"] == "review")
    ask(f"Delete task {victim['id']}.", lambda: any(x.is_visible() for x in pg.get_by_role("button", name=re.compile(r"^Approve")).all()))
    still = any(t["id"] == victim["id"] for t in api("/tasks"))
    print(f"2. delete task {victim['id']}: approval card shown: {any(x.is_visible() for x in pg.get_by_role('button', name=re.compile(r'^Approve')).all())} | task untouched before click: {still}")
    pg.screenshot(path=r"C:/Users/Shari/AppData/Local/Temp/claude/c--Users-Shari-Dropbox--Personal--GenAI-Company-Projects-devday-hackathon/776d32ad-563f-4806-b5f0-7ea5b7e006e8/scratchpad/evidence/row11_2_approval.png", full_page=True)
    ap = [x for x in pg.get_by_role("button", name=re.compile(r"^Approve")).all() if x.is_visible()]
    if ap:
        ap[0].click(); t = time.time()
        while time.time() - t < 90 and any(x["id"] == victim["id"] for x in api("/tasks")): pg.wait_for_timeout(2000)
        print(f"   Approve: task deleted in API: {not any(x['id'] == victim['id'] for x in api('/tasks'))} after {time.time()-t:.0f}s | card says Approved: {'Approved' in pg.inner_text('body')}")
    b.close()
print("console errors:", errors[:5]); print("4xx/5xx:", bad[:5])
