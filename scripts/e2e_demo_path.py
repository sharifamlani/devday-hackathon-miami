"""The demo path, walked like a user in a real Chromium, from an EMPTY database (the integration wheel's regression walk).

    python scripts/e2e_demo_path.py                                  # TEST stack: web :5174, API :8101
    python scripts/e2e_demo_path.py --reset                          # first empty the TEST stack (scripts/live_stack.ps1 reset)
    python scripts/e2e_demo_path.py --web http://localhost:5174 --api http://127.0.0.1:8101 \
        --db C:/Users/Shari/dd-live-test/data/donors.db --shots <scratch>/shots

Steps (docs/integration-loop.md): 1 upload the 8 sample files · 2 website step -> dashboard · 3 donors list = GET /people ·
4 approve every duplicate -> answer_key.json (33 givers, 131 gifts, $1,367,535) · 5 home glance = GET /home/summary ·
6 chat: question, add task + Undo, send -> approval card (dry run) · 7 task -> agent · 8 Enrich an org -> Save to profile ·
9 calendar dates · 10 dictation button · 11 phone width (390) overflow. Every step also counts console errors and
failed requests (HTTP >= 400).

Each row is PASS, FAIL, INFO (reported, never fails the run: off-scope or a known gap) or SELECTOR (the walk could not
find a control: a test break to fix here, not a product FAIL). Scope (Sharif, Nov 8): Givers flows decide the run;
Neighbors / Community checks are INFO. Prints a markdown table; exit 1 on any FAIL or SELECTOR.
"""

from __future__ import annotations

import argparse
import glob
import json
import re
import sqlite3
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

from playwright.sync_api import Error as PwError, Page, sync_playwright

REPO_ROOT = Path(__file__).resolve().parent.parent
INPUTS = REPO_ROOT / "data" / "sample_inputs"
KEY = json.loads((INPUTS / "answer_key.json").read_text(encoding="utf-8"))
SKIP_FILES = ("answer_key.json", "_README.md")
WEBSITE = "miamifoundation.org"
ENRICH_ORG = "John S. and James L. Knight Foundation"
# Known gaps the lead has accepted until a PR lands: the step's row is INFO, not FAIL
KNOWN_GAPS = {"events": "sourced events arrive with e6's onboarding-events PR"}

rows: list[tuple[str, str, str, str]] = []
problems: list[str] = []          # console errors + failed requests, reset per step
full_log: list[str] = []          # every problem in full, written next to the screenshots


def record(step: str, expected: str, saw: str, verdict: str) -> None:
    if problems:
        saw += f" | {len(problems)} console/network problems: {problems[:3]}"
        if verdict == "PASS":
            verdict = "FAIL"
    rows.append((step, expected, saw, verdict))
    print(f"| {step} | {expected} | {saw} | {verdict} |", flush=True)
    problems.clear()


def ok(cond: bool) -> str:
    return "PASS" if cond else "FAIL"


class Api:
    def __init__(self, base: str):
        self.base = base.rstrip("/")

    def get(self, path: str):
        with urllib.request.urlopen(self.base + path, timeout=30) as r:
            return json.load(r)

    def people_counts(self) -> dict:
        return self.get("/people")["counts"]

    def open_tasks(self) -> list[dict]:
        return [t for t in self.get("/tasks") if not t["done"]]

    def outbox_sent(self) -> int:
        items = self.get("/outbox")
        items = items if isinstance(items, list) else items.get("items", [])
        return sum(1 for i in items if str(i.get("status", "")).lower() == "sent")


def gift_totals(db: Path) -> tuple[int, float]:
    """Same query as scripts/demo_reset.py: status = 'ok' gifts only."""
    conn = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
    try:
        has_status = any(r[1] == "status" for r in conn.execute("PRAGMA table_info(gifts)"))
        where = " WHERE status = 'ok'" if has_status else ""
        n, total = conn.execute(f"SELECT COUNT(*), COALESCE(SUM(amount), 0) FROM gifts{where}").fetchone()
        return n, float(total)
    finally:
        conn.close()


def overflow(page: Page) -> bool:
    return page.evaluate("document.documentElement.scrollWidth > window.innerWidth + 1")


