"""Walk the three-URL user journey from an empty start and grade it (docs/plans/user-journey.md §9, E1-E7).

    landing (bare URL)  --Try sample data-->  #/onboarding  --Continue-->  #/dashboard

Run it against a stack with an EMPTY database (it imports the sample files once). Never point it at LIVE, the
public site, :8401, :5173 or :8001: the import would double their donors.

    python scripts/verify-journey.py http://localhost:5192 http://127.0.0.1:8192 <out_dir>

Writes <out_dir>/journey.json (ASCII) after every step plus screenshots, prints one PASS/FAIL line per criterion,
and exits 1 if any criterion fails.
"""
import json
import sys
import time
import urllib.request
from pathlib import Path

from playwright.sync_api import sync_playwright

WEB, API, OUT = sys.argv[1].rstrip("/"), sys.argv[2].rstrip("/"), Path(sys.argv[3])
OUT.mkdir(parents=True, exist_ok=True)
LANDING = "More time for people"
log = {"web": WEB, "steps": [], "criteria": {}, "console_errors": [], "failed_requests": []}


def save():
    (OUT / "journey.json").write_text(json.dumps(log, indent=1, ensure_ascii=True))


def get(path):
    with urllib.request.urlopen(API + path, timeout=20) as r:
        return json.loads(r.read())


def count(path):
    body = get(path)
    if isinstance(body, list):
        return len(body)
    for key in ("facts", "tasks", "events", "people"):
        if isinstance(body.get(key), list):
            return len(body[key])
    return 0


def hook(page):
    page.on("console", lambda m: m.type == "error" and log["console_errors"].append(f"{page.url} :: {m.text[:200]}"))
    page.on("response", lambda r: r.status >= 400 and log["failed_requests"].append(f"{r.status} {r.url}"))


def step(page, name, **extra):
    page.screenshot(path=str(OUT / f"{len(log['steps']):02d}-{name}.png"))
    log["steps"].append({"name": name, "url": page.url, "t": round(time.time() - T0, 1), **extra})
    save()


def grade(key, ok, detail):
    log["criteria"][key] = {"pass": bool(ok), "detail": detail}
    save()


def overflow(page):
    return page.evaluate("() => document.documentElement.scrollWidth - document.documentElement.clientWidth")


if count("/people"):
    sys.exit("REFUSED: the database already has people; run against an empty stack.")

with sync_playwright() as p:
    b = p.chromium.launch()
    page = b.new_context(viewport={"width": 1440, "height": 900}).new_page()
    hook(page)
    T0 = time.time()

    # E1a: bare URL on an empty app = landing, no dashboard link
    page.goto(WEB + "/")
    page.get_by_text(LANDING).wait_for(timeout=20_000)
    no_link = page.get_by_role("link", name="Open dashboard").count() == 0
    step(page, "landing-empty", dashboard_link=not no_link)

    # Import, then E3: the receipt shows what /ingest reported
    page.get_by_role("button", name="Try sample data").click()
    page.get_by_role("button", name="Create organization profile").wait_for(timeout=180_000)
    receipt = page.inner_text("body")
    step(page, "receipt")
    people = count("/people")
    grade("E3 receipt = ingest", "77" in receipt and "19" in receipt and people == 77,
          f"receipt shows 77/19: {'77' in receipt and '19' in receipt}; /people = {people}")

    # E2: on to #/onboarding, its own page
    page.get_by_role("button", name="Create organization profile").click()
    page.wait_for_url("**/#/onboarding", timeout=10_000)
    page.get_by_label("Organization name").wait_for(timeout=10_000)
    step(page, "onboarding")
    grade("E2 onboarding URL", page.url.endswith("#/onboarding"), page.url)

    # E4: prefilled name + website
    name, site = page.get_by_label("Organization name").input_value(), page.get_by_label("Website").input_value()
    grade("E4 prefilled", name == "The Miami Foundation" and site == "miamifoundation.org", f"{name!r} / {site!r}")

    # E5: Continue -> #/dashboard within 2 s
    page.get_by_role("button", name="Continue").click()
    t = time.time()
    page.wait_for_url("**/#/dashboard*", timeout=10_000)
    took = round(time.time() - t, 1)
    step(page, "dashboard", since_continue=took)
    grade("E5 dashboard <= 2 s", took <= 2.0 and "#/dashboard" in page.url, f"{took} s, {page.url}")

    # E6: research fills Impact & story, calendar, tasks within 60 s
    while time.time() - t < 60:
        facts, events, tasks = count("/context"), count("/events"), count("/tasks")
        if facts >= 10 and events >= 1 and tasks >= 15:
            break
        page.wait_for_timeout(2000)
    page.wait_for_timeout(3000)
    step(page, "dashboard-filled")
    grade("E6 dashboard fills", facts >= 10 and events >= 1 and tasks >= 15,
          f"after {round(time.time() - t)} s: facts {facts}, events {events}, tasks {tasks}")

    # #/ redirects to #/dashboard; deep links still open
    page.goto(WEB + "/#/")
    page.wait_for_url("**/#/dashboard*", timeout=10_000)
    deep = {}
    for route in ("#/contacts", "#/calendar"):
        page.goto(f"{WEB}/{route}")
        page.wait_for_timeout(2500)
        deep[route] = page.url.endswith(route)
    step(page, "deep-links", deep=deep)

    # E1b: the bare URL again (same browser, filled DB) = landing + Open dashboard
    page.goto(WEB + "/")
    page.get_by_text(LANDING).wait_for(timeout=20_000)
    link = page.get_by_role("link", name="Open dashboard")
    link.wait_for(timeout=10_000)
    step(page, "landing-returning")
    link.click()
    page.wait_for_url("**/#/dashboard*", timeout=10_000)

    # E1c: a brand-new browser on the filled DB also starts at the landing
    fresh = b.new_context(viewport={"width": 390, "height": 844}).new_page()
    hook(fresh)
    fresh.goto(WEB + "/")
    fresh.get_by_text(LANDING).wait_for(timeout=20_000)
    widths = {"landing-390": overflow(fresh)}
    fresh.screenshot(path=str(OUT / "zz-landing-390.png"))
    for route in ("#/onboarding", "#/dashboard"):
        fresh.goto(f"{WEB}/{route}")
        fresh.wait_for_timeout(3000)
        widths[f"{route}-390"] = overflow(fresh)
        fresh.screenshot(path=str(OUT / f"zz-{route.strip('#/')}-390.png"))
    grade("E1 bare URL = landing (empty, returning, fresh browser)", no_link,
          "empty: landing, no dashboard link; returning + fresh 390 px: landing shown")
    grade("deep links + #/ redirect", all(deep.values()), json.dumps(deep))
    grade("E7 clean run", not log["console_errors"] and not log["failed_requests"]
          and all(v <= 0 for v in widths.values()),
          f"console {len(log['console_errors'])}, http>=400 {len(log['failed_requests'])}, overflow {widths}")
    b.close()

failed = [k for k, v in log["criteria"].items() if not v["pass"]]
for k, v in log["criteria"].items():
    print(("PASS " if v["pass"] else "FAIL ") + k + " :: " + v["detail"])
sys.exit(1 if failed else 0)
