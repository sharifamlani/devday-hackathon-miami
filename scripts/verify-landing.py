"""Walk the landing page like a visitor and measure docs/plans/landing-story.md §5 criteria A-F.

Usage:
    python scripts/verify-landing.py <base-url> --out <dir> [--bundle index-XXXX.js]

Read-only: it never clicks Upload, Try sample data or anything that imports. Writes <dir>/landing-walk.json and
screenshots, prints one PASS/FAIL line per criterion, and exits non-zero if any criterion fails.
"""
import argparse
import json
import pathlib
import sys
import time

from playwright.sync_api import sync_playwright

VIEWPORTS = [("desktop", 1440, 900), ("phone", 390, 844)]
EXPECTED = [
    "Know who needs to hear from you.",
    "Donors rarely say goodbye. They just stop giving.",
    "Watch it work. Then try it yourself.",
    "Turn messy files into a clean, organized CRM",
    "Bring your donor list.",
]


def walk(page, base, name, w, h, out, bundle):
    r = {"viewport": f"{w}x{h}", "console_errors": [], "failed_requests": [], "non_get_requests": []}
    page.on("console", lambda m: m.type == "error" and r["console_errors"].append(m.text))
    page.on("requestfailed", lambda q: r["failed_requests"].append(f"{q.method} {q.url} {q.failure}"))
    page.on("response", lambda s: s.status >= 400 and r["failed_requests"].append(f"{s.status} {s.url}"))
    page.on("request", lambda q: q.method != "GET" and r["non_get_requests"].append(f"{q.method} {q.url}"))
    page.goto(f"{base}/?fresh={int(time.time())}", wait_until="networkidle")
    page.wait_for_timeout(800)
    if bundle:
        r["bundle_ok"] = any(bundle in (s or "") for s in page.eval_on_selector_all("script[src]", "e=>e.map(x=>x.src)"))

    # A: the upload button is fully visible without scrolling
    box = page.locator("#upload-btn").bounding_box()
    # ...and its label is readable: white text on the dark button (a style clash once hid it)
    style = page.locator("#upload-btn").evaluate("e=>{const s=getComputedStyle(e);return [s.color,s.backgroundColor]}")
    r["upload_colors"] = style
    r["A_upload_visible"] = bool(box) and box["y"] >= 0 and box["y"] + box["height"] <= h and style[0] != style[1] and style[0] == "rgb(255, 255, 255)"
    mt = page.locator(".kindred-motion-toggle").bounding_box(); sl = page.locator(".kindred-sample").bounding_box()
    r["toggle_overlaps_sample"] = bool(mt and sl) and not (mt["x"] > sl["x"] + sl["width"] or mt["x"] + mt["width"] < sl["x"] or mt["y"] > sl["y"] + sl["height"] or mt["y"] + mt["height"] < sl["y"])
    r["A_upload_visible"] = r["A_upload_visible"] and not r["toggle_overlaps_sample"]
    # B: sections in order
    heads = page.eval_on_selector_all("main h1, main h2", "e=>e.map(x=>x.innerText.replace(/\\s+/g,' ').trim())")
    r["headings"] = heads
    r["B_order"] = heads == EXPECTED
    page.screenshot(path=str(out / f"{name}-hero.png"))
    # E: header links keep the hash empty (phone shows only the CTA)
    hashes = []
    for label in ["Problem", "Demo", "How it works", "Try the demo"]:
        btn = page.get_by_role("button", name=label, exact=True)
        if btn.count() and btn.first.is_visible():
            btn.first.click()
            page.wait_for_timeout(400)
            hashes.append(page.evaluate("location.hash"))
    r["E_hashes"] = hashes
    r["E_hash_kept"] = len(hashes) > 0 and all(x == "" for x in hashes)
    # C: the tour plays by itself (from the top, even after the header links scrolled past it), then hands over
    page.locator("#app").scroll_into_view_if_needed()
    page.wait_for_timeout(3000)
    r["C_restart_on_return"] = (page.locator("[data-intro=try][aria-pressed=true]").count() == 1
                                and page.locator("#thread > *").count() <= 2)
    trail = []
    for _ in range(12):
        page.wait_for_timeout(1000)
        trail.append(page.locator("#addr").inner_text() + "|" + str(page.locator("#thread > *").count())
                     + "|" + str(page.locator("[data-intro=try][aria-pressed=true]").count())
                     + "|" + str(len(page.locator("#main").inner_text()) // 40))
    r["C_trail"] = trail
    r["C_cursor_visible"] = page.locator("#cursor").is_visible()
    r["C_tour_steps_seen"] = len(set(trail))
    page.screenshot(path=str(out / f"{name}-demo.png"))
    page.locator(".navb[data-view=donors]").click()
    page.wait_for_timeout(600)
    r["C_paused_on_click"] = page.locator("#tour-btn").inner_text() == "Play tour"
    r["C_tour"] = r["C_cursor_visible"] and r["C_tour_steps_seen"] >= 3 and r["C_paused_on_click"] and r["C_restart_on_return"]
    # More real use: duplicates merge, ask an example (all in memory)
    page.locator(".navb[data-view=dups]").click()
    page.locator("[data-merge]").click()
    page.locator(".navb[data-view=ask]").click()
    page.locator("[data-ask='0']").click()
    page.wait_for_timeout(1500)
    # F: clean page
    r["scroll_width"] = page.evaluate("document.documentElement.scrollWidth")
    cb = page.locator(".closing .upload").bounding_box()
    cc = page.locator(".closing .upload").evaluate("e=>getComputedStyle(e).color")
    r["closing_button"] = {"height": cb and round(cb["height"]), "color": cc}
    r["F_clean"] = bool(cb) and cb["height"] <= 64 and cc == "rgb(255, 255, 255)" and not r["console_errors"] and not r["failed_requests"] and r["scroll_width"] <= w
    r["D_no_writes"] = not r["non_get_requests"]
    page.screenshot(path=str(out / f"{name}-full.png"), full_page=True)
    return r


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("base")
    ap.add_argument("--out", required=True)
    ap.add_argument("--bundle")
    a = ap.parse_args()
    out = pathlib.Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    results = {}
    with sync_playwright() as p:
        b = p.chromium.launch()
        for name, w, h in VIEWPORTS:
            ctx = b.new_context(viewport={"width": w, "height": h})
            results[name] = walk(ctx.new_page(), a.base.rstrip("/"), name, w, h, out, a.bundle)
            ctx.close()
        b.close()
    (out / "landing-walk.json").write_text(json.dumps(results, indent=2), encoding="utf-8")
    ok = True
    for crit, key in [("A", "A_upload_visible"), ("B", "B_order"), ("C", "C_tour"), ("D", "D_no_writes"), ("E", "E_hash_kept"), ("F", "F_clean")]:
        passed = all(results[v][key] for v in results)
        ok &= passed
        print(f"{crit} {'PASS' if passed else 'FAIL'}  " + "  ".join(f"{v}={results[v][key]}" for v in results))
    if a.bundle:
        print("bundle " + "  ".join(f"{v}={results[v].get('bundle_ok')}" for v in results))
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