def chat_log(page: Page):
    return page.get_by_role("log", name="Conversation with the agent").first


def chat_text(page: Page) -> str:
    log = chat_log(page)
    return log.inner_text(timeout=3000) if log.count() else ""


def ask(page: Page, text: str, settle_s: int = 6, timeout_s: int = 150) -> tuple[str, int]:
    """Type into the home chat and wait until the reply stops changing. Returns (new text, seconds)."""
    before = chat_text(page)
    box = page.get_by_placeholder("Ask the agent…")
    box.fill(text)
    page.get_by_role("button", name="Send", exact=True).click()
    t0, last, stable_since = time.time(), "", time.time()
    while time.time() - t0 < timeout_s:
        page.wait_for_timeout(1000)
        now = chat_text(page)
        if now != last:
            last, stable_since = now, time.time()
        busy = page.get_by_text(re.compile(r"Thinking|Working|still working", re.I)).count()
        if len(now) > len(before) + len(text) + 5 and not busy and time.time() - stable_since >= settle_s:
            break
    return last[len(before):] if last.startswith(before) else last, round(time.time() - t0)


def close_overlays(page: Page) -> None:
    for name in ("Not now", "No thanks", "Skip tour", "Close"):
        b = page.get_by_role("button", name=name, exact=True)
        if b.count() and b.first.is_visible():
            b.first.click()
            page.wait_for_timeout(500)


def step(name: str):
    """Run a step; a missing control is a SELECTOR row, any other exception a FAIL row."""
    def wrap(fn):
        def run(*a, **kw):
            try:
                return fn(*a, **kw)
            except PwError as e:
                msg = str(e).splitlines()[0][:160]
                record(name, "control found", msg, "SELECTOR" if "Timeout" in msg or "waiting for" in msg else "FAIL")
            except Exception as e:  # noqa: BLE001 - the walk reports every failure as a row and moves on
                record(name, "no exception", f"{type(e).__name__}: {str(e)[:160]}", "FAIL")
        return run
    return wrap


@step("1 upload")
def s1_upload(page: Page, api: Api, web: str, shots: Path):
    files = [f for f in sorted(glob.glob(str(INPUTS / "*"))) if not f.endswith(SKIP_FILES)]
    page.goto(web)
    page.get_by_text("Drag in your").wait_for(timeout=30000)
    page.locator("input[type=file]").set_input_files(files)
    dialog = page.get_by_role("dialog").first
    t0 = time.time()
    dialog.get_by_role("button", name=f"Import {len(files)} files").click()
    dialog.get_by_role("button", name="Continue", exact=True).wait_for(timeout=300000)
    secs = round(time.time() - t0)
    page.screenshot(path=str(shots / "1_upload.png"))
    shown = dialog.get_by_role("list", name="People by tab").inner_text() if dialog.get_by_role("list", name="People by tab").count() else ""
    c = api.people_counts()
    givers_on_screen = re.search(r"(\d+)\s*Givers?", shown, re.I)
    match = bool(givers_on_screen) and int(givers_on_screen.group(1)) == c["giver"]
    record("1 upload", f"{len(files)} files import; screen Givers = GET /people giver (>0)",
           f"{secs}s; screen '{shown.strip()[:80]}'; API {c}", ok(c["giver"] > 0 and match))
    dialog.get_by_role("button", name="Continue", exact=True).click()


@step("2 website")
def s2_website(page: Page, api: Api, shots: Path):
    page.get_by_text("Step 2 of 3").wait_for(timeout=30000)
    page.get_by_placeholder("yourorg.org").fill(WEBSITE)
    dialog = page.get_by_role("dialog").first
    dialog.get_by_role("button", name="Continue", exact=True).click()
    page.get_by_text("Step 3 of 3").wait_for(timeout=60000)
    t0 = time.time()
    # "Go to the dashboard" after a normal read; "Continue to the dashboard" when the read is slow or failed
    go = dialog.get_by_role("button", name=re.compile(r"^(Go|Continue) to the dashboard"))
    go.wait_for(timeout=150000)
    page.screenshot(path=str(shots / "2_context.png"))
    read_s = round(time.time() - t0)
    go.click()
    page.wait_for_timeout(4000)
    close_overlays(page)
    events, tasks = api.get("/events"), api.open_tasks()
    left = page.get_by_role("dialog").count() == 0
    record("2 website", "dialog closes; prep/open tasks >= 1", f"read {read_s}s; dialog closed={left}; open tasks {len(tasks)}",
           ok(left and len(tasks) >= 1))
    gap = KNOWN_GAPS.get("events")
    record("2b events", ">= 4 sourced events, no reload", f"GET /events = {len(events)}",
           "PASS" if len(events) >= 4 else ("INFO" if gap else "FAIL") + (f" ({gap})" if gap else ""))


