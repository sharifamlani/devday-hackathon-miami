"""Measure the Home workspace-panel zoom: geometry, frame gaps, CLS, console errors.

Usage:
    python scripts/verify_home_zoom.py http://localhost:5182 --shots <dir>

Needs the dev build (`cd web && npm run dev:demo -- --port 5182`): it drives the panels through
`window.__desk` (exposed in dev builds only). Opens the app at `/#/` (react-admin uses a
HashRouter) so the landing page is skipped. Headed Chromium, so frame timing is real.
One line per view+size; exits non-zero on any FAIL.
"""

import argparse
import sys
from pathlib import Path

from playwright.sync_api import Page, sync_playwright

# Keeps the environment from throttling rAF/timers (idle should read ~16.7ms; see idle_baseline()).
LAUNCH_ARGS = [
    "--disable-background-timer-throttling",
    "--disable-renderer-backgrounding",
    "--disable-backgrounding-occluded-windows",
    "--force-device-scale-factor=1",
]
# Real GPU raster/compositing; software rendering (SwiftShader) makes every frame slow.
GPU_ARGS = ["--ignore-gpu-blocklist", "--enable-gpu-rasterization"]
VIEWS = ["calendar", "crm", "tasks", "impact"]
SIZES = [(1440, 900), (1366, 768)]
CYCLES = 10
OPEN_MS, CLOSE_MS = 320, 280  # --duration-slow and 0.875 of it (src/index.css, home/zoomTransition.ts)
LIMITS = {"ratio": (0.63, 0.70), "chat_min": 380, "p95": 17.5, "max": 34.0}

# Records rAF timestamps until stopped; returns the frame gaps (ms).
RECORDER = """
() => {
  window.__rec = { ts: [], on: true };
  const tick = (t) => { if (!window.__rec.on) return; window.__rec.ts.push(t); requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
}
"""
STOP = """
() => { window.__rec.on = false; const t = window.__rec.ts; return t.slice(1).map((v, i) => v - t[i]); }
"""
CLS_OBSERVER = """
() => {
  window.__cls = 0;
  new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__cls += e.value; })
    .observe({ type: 'layout-shift', buffered: false });
}
"""
GEOMETRY = """
() => {
  const panel = document.querySelector('.desk-main-panel');
  const chat = document.querySelector('.home-conversation');
  const rail = document.querySelector('.home-workspace-controls');
  const railRight = rail ? rail.getBoundingClientRect().right : 0;
  const p = panel ? panel.getBoundingClientRect() : null;
  const c = chat && chat.offsetParent !== null ? chat.getBoundingClientRect() : null;
  return { vw: innerWidth, pw: p ? p.width : 0, cw: c ? c.width : 0, space: innerWidth - railRight,
           view: new URLSearchParams(location.hash.split('?')[1] || '').get('workspace'), has: !!panel };
}
"""


def print_renderer(browser, base):
    """Print the WebGL renderer + browser version, so a software-rendered run is obvious."""
    page = browser.new_page()
    page.goto("about:blank")
    r = page.evaluate(
        """() => { const gl = document.createElement('canvas').getContext('webgl');
        if (!gl) return 'no webgl'; const e = gl.getExtension('WEBGL_debug_renderer_info');
        return e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : 'unknown'; }"""
    )
    print(f"browser {browser.version} renderer: {r}")
    page.close()


IDLE = {"p95": 0.0, "max": 0.0}


def idle_baseline(browser, base):
    """rAF gaps over 3s with no transition. If this is not ~16.7ms the machine caps rAF."""
    errors: list[str] = []
    ctx, page = fresh(browser, base, 1440, 900, errors)
    page.bring_to_front()
    page.evaluate(RECORDER)
    page.wait_for_timeout(3000)
    gaps = page.evaluate(STOP)
    ctx.close()
    IDLE.update(p95=p95(gaps), max=max(gaps or [0]))
    print(f"idle baseline (no transition, 3s): p95={IDLE['p95']:.1f} max={IDLE['max']:.1f}")


def frames_measurable():
    return IDLE["p95"] <= 25.0


def p95(xs):
    xs = sorted(xs)
    return xs[min(len(xs) - 1, int(round(0.95 * (len(xs) - 1))))] if xs else 0.0


