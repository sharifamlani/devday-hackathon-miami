"""c9 evaluator: the real first-run onboarding in a browser, on an empty database."""
import re, sys, time
from pathlib import Path
from playwright.sync_api import sync_playwright
S, E = Path(sys.argv[1]), Path(sys.argv[2])
files = [str(p) for p in sorted((E / "data/sample_inputs").iterdir()) if p.suffix in (".xlsx", ".docx", ".md", ".csv") and not p.name.startswith("_")]
errors, bad = [], []
def step_text(pg):
    d = pg.locator(".onb-screen")
    return d.first.inner_text()[:400].replace("\n", " | ") if d.count() and d.first.is_visible() else "(no onboarding dialog)"
with sync_playwright() as p:
    b = p.chromium.launch(); pg = b.new_page(viewport={"width": 1440, "height": 900})
    pg.on("console", lambda m: m.type == "error" and errors.append(m.text[:160]))
    pg.on("response", lambda r: r.status >= 400 and bad.append(f"{r.status} {r.request.method} {r.url[:90]}"))
    pg.goto("http://localhost:5181/"); pg.wait_for_timeout(4000)
    print(f"{len(files)} files; step:", step_text(pg)[:120])
    pg.locator(".onb-screen input[type=file]").set_input_files(files); pg.wait_for_timeout(1500)
    t = time.time(); pg.get_by_role("button", name=re.compile(r"^Import \d+ files?$")).click()
    for i in range(150):                                   # the import runs the model; wait for the step to change
        txt = step_text(pg)
        if "Step 2" in txt or "Step 3" in txt or "(no onboarding" in txt: break
        cont = pg.locator(".onb-screen button").filter(has_text=re.compile(r"^(Continue|Next)$"))
        if cont.count() and cont.last.is_enabled(): print(f"  import done ({time.time()-t:.0f}s):", txt[:300]); cont.last.click(); pg.wait_for_timeout(1500); continue
        if i % 15 == 0: print(f"  ...{time.time()-t:.0f}s:", txt[:160])
        pg.wait_for_timeout(2000)
    print(f"after upload ({time.time()-t:.0f}s):", step_text(pg)[:400])
    pg.screenshot(path=str(S / "evidence/fr1_after_upload.png"))
    web = pg.locator(".onb-screen input[type=url], .onb-screen input[name*=web i], .onb-screen input[placeholder*=http i], .onb-screen input[placeholder*=website i]")
    if web.count():
        web.first.fill("https://www.miamifoundation.org"); t = time.time()
        pg.get_by_role("button", name=re.compile("Continue|Read|Next|Save", re.I)).last.click()
        for _ in range(120):
            txt = step_text(pg)
            if "Step 3" in txt or "(no onboarding" in txt: break
            pg.wait_for_timeout(2000)
        print(f"after website ({time.time()-t:.0f}s):", step_text(pg)[:400])
        pg.screenshot(path=str(S / "evidence/fr2_after_website.png"))
    t = time.time()
    for _ in range(90):                                    # let step 3 finish on its own (no early click)
        txt = step_text(pg)
        if "(no onboarding" in txt or not re.search(r"Reading|Searching|Building", txt): break
        pg.wait_for_timeout(2000)
    print(f"step 3 settled ({time.time()-t:.0f}s):", step_text(pg)[:500])
    pg.screenshot(path=str(S / "evidence/fr2b_step3_done.png"))
    for _ in range(3):                                     # finish whatever remains
        btn = pg.locator(".onb-screen button").filter(has_text=re.compile("Go to|Done|Open|Continue|Start|See|dashboard", re.I))
        if not (pg.locator(".onb-screen").count() and pg.locator(".onb-screen").first.is_visible()) or not btn.count(): break
        print("clicking:", btn.last.inner_text()[:40]); btn.last.click(); pg.wait_for_timeout(4000)
    pg.wait_for_timeout(4000)
    pg.screenshot(path=str(S / "evidence/fr3_dashboard.png"), full_page=True)
    print("DASHBOARD:", pg.inner_text("body")[:1600].replace("\n", " | "))
    print("console errors:", errors[:8]); print("4xx/5xx:", bad[:8])
    b.close()
