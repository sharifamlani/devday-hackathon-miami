"""c9 evaluator: walk the demo screens, recording console errors and 4xx/5xx per screen."""
import sys
from playwright.sync_api import sync_playwright
BASE, LABEL, S = sys.argv[1].rstrip("/"), sys.argv[2], sys.argv[3]
SCREENS = [("home", "/"), ("donor list", "/#/contacts"), ("donor page", "/#/contacts/3/show"),
           ("organizations", "/#/companies"), ("campaigns", "/#/campaigns"), ("ask page", "/#/ask")]
with sync_playwright() as p:
    b = p.chromium.launch(); pg = b.new_page(viewport={"width": 1440, "height": 1000})
    errs, bad = [], []
    pg.on("console", lambda m: m.type == "error" and errs.append(m.text[:150]))
    pg.on("pageerror", lambda e: errs.append("pageerror: " + str(e)[:150]))
    pg.on("response", lambda r: r.status >= 400 and bad.append(f"{r.status} {r.request.method} {r.url[:100]}"))
    pg.goto(BASE + "/"); pg.wait_for_timeout(4000)
    onb = pg.locator(".onb-screen")
    if onb.count() and onb.first.is_visible():
        btn = onb.first.get_by_role("button", name="Finish later")
        if btn.count(): btn.click(); pg.wait_for_timeout(1000)
    total_e, total_b = 0, 0
    for name, path in SCREENS:
        errs.clear(); bad.clear()
        pg.goto(BASE + path); pg.wait_for_timeout(3500)
        if name == "home":
            side = pg.get_by_label("Open Ask sidebar")
            if side.count():
                side.first.click(); pg.wait_for_timeout(1500)
        pg.screenshot(path=f"{S}/evidence/demo_{LABEL}_{name.replace(' ', '_')}.png")
        total_e += len(errs); total_b += len(bad)
        print(f"[{LABEL}] {name:14s} console errors {len(errs)} {errs[:2]} | 4xx/5xx {len(bad)} {bad[:3]}")
    print(f"[{LABEL}] TOTAL console errors {total_e} | 4xx/5xx {total_b}")
    b.close()