def fresh(browser, base, w, h, errors, reduced=False, hash_="/?onboarding=0"):
    ctx = browser.new_context(
        viewport={"width": w, "height": h},
        reduced_motion="reduce" if reduced else "no-preference",
    )
    page = ctx.new_page()
    page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto(f"{base}/#{hash_}")
    page.wait_for_function("window.__desk", timeout=90000)
    page.wait_for_timeout(1500)
    return ctx, page


def measure(browser, base, view, w, h, shots: Path):
    errors: list[str] = []
    ctx, page = fresh(browser, base, w, h, errors)
    gaps: list[float] = []
    geo = {}
    cls = 0.0
    cycle_max: list[float] = []
    mount: list[float] = []
    for i in range(CYCLES):
        page.evaluate(RECORDER)
        page.evaluate(f"window.__desk.openWorkspace('{view}')")
        if i == 0:
            page.wait_for_timeout(120)
            page.screenshot(path=str(shots / f"{view}-{w}x{h}-mid.png"))
        page.wait_for_timeout(OPEN_MS + 60)
        g1 = page.evaluate(STOP)  # frame gaps while the zoom animates
        page.evaluate(RECORDER)
        page.wait_for_timeout(700)
        mount.append(max(page.evaluate(STOP) or [0]))  # then the panel content mounts
        page.evaluate("window.__cls = 0")  # CLS is counted from here: after the zoom has settled
        page.wait_for_timeout(500)
        if i >= 1:
            cls += page.evaluate("window.__cls")
        if i == 0:
            geo = page.evaluate(GEOMETRY)
            page.screenshot(path=str(shots / f"{view}-{w}x{h}-settled.png"))
        page.evaluate(CLS_OBSERVER) if i == 0 else None
        page.evaluate(RECORDER)
        page.evaluate("window.__desk.closeWorkspace()")
        page.wait_for_timeout(CLOSE_MS + 60)
        g2 = page.evaluate(STOP)
        page.wait_for_timeout(300)
        page.evaluate("window.__cls = 0")
        page.wait_for_timeout(400)
        if i >= 1:
            cls += page.evaluate("window.__cls")
        # the first open also pays for data fetches and module load: report it, but judge the rest
        cycle_max.append(max(g1 + g2 or [0]))
        if i >= 1:
            gaps += g1 + g2
    cls = round(cls, 4)
    ctx.close()
    ratio = geo["pw"] / geo["space"] if geo.get("space") else 0
    lo, hi = LIMITS["ratio"]
    ok = (
        lo <= ratio <= hi
        and geo["pw"] / geo["vw"] >= 0.63
        and geo["cw"] >= LIMITS["chat_min"]
        and (not frames_measurable() or (p95(gaps) <= LIMITS["p95"] and max(gaps or [0]) <= LIMITS["max"]))
        and cls == 0
        and not errors
    )
    idle_p95 = IDLE["p95"]
    note = "" if frames_measurable() else f" [frames NOT MEASURABLE: env rAF cap, idle p95={idle_p95:.1f}]"
    print(
        f"{view} {w}x{h} ratio={ratio:.2f} vs_viewport={geo['pw']/geo['vw']:.3f} chat={geo['cw']:.0f} p95={p95(gaps):.1f} "
        f"max={max(gaps or [0]):.1f} cls={cls:g} console={len(errors)} {'PASS' if ok else 'FAIL'}"
        f"{note}"
        f"  (cold first cycle max={cycle_max[0]:.0f}ms; content mount after the zoom: worst gap {max(mount[1:]):.0f}ms)"
    )
    for e in errors[:3]:
        print("   console:", e[:200])
    return ok


TILE_SEL = {"calendar": ".home-agenda", "tasks": '[data-tour="tasks"]', "crm": '[data-tour="crm"]', "impact": ".home-overview > section:first-child"}