@step("3 donors")
def s3_donors(page: Page, api: Api, shots: Path):
    page.get_by_role("link", name="Donors").first.click()
    page.wait_for_timeout(3000)
    page.screenshot(path=str(shots / "3_donors.png"))
    main = page.locator("main").first.inner_text()
    m = re.search(r"(\d+)\s+donors", main)
    c = api.people_counts()
    record("3 donors", "list count = GET /people giver", f"screen '{m.group(0) if m else '-'}'; API giver {c['giver']}",
           ok(bool(m) and int(m.group(1)) == c["giver"]))
    # PeopleTabs (#126): a tablist "People by tab", each tab carrying its GET /people count
    tablist = page.get_by_role("tablist", name="People by tab")
    shown = {}
    for label, key in (("Givers", "giver"), ("Neighbors", "neighbor"), ("Community", "community")):
        tab = tablist.get_by_role("tab", name=re.compile(label))
        n = re.search(r"\d+", tab.first.inner_text()) if tab.count() else None
        shown[key] = int(n.group()) if n else None
    record("3b Givers tab", "Givers tab count = GET /people giver", f"tab {shown['giver']}; API {c['giver']}",
           ok(shown["giver"] == c["giver"]))
    record("3c other tabs", "Neighbors / Community tab counts = GET /people",
           f"tabs {shown['neighbor']}/{shown['community']}; API {c['neighbor']}/{c['community']}",
           "INFO" + ("" if (shown["neighbor"], shown["community"]) == (c["neighbor"], c["community"]) else " (mismatch)"))


@step("4 duplicates")
def s4_duplicates(page: Page, api: Api, db: Path, shots: Path):
    merged = 0
    review = page.get_by_role("button", name=re.compile("Review merges"))
    for _ in range(20):
        if not review.count():
            break
        review.first.click()
        dialog = page.get_by_role("dialog").filter(has_text="We found this donor twice")
        dialog.wait_for(timeout=10000)
        dialog.get_by_role("button", name=re.compile("^Merge")).click()
        page.wait_for_timeout(2500)
        merged += 1
        if page.get_by_role("dialog").filter(has_text="We found this donor twice").count():
            page.keyboard.press("Escape")
            page.wait_for_timeout(800)
    page.screenshot(path=str(shots / "4_after_merge.png"))
    c = api.people_counts()
    n, total = gift_totals(db)
    tab = KEY["tab_counts"]
    givers_ok = c["giver"] == tab["giver"]
    gifts_ok = n == KEY["totals"]["unique_gifts"] and round(total) == KEY["totals"]["total_amount"]
    record("4 duplicates", f"merge all -> givers {tab['giver']}; gifts {KEY['totals']['unique_gifts']} = ${KEY['totals']['total_amount']:,}",
           f"merged {merged} in UI; givers {c['giver']}; gifts {n} = ${total:,.0f}; review button left={review.count()}",
           ok(givers_ok and gifts_ok and review.count() == 0))
    record("4b people", f"neighbor {tab['neighbor']} community {tab['community']} (68 total)",
           f"neighbor {c['neighbor']} community {c['community']} needs_review {c.get('needs_review')} "
           f"(total {c['giver'] + c['neighbor'] + c['community']})", "INFO")


