"""c9 regression: create a task on a donor page -> it shows on the home -> complete it on the home -> done on the donor page."""
import json, re, sys, urllib.request
from playwright.sync_api import sync_playwright
S, DID = sys.argv[1], int(sys.argv[2]); TITLE = "Thank Priya for the November gift c9"
api = lambda path: json.load(urllib.request.urlopen("http://localhost:8016" + path))
errors, bad = [], []
with sync_playwright() as p:
    b = p.chromium.launch(); pg = b.new_page(viewport={"width": 1440, "height": 1000})
    pg.on("console", lambda m: m.type == "error" and errors.append(m.text[:160]))
    pg.on("response", lambda r: r.status >= 400 and bad.append(f"{r.status} {r.request.method} {r.url[:90]}"))
    pg.goto("http://localhost:5181/"); pg.wait_for_timeout(4000)
    onb = pg.locator(".onb-screen")
    print("0. onboarding shown over a populated db in a new browser:", onb.count() > 0 and onb.first.is_visible())
    if onb.count() and onb.first.is_visible(): onb.first.get_by_role("button", name="Finish later").click(); pg.wait_for_timeout(1500)
    pg.goto(f"http://localhost:5181/#/contacts/{DID}/show"); pg.wait_for_timeout(4000)
    pg.get_by_role("button", name="Add task").first.click(); pg.wait_for_timeout(1000)
    d = pg.get_by_role("dialog")
    d.locator("textarea[name=text]").fill(TITLE); d.locator("input[name=due_date]").fill("2026-11-08T11:00")
    d.get_by_role("combobox").click(); pg.wait_for_timeout(400); pg.get_by_role("option", name="Call").first.click()
    d.get_by_role("button", name="Save").click(); pg.wait_for_timeout(2000)
    mine = [t for t in api("/tasks?due=today") if t["title"] == TITLE]
    print("1. created on donor page -> GET /tasks?due=today:", [(t["id"], t["person_id"], t["done"]) for t in mine])
    pg.goto("http://localhost:5181/"); pg.wait_for_timeout(5000)
    task = pg.get_by_text(TITLE).first
    print("2. home shows the task:", task.count() > 0 and task.is_visible())
    pg.screenshot(path=f"{S}/evidence/reg1_home_with_task.png", full_page=True)
    task.click(); pg.wait_for_timeout(1500)
    dlg = pg.locator("[role=dialog]:visible").first
    print("   task details:", " | ".join(dlg.inner_text()[:160].splitlines()))
    dlg.get_by_role("button", name="Mark done").click(); pg.wait_for_timeout(2500)
    mine = [t for t in api("/tasks?due=today") if t["title"] == TITLE]
    print("3. completed on home -> GET /tasks?due=today:", [(t["id"], t["done"]) for t in mine])
    pg.screenshot(path=f"{S}/evidence/reg2_home_after_done.png", full_page=True)
    pg.goto(f"http://localhost:5181/#/contacts/{DID}/show"); pg.wait_for_timeout(3500)
    pg.get_by_role("tab", name="Tasks").first.click(); pg.wait_for_timeout(1500)
    item = pg.get_by_text(TITLE).first.locator("xpath=ancestor::*[.//input[@type='checkbox'] or .//*[@role='checkbox']][1]")
    cb = item.locator("input[type=checkbox], [role=checkbox]").first
    print("4. donor page Tasks tab shows it done:", cb.evaluate("e => e.checked ?? e.getAttribute('aria-checked') ?? e.getAttribute('data-state')"))
    pg.screenshot(path=f"{S}/evidence/reg3_donor_done.png")
    print("console errors:", errors[:6]); print("4xx/5xx:", bad[:6]); b.close()