# Samples the animated card's rect every frame: the real panel (open) or the ghost frame (close).
SHAPE_JS = """
async ([kind, view, sel, dur]) => {
  const tile = document.querySelector(sel);
  tile.scrollIntoView({ block: 'nearest', behavior: 'instant' });
  const rect = (el) => { const r = el.getBoundingClientRect(); return [r.left, r.top, r.width, r.height]; };
  const tileBefore = rect(tile);
  const panelBefore = document.querySelector('.desk-main-panel') ? rect(document.querySelector('.desk-main-panel')) : null;
  const samples = [];
  const bad = [];
  const chat = document.querySelector('.home-conversation');
  const chain = []; for (let e = chat; e; e = e.parentElement) chain.push(e);
  // a horizontal scrollbar can come from the page or from any scrollable ancestor of the chat
  const overflow = () => {
    if (document.scrollingElement.scrollWidth > innerWidth) return 'page ' + document.scrollingElement.scrollWidth;
    for (const e of chain) {
      const ox = getComputedStyle(e).overflowX;
      if ((ox === 'auto' || ox === 'scroll') && e.scrollWidth > e.clientWidth + 1) return e.className + ' ' + e.scrollWidth;
    }
    return null;
  };
  let on = true;
  const t0 = performance.now();
  const tick = () => {
    if (!on) return;
    const o = overflow(); if (o) bad.push(o);
    const el = kind === 'open' ? document.querySelector('.desk-main-panel') : document.querySelector('[data-zoom-ghost]');
    if (el) {
      // animation time (not wall time): the card starts moving a couple of frames after the call
      const a = el.getAnimations().find((x) => x.effect.getKeyframes().some((k) => k.transform && k.transform !== 'none') || (x.effect.getKeyframes().length && x.effect.getKeyframes()[0].transform));
      samples.push([a ? Number(a.currentTime) : performance.now() - t0, rect(el)]);
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  if (kind === 'open') window.__desk.openWorkspace(view); else window.__desk.closeWorkspace();
  await new Promise((r) => setTimeout(r, dur + 250));
  on = false;
  const panelAfter = document.querySelector('.desk-main-panel') ? rect(document.querySelector('.desk-main-panel')) : null;
  return { bad, samples, tileBefore, tileAfter: rect(document.querySelector(sel)), panelBefore, panelAfter };
}
"""


def between(v, a, b, slack=1.0):
    lo, hi = min(a, b), max(a, b)
    return lo + slack < v < hi - slack


def check_shape(browser, base):
    """Open must GROW out of the tile and close must SHRINK back into it (not fade/snap):
    at ~50% of the animation the card is strictly between the tile box and the panel box in
    width and height; at the end of a close the frame sits on the tile box (+-2px)."""
    ok_all = True
    errors: list[str] = []
    ctx, page = fresh(browser, base, 1440, 900, errors)
    for view in VIEWS:  # warm-up: the first open of a view loads data and modules
        page.evaluate(f"window.__desk.openWorkspace('{view}')")
        page.wait_for_timeout(1200)
        page.evaluate("window.__desk.closeWorkspace()")
        page.wait_for_timeout(900)
    for view in VIEWS:
        sel = TILE_SEL[view]
        for kind, dur in (("open", OPEN_MS), ("close", CLOSE_MS)):
            page.evaluate("window.scrollTo(0,0)")
            r = page.evaluate(SHAPE_JS, [kind, view, sel, dur])
            page.wait_for_timeout(700)
            smp = r["samples"]
            if not smp:
                print(f"shape {kind} {view}: no card samples FAIL")
                ok_all = False
                continue
            mid = min(smp, key=lambda s: abs(s[0] - dur * 0.5))[1]
            if kind == "open":
                a, b = r["tileBefore"], r["panelAfter"]
                first = smp[0][1]
            else:
                a, b = r["panelBefore"], r["tileAfter"]
                first = smp[0][1]
            grows = between(mid[2], a[2], b[2]) and between(mid[3], a[3], b[3])
            last = smp[-1][1]
            end_ref = r["tileAfter"] if kind == "close" else r["panelAfter"]
            tol = 2.5
            ends = all(abs(last[i] - end_ref[i]) <= tol for i in range(4)) if kind == "close" else True
            ok = grows and ends and not r["bad"]
            ok_all &= ok
            word = "grows" if kind == "open" else "shrinks"
            print(
                f"shape {kind} {view}: mid w={mid[2]:.0f} h={mid[3]:.0f} between w {a[2]:.0f}->{b[2]:.0f} h {a[3]:.0f}->{b[3]:.0f} "
                f"({word}={grows}); last ghost vs tile dx={last[0]-end_ref[0]:.1f} dy={last[1]-end_ref[1]:.1f} dw={last[2]-end_ref[2]:.1f} dh={last[3]-end_ref[3]:.1f} "
                f"hscroll_frames={len(r['bad'])} {'PASS' if ok else 'FAIL'}"
            )
    ctx.close()
    return ok_all