@step("5 home")
def s5_home(page: Page, api: Api, web: str, shots: Path):
    page.goto(web)
    page.wait_for_timeout(3500)
    close_overlays(page)
    page.screenshot(path=str(shots / "5_home.png"))
    s = api.get("/home/summary")
    risk = page.get_by_role("link", name=re.compile(r"\d+ gifts? at risk")).first.inner_text()
    dups = page.get_by_role("link", name=re.compile(r"\d+ possible duplicates?")).first.inner_text()
    risk_n, dup_n = int(re.search(r"\d+", risk).group()), int(re.search(r"\d+", dups).group())
    task_rows = page.get_by_role("button", name=re.compile(r"^Work on with the agent: ")).count()
    today = [t for t in api.open_tasks() if t.get("due") == KEY.get("as_of", "2026-11-08")]
    alerts_expected = len(KEY["gift_alerts_expected"])
    record("5 home", f"at risk = summary = {alerts_expected}; duplicates = summary; task rows = open tasks",
           f"screen risk {risk_n} dup {dup_n} rows {task_rows}; API risk {s['gifts_at_risk']} dup {s['duplicates']} "
           f"tasks_today {s['tasks_today']} open-today {len(today)}",
           ok(risk_n == s["gifts_at_risk"] == alerts_expected and dup_n == s["duplicates"] and task_rows > 0))


@step("6 chat")
def s6_chat(page: Page, api: Api, shots: Path):
    names = {p["full_name"] for p in api.get("/people?type=giver")["people"] if p.get("full_name")}
    reply, secs = ask(page, "Who should I call today?")
    page.screenshot(path=str(shots / "6a_who.png"))
    named = sorted(n for n in names if n in reply)
    steps = chat_log(page).get_by_role("list", name="Steps").count()
    record("6a chat question", "step cards + names that exist in the db",
           f"{secs}s; step lists {steps}; db names in reply {named[:4]}", ok(steps > 0 and len(named) > 0))

    before = len(api.open_tasks())
    reply, secs = ask(page, "Add a task to call Priya Raman tomorrow about her pledge.")
    after = len(api.open_tasks())
    undo = chat_log(page).get_by_role("button", name=re.compile("Undo"))
    has_undo = undo.count() > 0
    if has_undo:
        undo.last.click()
        page.wait_for_timeout(3000)
    undone = len(api.open_tasks())
    page.screenshot(path=str(shots / "6b_task_undo.png"))
    record("6b add task + Undo", "open tasks +1, then Undo -> back", f"{secs}s; tasks {before} -> {after} -> {undone}; Undo={has_undo}",
           ok(after == before + 1 and has_undo and undone == before))

    sent0 = api.outbox_sent()
    reply, secs = ask(page, "Email Hye-jin Park a short thank-you for her support.")
    approve = page.get_by_role("button", name=re.compile(r"^Approve"))
    approve.first.wait_for(timeout=60000)
    approve.first.click()
    page.wait_for_timeout(4000)
    txt = chat_text(page)
    page.screenshot(path=str(shots / "6c_approve.png"))
    dry = bool(re.search(r"Approved.*dry run|dry run.*approved", txt, re.I | re.S))
    record("6c send -> approval", "approval card -> Approve -> 'Approved … (dry run)'; 0 real sends",
           f"{secs}s; dry-run text={dry}; outbox sent {sent0} -> {api.outbox_sent()}", ok(dry and api.outbox_sent() == sent0))


@step("7 task -> agent")
def s7_task(page: Page, api: Api, shots: Path):
    row = page.get_by_role("button", name=re.compile(r"^Work on with the agent: "))
    title = row.first.get_attribute("aria-label").split(": ")[1]
    before = chat_text(page).lower().count("mark done?")
    row.first.click()
    t0 = time.time()
    while time.time() - t0 < 150 and chat_text(page).lower().count("mark done?") <= before:
        page.wait_for_timeout(1000)
    txt = chat_text(page)
    page.screenshot(path=str(shots / "7_task_agent.png"))
    got = [s for s in ("Get task", "Get person") if s in txt]
    record("7 task -> agent", "Work on this task -> Get task, Get person, draft, 'Mark done?'",
           f"'{title}'; steps {got}; Mark done? in {round(time.time() - t0)}s",
           ok(f"Work on this task: {title}" in txt and len(got) == 2 and txt.lower().count("mark done?") > before))


