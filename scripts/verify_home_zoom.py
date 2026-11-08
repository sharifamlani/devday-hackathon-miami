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

from playwright.sync_api import sync_playwright

VIEWS = ["calendar", "crm", "tasks", "impact"]
SIZES = [(1440, 900), (1366, 768)]
CYCLES = 10
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
  const rail = document.querySelector('.desk-sidebar');
  const railRight = rail ? rail.getBoundingClientRect().right : 0;
  const p = panel ? panel.getBoundingClientRect() : null;
  const c = chat && chat.offsetParent !== null ? chat.getBoundingClientRect() : null;
  return { pw: p ? p.width : 0, cw: c ? c.width : 0, space: innerWidth - railRight,
           view: new URLSearchParams(location.hash.split('?')[1] || '').get('workspace'), has: !!panel };
}
"""


def p95(xs):
    xs = sorted(xs)
    return xs[min(len(xs) - 1, int(round(0.95 * (len(xs) - 1))))] if xs else 0.0


def fresh(browser, base, w, h, errors, reduced=False, hash_="/"):
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
    for i in range(CYCLES):
        if i == 1:
            page.evaluate(CLS_OBSERVER)  # CLS counted after the first open has settled
        page.evaluate(RECORDER)
        page.evaluate(f"window.__desk.openWorkspace('{view}')")
        if i == 0:
            page.wait_for_timeout(170)
            page.screenshot(path=str(shots / f"{view}-{w}x{h}-mid.png"))
        page.wait_for_timeout(700)
        gaps += page.evaluate(STOP)
        if i == 0:
            page.wait_for_timeout(500)
            geo = page.evaluate(GEOMETRY)
            page.screenshot(path=str(shots / f"{view}-{w}x{h}-settled.png"))
        page.evaluate(RECORDER)
        page.evaluate("window.__desk.closeWorkspace()")
        page.wait_for_timeout(600)
        gaps += page.evaluate(STOP)
    cls = page.evaluate("window.__cls || 0")
    ctx.close()
    ratio = geo["pw"] / geo["space"] if geo.get("space") else 0
    lo, hi = LIMITS["ratio"]
    ok = (
        lo <= ratio <= hi
        and geo["cw"] >= LIMITS["chat_min"]
        and p95(gaps) <= LIMITS["p95"]
        and max(gaps or [0]) <= LIMITS["max"]
        and cls == 0
        and not errors
    )
    print(
        f"{view} {w}x{h} ratio={ratio:.2f} chat={geo['cw']:.0f} p95={p95(gaps):.1f} "
        f"max={max(gaps or [0]):.1f} cls={cls:g} console={len(errors)} {'PASS' if ok else 'FAIL'}"
    )
    for e in errors[:3]:
        print("   console:", e[:200])
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
    ctx, page = fresh(browser, base, 1440, 900, errors, hash_="/?workspace=tasks")
    page.wait_for_selector(".desk-main-panel[data-workspace='tasks']", timeout=15000)
    opened = page.evaluate(GEOMETRY)["has"]
    page.go_back()
    page.wait_for_timeout(900)
    g = page.evaluate(GEOMETRY)
    ok = opened and not g["has"] and not errors
    print(f"cold /?workspace=tasks opened={opened}, history.back closed={not g['has']} console={len(errors)} {'PASS' if ok else 'FAIL'}")
    page.goto(f"{base}/#/?workspace=bogus")
    page.wait_for_timeout(1500)
    bogus = page.evaluate(GEOMETRY)["has"]
    ok2 = not bogus and not errors
    print(f"bogus workspace panel={bogus} console={len(errors)} {'PASS' if ok2 else 'FAIL'}")
    ctx.close()
    return ok and ok2


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("base")
    ap.add_argument("--shots", required=True)
    a = ap.parse_args()
    shots = Path(a.shots)
    shots.mkdir(parents=True, exist_ok=True)
    base = a.base.rstrip("/")
    results = []
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=False)
        for w, h in SIZES:
            for v in VIEWS:
                results.append(measure(browser, base, v, w, h, shots))
        results += [
            check_rapid(browser, base),
            check_reduced(browser, base),
            check_cold_and_back(browser, base),
        ]
        browser.close()
    print("ALL PASS" if all(results) else "FAILURES")
    sys.exit(0 if all(results) else 1)


if __name__ == "__main__":
    main()