def check_double_toggle(browser, base):
    """Alt+T twice, fast, 10 times: the URL and the panel agree and end closed every time (a stale
    request used to strand the panel open); then Esc ~40 ms after an open closes it."""
    errors: list[str] = []
    ctx, page = fresh(browser, base, 1440, 900, errors)
    ok = True
    stuck = 0
    for i in range(10):
        page.keyboard.press("Alt+KeyT")
        page.wait_for_timeout(15 + (i % 4) * 20)
        page.keyboard.press("Alt+KeyT")
        page.wait_for_timeout(1000)
        g = page.evaluate(GEOMETRY)
        agree = (not g["has"]) and g["view"] is None
        if not agree:
            stuck += 1
            page.evaluate("window.__desk.closeWorkspace()")
            page.wait_for_timeout(600)
    ok &= stuck == 0
    print(f"double-toggle Alt+T x2 10 times: stranded={stuck} {'PASS' if stuck == 0 else 'FAIL'}")
    esc_ok = 0
    for i in range(10):
        page.keyboard.press("Alt+KeyT")
        page.wait_for_timeout(30 + (i % 3) * 25)
        page.keyboard.press("Escape")
        page.wait_for_timeout(1000)
        g = page.evaluate(GEOMETRY)
        if not g["has"] and g["view"] is None:
            esc_ok += 1
        else:
            page.evaluate("window.__desk.closeWorkspace()")
            page.wait_for_timeout(600)
    ok &= esc_ok == 10 and not errors
    print(f"Esc right after open closes: {esc_ok}/10 console={len(errors)} {'PASS' if esc_ok == 10 and not errors else 'FAIL'}")
    ctx.close()
    return ok


def check_rapid(browser, base):
    errors: list[str] = []
    ctx, page = fresh(browser, base, 1440, 900, errors)
    ok = True
    for count in (6, 5):
        for _ in range(count):
            page.evaluate("window.__desk.toggleWorkspace('crm')")
            page.wait_for_timeout(45)
        page.wait_for_timeout(1000)
        g = page.evaluate(GEOMETRY)
        want_open = count % 2 == 1
        good = g["has"] == want_open and (g["view"] == "crm") == want_open
        ok &= good
        print(f"rapid x{count} open={g['has']} url_view={g['view']} expect_open={want_open} {'PASS' if good else 'FAIL'}")
        if g["has"]:
            page.evaluate("window.__desk.closeWorkspace()")
            page.wait_for_timeout(800)
    ok &= not errors
    for e in errors[:3]:
        print("   console:", e[:300])
    print(f"rapid console={len(errors)} {'PASS' if not errors else 'FAIL'}")
    ctx.close()
    return ok


def check_reduced(browser, base):
    errors: list[str] = []
    ctx, page = fresh(browser, base, 1440, 900, errors, reduced=True)
    worst = 0.0
    for fn in ("openWorkspace('crm')", "closeWorkspace()"):
        page.evaluate(
            """() => { window.__worst = 0; window.__t = setInterval(() => {
                for (const a of document.getAnimations()) {
                  const t = a.effect.getComputedTiming();
                  window.__worst = Math.max(window.__worst, t.endTime);
                } }, 8); }"""
        )
        page.evaluate(f"window.__desk.{fn}")
        page.wait_for_timeout(500)
        worst = max(worst, page.evaluate("clearInterval(window.__t), window.__worst"))
    ctx.close()
    ok = worst <= 150 and not errors
    print(f"reduced-motion longest animation={worst:.0f}ms console={len(errors)} {'PASS' if ok else 'FAIL'}")
    return ok