@step("8 enrich")
def s8_enrich(page: Page, api: Api, shots: Path):
    have = [p for p in api.get("/people")["people"] if "Knight" in (p.get("full_name") or p.get("org_name") or "")]
    if not have:
        ask(page, f"Add {ENRICH_ORG} as a new organization contact.")
        have = [p for p in api.get("/people")["people"] if "Knight" in (p.get("full_name") or p.get("org_name") or "")]
    def visible_find():
        found = page.get_by_role("button", name="Find a donor")
        return next((found.nth(i) for i in range(found.count()) if found.nth(i).is_visible()), None)
    find = visible_find()
    if find is None:
        page.get_by_role("button", name="CRM", exact=True).first.click()   # the CRM tile holds "Find a donor"
        page.wait_for_timeout(1200)
        find = visible_find() or page.get_by_role("button", name="Find a donor").first
    find.click()
    dialog = page.get_by_role("dialog").filter(has_text="Find a donor")
    dialog.get_by_placeholder("Name, email or organization").fill("Knight")
    page.wait_for_timeout(1500)
    dialog.get_by_role("list", name=re.compile(r"^(People|Donors)$")).get_by_role("button").first.click()
    page.wait_for_timeout(1500)
    dialog.get_by_role("button", name="Enrich profile").click()
    sugg = dialog.get_by_role("region", name="Enrichment suggestions")
    if not sugg.count():
        sugg = dialog.locator("[aria-label='Enrichment suggestions']")
    sugg.wait_for(timeout=180000)
    boxes = sugg.get_by_role("checkbox")
    n_boxes = boxes.count()
    # keep only the first suggestion ticked, so "writes only the ticked items" is checkable
    for i in range(1, n_boxes):
        if boxes.nth(i).is_checked():
            boxes.nth(i).click()
    sources = sugg.get_by_role("link").count()
    page.screenshot(path=str(shots / "8a_enrich_review.png"))
    dialog.get_by_role("button", name="Save to profile").click()
    page.wait_for_timeout(3000)
    page.screenshot(path=str(shots / "8b_enrich_saved.png"))
    saved = dialog.get_by_role("list", name="Saved interest areas")
    n_saved = saved.get_by_role("listitem").count() if saved.count() else 0
    record("8 enrich", "Knight Foundation contact; Enrich -> tags with sources; Save writes only ticked",
           f"contact in db={bool(have)}; suggestions {n_boxes} checkboxes, {sources} source links; saved tags {n_saved}",
           ok(bool(have) and n_boxes > 0 and sources > 0 and n_saved == 1))
    page.keyboard.press("Escape")


@step("9 calendar")
def s9_calendar(page: Page, api: Api, web: str, shots: Path):
    page.goto(web)
    page.wait_for_timeout(2500)
    page.get_by_role("button", name="Calendar", exact=True).first.click()
    page.wait_for_timeout(2500)
    page.screenshot(path=str(shots / "9_calendar.png"))
    cal = api.get("/calendar")
    gmd = [e for e in cal if "Give Miami Day" in e["title"]]
    early = [e for e in cal if "Early Giving" in e["title"]]
    text = page.locator("main").first.inner_text()
    if not api.get("/events") and KNOWN_GAPS.get("events"):
        record("9 calendar", "Give Miami Day 2026-11-19; Early Giving 2026-11-14 on the calendar",
               f"GET /events empty -> calendar holds {sum(e['kind'] == 'task' for e in cal)} tasks only", f"INFO ({KNOWN_GAPS['events']})")
        return
    record("9 calendar", "Give Miami Day 2026-11-19; Early Giving 2026-11-14; tasks on the calendar",
           f"API GMD {[e['date'] for e in gmd]} early {[e['date'] for e in early]}; tasks {sum(e['kind'] == 'task' for e in cal)}; "
           f"screen has 'Give Miami Day'={'Give Miami Day' in text}",
           ok(any(e["date"] == "2026-11-19" for e in gmd) and any(e["date"] == "2026-11-14" for e in early)
              and "Give Miami Day" in text))


