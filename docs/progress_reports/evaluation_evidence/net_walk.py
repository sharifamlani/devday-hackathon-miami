import re, sys
from urllib.parse import urlparse
from dotenv import dotenv_values
from playwright.sync_api import sync_playwright
S, envf = sys.argv[1], sys.argv[2]
key = (dotenv_values(envf).get("GEMINI_API_KEY") or "").strip()
reqs, sockets, frames_with_key = [], [], 0
with sync_playwright() as p:
    b = p.chromium.launch(args=["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream",
                                f"--use-file-for-fake-audio-capture={S}/read20.wav"])
    pg = b.new_page(viewport={"width": 1440, "height": 900})
    pg.on("request", lambda r: reqs.append((r.method, r.url, r.headers, r.post_data or "")))
    pg.on("websocket", lambda ws: sockets.append(ws.url))
    pg.goto("http://localhost:5181/"); pg.wait_for_timeout(5000)
    onb = pg.locator(".onb-screen")
    if onb.count() and onb.first.is_visible():
        btns = [x for x in onb.first.locator("button").all() if re.search(r"finish later|skip|not now|close|later", (x.inner_text() or x.get_attribute("aria-label") or ""), re.I)]
        print("onboarding buttons matched:", [x.inner_text() or x.get_attribute("aria-label") for x in btns])
        if btns: btns[0].click(); pg.wait_for_timeout(1500)
    print("onboarding still visible:", onb.count() > 0 and onb.first.is_visible())
    try:
        pg.get_by_label("Open Ask sidebar").first.click(timeout=5000); pg.wait_for_timeout(1500)
        side = [x.evaluate("e => (e.getAttribute('aria-label') || e.innerText || '').trim().slice(0, 30)") for x in pg.locator("#ask-sidebar button").all()]
        print("sidebar buttons:", [t for t in side if t][:25])
        start = [x for x in pg.locator("#ask-sidebar button").all() if re.search(r"call note|start|record|mic", x.evaluate("e => (e.getAttribute('aria-label') || e.innerText || '')"), re.I)]
        if start:
            start[0].click(); pg.wait_for_timeout(1500)
            more = [x for x in pg.locator("button").all() if re.search(r"^(start|start recording|start listening|record)$", (x.inner_text() or x.get_attribute("aria-label") or "").strip(), re.I)]
            print("start controls:", [x.inner_text() or x.get_attribute("aria-label") for x in more][:5])
            if more: more[0].click(); pg.wait_for_timeout(12000)
            pg.screenshot(path=f"{S}/evidence/12_voice_pane.png")
    except Exception as e:
        print("sidebar step skipped:", type(e).__name__, str(e)[:120])
    b.close()
hosts = sorted({urlparse(u).netloc for _, u, _, _ in reqs} | {urlparse(u).netloc for u in sockets})
leak = sum(1 for m, u, h, d in reqs if key and (key in u or key in d or any(key in v for v in h.values())))
print(f"requests: {len(reqs)} | websockets: {sockets}")
print(f"hosts contacted: {hosts}")
print(f"requests carrying the Gemini key (url, headers or body): {leak} | requests to Google API hosts: {sum(1 for _, u, _, _ in reqs if 'googleapis' in u or 'generativelanguage' in u)}")