def check_cold_and_back(browser, base):
    errors: list[str] = []
    ctx, page = fresh(browser, base, 1440, 900, errors, hash_="/?onboarding=0&workspace=tasks")
    page.wait_for_selector(".desk-main-panel[data-workspace='tasks']", timeout=15000)
    opened = page.evaluate(GEOMETRY)["has"]
    page.go_back()
    page.wait_for_timeout(900)
    g = page.evaluate(GEOMETRY)
    ok = opened and not g["has"] and not errors
    print(f"cold /?workspace=tasks opened={opened}, history.back closed={not g['has']} console={len(errors)} {'PASS' if ok else 'FAIL'}")
    page.goto(f"{base}/#/?onboarding=0&workspace=bogus")
    page.wait_for_timeout(1500)
    bogus = page.evaluate(GEOMETRY)["has"]
    ok2 = not bogus and not errors
    print(f"bogus workspace panel={bogus} console={len(errors)} {'PASS' if ok2 else 'FAIL'}")
    ctx.close()
    return ok and ok2


PANEL = ".desk-main-panel"


def panel_view(page: Page):
    return page.evaluate(GEOMETRY)


def functional(browser, base, shots: Path):
    """Real clicks on the tiles, close paths, switch, widths, console, CRM data. Returns all-pass."""
    import json
    import urllib.request

    results: list[bool] = []

    def report(name: str, ok: bool, extra: str = ""):
        results.append(ok)
        print(f"{name} {extra} {'PASS' if ok else 'FAIL'}")

    snap = json.load(urllib.request.urlopen(f"{base}/snapshot.json"))
    errors: list[str] = []
    ctx, page = fresh(browser, base, 1440, 900, errors)

    # S1: real click on the CRM tile's "Open database" zooms the CRM panel out of the tile.
    page.get_by_role("link", name="Open database").click()
    page.wait_for_selector(".desk-main-panel[data-workspace='crm']", timeout=5000)
    page.wait_for_timeout(900)
    g = page.evaluate(GEOMETRY)
    ratio = g["pw"] / g["space"]
    report("S1 click Open database", 0.63 <= ratio <= 0.70 and g["cw"] >= 380, f"ratio={ratio:.2f} chat={g['cw']:.0f}")
    page.screenshot(path=str(shots / "S1-crm-settled.png"))
    # CRM data: counts and the auto-merge "!" flags match the snapshot (the API in this build).
    text = page.locator(PANEL).inner_text()
    giver_total = snap["people"]["counts"]["giver"]
    rows = sorted(snap["donors"], key=lambda d: -d["score"])[:25]
    flags_expected = sum(1 for d in rows if d.get("auto_merged"))
    flags_seen = page.locator(f'{PANEL} [aria-label="Merged automatically, review"]').count()
    report("CRM counts", f"{giver_total} donors" in text, f"expect '{giver_total} donors'")
    report("CRM auto-merge flags", flags_seen == flags_expected and flags_seen > 0, f"seen={flags_seen} expected={flags_expected}")
    # Donors first, with the Organizations switch.
    report("CRM switch present", page.locator(f"{PANEL} nav[aria-label='Donors views']").count() == 1)
    page.screenshot(path=str(shots / "S1-crm-settled.png"))

    # S3: Esc closes; click X closes; browser Back closes.
    page.keyboard.press("Escape")
    page.wait_for_timeout(700)
    report("S3 Esc closes", not page.evaluate(GEOMETRY)["has"])
    page.get_by_role("link", name="Open database").click()
    page.wait_for_selector(PANEL, timeout=5000)
    page.wait_for_timeout(700)
    page.get_by_role("button", name="Close workspace panel").click()
    page.wait_for_timeout(700)
    report("S3 close button closes", not page.evaluate(GEOMETRY)["has"])
    page.get_by_role("link", name="Open database").click()
    page.wait_for_selector(PANEL, timeout=5000)
    page.wait_for_timeout(700)
    page.go_back()
    page.wait_for_timeout(900)
    report("S3 browser Back closes", not page.evaluate(GEOMETRY)["has"])

    # S2: real click on the calendar heading, and the arrow link.
    page.locator(".home-calendar-heading h2 a").click()
    page.wait_for_selector(".desk-main-panel[data-workspace='calendar']", timeout=5000)
    page.wait_for_timeout(900)
    g = page.evaluate(GEOMETRY)
    ratio = g["pw"] / g["space"]
    report("S2 click calendar heading", 0.63 <= ratio <= 0.70 and g["cw"] >= 380, f"ratio={ratio:.2f}")
    page.screenshot(path=str(shots / "S2-calendar-settled.png"))

    # S4: switching calendar -> crm keeps the frame element and only swaps the content.
    page.evaluate("document.querySelector('.desk-main-panel').dataset.keep = '1'")
    page.evaluate("window.__desk.openWorkspace('crm')")
    page.wait_for_timeout(900)
    kept = page.evaluate("document.querySelector('.desk-main-panel')?.dataset.keep === '1'")
    report("S4 switch keeps frame", kept and page.evaluate(GEOMETRY)["view"] == "crm")
    page.keyboard.press("Escape")
    page.wait_for_timeout(700)
    page.locator(".home-calendar-tools a[aria-label='Open full calendar']").click()
    page.wait_for_selector(".desk-main-panel[data-workspace='calendar']", timeout=5000)
    report("S2 click calendar arrow", True)
    page.keyboard.press("Escape")
    page.wait_for_timeout(700)
    report("1440 console errors", not errors, f"count={len(errors)}")
    ctx.close()

    # S5: 1100px = full width + Back to chat (chat hidden); 390px = full-screen sheet.
    errors = []
    ctx, page = fresh(browser, base, 1100, 800, errors)
    page.evaluate("window.__desk.openWorkspace('crm')")
    page.wait_for_selector(PANEL, timeout=5000)
    page.wait_for_timeout(900)
    box = page.locator(PANEL).bounding_box()
    chat_visible = page.locator(".home-conversation").is_visible()
    back = page.get_by_role("button", name="Back to chat").is_visible()
    report("S5 1100 full width + Back to chat", back and not chat_visible and box["width"] > 800, f"w={box['width']:.0f}")
    page.screenshot(path=str(shots / "S5-1100.png"))
    ctx.close()
    ctx, page = fresh(browser, base, 390, 844, errors)
    page.evaluate("window.__desk.openWorkspace('crm')")
    page.wait_for_selector(PANEL, timeout=5000)
    page.wait_for_timeout(900)
    box = page.locator(PANEL).bounding_box()
    report("S5 390 full-screen sheet", box["width"] >= 388 and box["height"] >= 840, f"{box['width']:.0f}x{box['height']:.0f}")
    page.screenshot(path=str(shots / "S5-390.png"))
    report("390 console errors", not errors, f"count={len(errors)}")
    ctx.close()
    return all(results)