@step("10 dictation")
def s10_dictation(page: Page, web: str, shots: Path):
    page.goto(web)
    page.wait_for_timeout(2500)
    mic = page.get_by_role("button", name="Start live transcript").last
    present = mic.count() > 0
    mic.click()
    page.wait_for_timeout(3000)
    msg = page.get_by_role("alert").all_inner_texts() + page.get_by_role("status").all_inner_texts()
    msg = [m.strip() for m in msg if m.strip()]
    page.screenshot(path=str(shots / "10_dictation.png"))
    problems[:] = [p for p in problems if not re.search(r"getUserMedia|NotAllowed|NotFound|microphone|Permission", p, re.I)]
    record("10 dictation", "mic button present; no mic in headless -> a visible error line",
           f"button={present}; visible messages {msg[:2]}", ok(present) if msg else "INFO (no visible message without a mic)")


@step("11 phone width")
def s11_phone(page: Page, web: str, shots: Path):
    page.set_viewport_size({"width": 390, "height": 844})
    seen = {}
    for name, path in (("home", ""), ("donors", "#/?workspace=donors"), ("inbox", "#/inbox")):
        page.goto(web + path)
        page.wait_for_timeout(2500)
        seen[name] = overflow(page)
        page.screenshot(path=str(shots / f"11_390_{name}.png"))
    record("11 phone width", "no horizontal overflow at 390 (home, donors, inbox)", f"overflow {seen}", ok(not any(seen.values())))


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--web", default="http://localhost:5174/")
    ap.add_argument("--api", default="http://127.0.0.1:8101")
    ap.add_argument("--db", default="C:/Users/Shari/dd-live-test/data/donors.db")
    ap.add_argument("--shots", default=str(Path.home() / "dd-live-state" / "shots"))
    ap.add_argument("--reset", action="store_true", help="empty the TEST stack first (scripts/live_stack.ps1 reset -Stack test)")
    ap.add_argument("--headed", action="store_true")
    args = ap.parse_args()
    web = args.web if args.web.endswith("/") else args.web + "/"
    shots = Path(args.shots)
    shots.mkdir(parents=True, exist_ok=True)
    api = Api(args.api)

    if args.reset:
        subprocess.run(["powershell", "-NoProfile", "-File", str(REPO_ROOT / "scripts" / "live_stack.ps1"), "reset", "-Stack", "test"],
                       check=True)
    if api.people_counts()["giver"]:
        print(f"refused: {args.api} is not empty (run with --reset)")
        return 2

    sha = subprocess.run(["git", "-C", str(Path(args.db).parent.parent), "rev-parse", "--short", "HEAD"],
                         capture_output=True, text=True).stdout.strip()
    print(f"walk {web} api {args.api} code {sha or '?'}\n")
    print("| step | expected | saw | verdict |\n|---|---|---|---|")
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=not args.headed)
        page = browser.new_page(viewport={"width": 1440, "height": 900})
        def on_console(m):
            if m.type == "error":
                problems.append("console: " + m.text[:140]); full_log.append(m.text + " @ " + str(m.location))
        def on_response(r):
            if r.status >= 400:
                problems.append(f"{r.status} {r.request.method} {r.url[:90]}"); full_log.append(f"{r.status} {r.request.method} {r.url}")
        page.on("console", on_console)
        page.on("response", on_response)
        s1_upload(page, api, web, shots)
        s2_website(page, api, shots)
        s3_donors(page, api, shots)
        s4_duplicates(page, api, Path(args.db), shots)
        s5_home(page, api, web, shots)
        s6_chat(page, api, shots)
        s7_task(page, api, shots)
        s8_enrich(page, api, shots)
        s9_calendar(page, api, web, shots)
        s10_dictation(page, web, shots)
        s11_phone(page, web, shots)
        browser.close()
    (shots / "problems.log").write_text("\n\n".join(full_log) or "none", encoding="utf-8")

    verdicts = [r[3].split()[0] for r in rows]
    n_pass, n_fail = verdicts.count("PASS"), verdicts.count("FAIL") + verdicts.count("SELECTOR")
    graded = n_pass + n_fail
    print(f"\nRESULT {n_pass}/{graded} PASS · {verdicts.count('FAIL')} FAIL · {verdicts.count('SELECTOR')} SELECTOR · "
          f"{verdicts.count('INFO')} INFO · code {sha} · shots {shots}")
    return 1 if n_fail else 0


if __name__ == "__main__":
    sys.exit(main())