def record_video(browser, base, shots: Path):
    """A short headed screen video of open / switch / close for a by-eye smoothness check."""
    vdir = shots / "video"
    vdir.mkdir(exist_ok=True)
    ctx = browser.new_context(
        viewport={"width": 1440, "height": 900},
        record_video_dir=str(vdir),
        record_video_size={"width": 1440, "height": 900},
    )
    page = ctx.new_page()
    page.goto(f"{base}/#/?onboarding=0")
    page.wait_for_function("window.__desk", timeout=90000)
    page.wait_for_timeout(1500)
    for _ in range(2):
        page.get_by_role("link", name="Open database").click()
        page.wait_for_timeout(1400)
        page.evaluate("window.__desk.openWorkspace('calendar')")
        page.wait_for_timeout(1400)
        page.keyboard.press("Escape")
        page.wait_for_timeout(1200)
    path = page.video.path()
    ctx.close()
    print(f"video: {path}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("base")
    ap.add_argument("--shots", required=True)
    ap.add_argument("--channel", default="chrome", help="Playwright channel: chrome (installed Google Chrome, real GPU) or chromium")
    a = ap.parse_args()
    shots = Path(a.shots)
    shots.mkdir(parents=True, exist_ok=True)
    base = a.base.rstrip("/")
    results = []
    with sync_playwright() as p:
        kw = {} if a.channel == "chromium" else {"channel": a.channel}
        browser = p.chromium.launch(headless=False, args=LAUNCH_ARGS + GPU_ARGS, **kw)
        print_renderer(browser, base)
        idle_baseline(browser, base)
        record_video(browser, base, shots)
        for w, h in SIZES:
            for v in VIEWS:
                results.append(measure(browser, base, v, w, h, shots))
        results += [
            functional(browser, base, shots),
            check_shape(browser, base),
            check_double_toggle(browser, base),
            check_rapid(browser, base),
            check_reduced(browser, base),
            check_cold_and_back(browser, base),
        ]
        browser.close()
    print("ALL PASS" if all(results) else "FAILURES")
    sys.exit(0 if all(results) else 1)


if __name__ == "__main__":
    main()
