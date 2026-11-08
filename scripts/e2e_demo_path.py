"""The demo path, walked like a user in a real Chromium, from an EMPTY database (the integration wheel's regression walk).

    python scripts/e2e_demo_path.py                                  # TEST stack: web :5174, API :8101
    python scripts/e2e_demo_path.py --reset                          # first empty the TEST stack (scripts/live_stack.ps1 reset)
    python scripts/e2e_demo_path.py --only 1,2 --web http://localhost:5173 --api http://127.0.0.1:8001 \n        --db C:/Users/Shari/dd-live-main/data/donors.db              # reload LIVE after a reset; duplicates left for a person
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
import urllib.parse
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
KNOWN_GAPS: dict[str, str] = {}   # e.g. {"events": "<why>"} turns that check's FAIL into INFO until a PR lands
# live_stack.ps1's shared state (pids.json of the IT lane's own stacks) and the TEST ports it belongs to
SHARED_STATE = Path("C:/Users/Shari/dd-live-state")
RESERVED_TEST_PORTS = (8101, 5174)

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
    page.locator("button[aria-label='Send']").last.click()   # the composer's Send (cards can carry a "Send" too, #150)
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


def open_panel(page: Page, web: str, workspace: str, names: list[str]) -> str:
    """Open a home workspace panel like a user: the first visible link/button whose name matches (tile heading
    since #204; "Open database" / "Open full calendar" before it). Falls back to the ?workspace= URL. Returns how."""
    for name in names:
        for role in ("link", "button"):
            loc = page.get_by_role(role, name=re.compile(name))
            for i in range(loc.count()):
                if loc.nth(i).is_visible():
                    loc.nth(i).click()
                    page.wait_for_timeout(1500)
                    if f"workspace={workspace}" in page.url:
                        return f"clicked {role} '{name}'"
    page.goto(web + f"#/?workspace={workspace}")
    page.wait_for_timeout(1500)
    return "url fallback"


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
                full = str(e)
                msg = full.splitlines()[0][:160]
                blocker = re.search(r"(<[^>]{0,160}>)[^\n]*intercepts pointer events", full)
                if blocker:   # the control exists but something on screen covers it: a product FAIL, not a walk break
                    record(name, "control clickable", f"click blocked: {blocker.group(1)} intercepts pointer events", "FAIL")
                else:
                    record(name, "control found", msg, "SELECTOR" if "Timeout" in msg or "waiting for" in msg else "FAIL")
            except Exception as e:  # noqa: BLE001 - the walk reports every failure as a row and moves on
                record(name, "no exception", f"{type(e).__name__}: {str(e)[:160]}", "FAIL")
        return run
    return wrap


@step("1 upload")
def s1_upload(page: Page, api: Api, web: str, shots: Path):
    files = [f for f in sorted(glob.glob(str(INPUTS / "*"))) if not f.endswith(SKIP_FILES)]
    page.goto(web)
    sample = page.get_by_role("button", name="Try sample data")
    page.get_by_text(re.compile(r"Drag in your|Try sample data")).first.wait_for(timeout=30000)
    t0 = time.time()
    if sample.count():
        # #297: the Gatherly landing; the demo clicks Try sample data (it imports web/public/sample, = INPUTS since #302)
        sample.first.click()
    else:
        page.locator("input[type=file]").set_input_files(files)
        t0 = time.time()
        page.get_by_role("dialog").first.get_by_role("button", name=f"Import {len(files)} files").click()
    # #264: a processing view, then the results view ("A clearer picture of your people.") replaces the receipt
    create = page.get_by_role("button", name="Create organization profile")
    create.wait_for(timeout=300000)
    secs = round(time.time() - t0)
    page.screenshot(path=str(shots / "1_upload.png"))
    shown = page.inner_text("body")
    c = api.people_counts()
    accounts = re.search(r"(\d+)\s*\n?\s*Accounts recognized", shown)
    total = len(api.get("/people")["people"])   # the groups overlap (needs_review rows also sit in a group), so count rows
    # <= 10 s needs the warm ingest cache (stage_reset / demo_reset --warm); cold it is ~66 s and 78 / 10 (82, Nov 8)
    record("1 upload", f"{len(files)} files import in <= 10 s; results 'N Accounts recognized' = GET /people total (>0)",
           f"{secs}s; screen {accounts.group(1) if accounts else '-'} Accounts recognized; API {c} (total {total})",
           ok(c["giver"] > 0 and bool(accounts) and int(accounts.group(1)) == total and secs <= 10))
    removed = re.search(r"(\d+)\s*\n?\s*Duplicates removed", shown)
    review = re.search(r"(\d+) possible match(?:es)? still need review", shown)
    dups = api.get("/home/summary").get("duplicates")
    record("1b results", "results view: 'N possible matches still need review' = GET /home/summary duplicates",
           f"'{removed.group(1) if removed else '-'} Duplicates removed'; '{review.group(0) if review else '-'}'; API duplicates {dups}",
           ok(bool(review) and int(review.group(1)) == dups))
    create.click()


@step("2 website")
def s2_website(page: Page, api: Api, shots: Path):
    # #264: "Your organization. / Start with your website."; Continue closes the dialog and the read runs behind home
    box = page.get_by_placeholder(re.compile(r"^yourorg(anization)?\.org$"))
    box.wait_for(timeout=30000)
    box.fill(WEBSITE)
    dialog = page.get_by_role("dialog").first
    dialog.get_by_role("button", name="Continue", exact=True).click()
    t0 = time.time()
    while time.time() - t0 < 30 and page.get_by_role("dialog").count():
        page.wait_for_timeout(500)
    closed_s = round(time.time() - t0, 1)
    while time.time() - t0 < 150 and len(api.get("/events")) < 4:
        page.wait_for_timeout(2000)
    read_s = round(time.time() - t0)
    page.screenshot(path=str(shots / "2_context.png"))
    close_overlays(page)
    events, tasks = api.get("/events"), api.open_tasks()
    left = page.get_by_role("dialog").count() == 0
    record("2 website", "dialog closes; background read lands; prep/open tasks >= 1",
           f"dialog closed in {closed_s}s; read landed {read_s}s; dialog closed={left}; open tasks {len(tasks)}",
           ok(left and len(tasks) >= 1))
    gap = KNOWN_GAPS.get("events")
    record("2b events", ">= 4 sourced events, no reload", f"GET /events = {len(events)}",
           "PASS" if len(events) >= 4 else ("INFO" if gap else "FAIL") + (f" ({gap})" if gap else ""))


@step("3 donors")
def s3_donors(page: Page, api: Api, shots: Path):
    # #204: the CRM tile heading is "Open CRM"; before it the tile had "Open database", and older layouts a "Donors" link
    how = open_panel(page, page.url.split("#")[0], "crm", [r"^Open CRM", r"^Open database", r"^CRM", r"^Donors$"])
    record("3a open CRM", "a heading click opens ?workspace=crm", f"{how}; url {page.url.split('#')[-1]}",
           "SELECTOR" if how == "url fallback" else ok("workspace=crm" in page.url))
    page.wait_for_timeout(3000)
    page.screenshot(path=str(shots / "3_donors.png"))
    main = page.locator("main").first.inner_text()
    m = re.search(r"(\d+)\s+donors", main)
    c = api.people_counts()
    record("3 donors", "list count = GET /people giver", f"screen '{m.group(0) if m else '-'}'; API giver {c['giver']}",
           ok(bool(m) and int(m.group(1)) == c["giver"]))
    # PeopleTabs (#126): a tablist "People by tab", each tab carrying its GET /people count
    tablist = page.get_by_role("tablist", name="People by tab")
    if not tablist.count():   # #200: the CRM is givers only, with no Neighbors/Community tabs
        stray = page.get_by_role("tab", name=re.compile("Neighbors|Community")).count()
        record("3b givers only", "no Neighbors/Community tabs (#200)", f"tabs {stray}", ok(stray == 0))
        record("3c other people", "Neighbors / Community live off the CRM (API only)",
               f"API neighbor {c['neighbor']} community {c['community']}", "INFO")
        return
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
    alerts_expected = len(KEY["gift_alerts_expected"])
    open_tasks = [t for t in api.open_tasks() if (t.get("due") or "") <= KEY.get("as_of", "2026-11-08")]   # the tile counts today's
    task_rows = page.get_by_role("button", name=re.compile(r"^Work on with the agent: ")).count()
    side = page.get_by_role("complementary").first if page.get_by_role("complementary").count() else page.locator("body")
    side_text = side.inner_text()
    # Faye's home (#152): no glance tiles; the Tasks tile heading carries the open-task count
    # "Tasks 9", or "Tasks / Alt+T / 9" with #187's shortcut hint between the heading and the count
    tasks_head = re.search(r"Tasks\s*(?:\n\s*Alt\+T\s*)?\n?\s*(\d+)", side_text)
    events_seen = [t for t in ("Give Miami Day", "Early Giving") if t in side_text]
    record("5 home", f"API at risk = {alerts_expected} (answer key); Tasks tile count = open tasks due today; task rows; events in the agenda",
           f"API risk {s['gifts_at_risk']} dup {s['duplicates']}; Tasks tile {tasks_head.group(1) if tasks_head else '-'} vs open "
           f"{len(open_tasks)}; rows {task_rows}; agenda {events_seen}",
           ok(s["gifts_at_risk"] == alerts_expected and bool(tasks_head) and int(tasks_head.group(1)) == len(open_tasks)
              and task_rows > 0 and len(events_seen) == 2))


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
    reply, secs = ask(page, "Send Hye-jin Park a short thank-you email now.")
    # AgentCards.tsx (#112): the approval card carries data-decision="pending" and an "Approve" button
    card = chat_log(page).locator("[data-decision='pending']")
    t0 = time.time()
    while not card.count() and time.time() - t0 < 60:
        page.wait_for_timeout(1000)
    if not card.count():
        page.screenshot(path=str(shots / "6c_no_card.png"))
        record("6c send -> approval", "approval card (data-decision=pending) for a send",
               f"no approval card after {secs + round(time.time() - t0)}s; agent replied: '{' '.join(reply.split())[:160]}'", "FAIL")
        return
    card.first.get_by_role("button").first.click()   # the yes button; its label depends on the tool ("Approve", "Send", ...)
    page.wait_for_timeout(4000)
    txt = chat_text(page)
    decided = chat_log(page).locator("[data-decision='approved']").count()
    page.screenshot(path=str(shots / "6c_approve.png"))
    dry = bool(re.search(r"Approved.*dry run|dry run.*approved", txt, re.I | re.S))
    record("6c send -> approval", "approval card -> Approve -> 'Approved … (dry run)'; 0 real sends",
           f"{secs}s; card approved={decided > 0}; dry-run text={dry}; outbox sent {sent0} -> {api.outbox_sent()}",
           ok(decided > 0 and dry and api.outbox_sent() == sent0))


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
    how = open_panel(page, web, "calendar", [r"^Open full calendar", r"^November", r"^Calendar$"])
    record("9a open calendar", "a heading click opens ?workspace=calendar", f"{how}; url {page.url.split('#')[-1]}",
           "SELECTOR" if how == "url fallback" else ok("workspace=calendar" in page.url))
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
    # #123: the composer's mic is "Dictate" (dictation into the box); before it, the mic opened the live transcript
    mic = page.get_by_role("button", name="Dictate", exact=True)
    if not mic.count():
        mic = page.get_by_role("button", name="Start live transcript")
    mic = mic.last
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
def s11_phone(page: Page, api: Api, web: str, shots: Path):
    page.set_viewport_size({"width": 390, "height": 844})
    seen = {}
    giver = api.get("/people?type=giver")["people"][0]["id"]
    for name, path in (("home", ""), ("donors", "#/?workspace=donors"), ("inbox", "#/inbox"), ("profile", f"#/contacts/{giver}/show")):
        page.goto(web + path)
        page.wait_for_timeout(2500)
        seen[name] = overflow(page)
        page.screenshot(path=str(shots / f"11_390_{name}.png"))
    record("11 phone width", "no horizontal overflow at 390 (home, donors, inbox, a donor profile)", f"overflow {seen}", ok(not any(seen.values())))


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--web", default="http://localhost:5174/")
    ap.add_argument("--api", default="http://127.0.0.1:8101")
    ap.add_argument("--db", default="C:/Users/Shari/dd-live-test/data/donors.db")
    ap.add_argument("--shots", default=str(Path.home() / "dd-live-state" / "shots"))
    ap.add_argument("--reset", action="store_true", help="empty the TEST stack first (scripts/live_stack.ps1 reset -Stack test)")
    ap.add_argument("--headed", action="store_true")
    ap.add_argument("--only", default="", help="comma-separated step numbers, e.g. 1,2 to load a stack like a user "
                                               "(upload + website step) and leave duplicates for a person")
    ap.add_argument("--state-dir", default=None,
                    help="live_stack.ps1 state dir for --reset (pids.json). Default: the shared dir on the reserved TEST "
                         "ports, otherwise a fresh per-run dir, so a reviewer's reset can never stop the IT lane's stacks")
    args = ap.parse_args()
    web = args.web if args.web.endswith("/") else args.web + "/"
    shots = Path(args.shots)
    shots.mkdir(parents=True, exist_ok=True)
    api = Api(args.api)

    if args.reset:
        # Reset the stack this walk points at: its service port from --api, its worktree from --db (<root>/data/donors.db)
        api_port = urllib.parse.urlparse(args.api).port or 80
        web_port = urllib.parse.urlparse(web).port or 80
        reserved = (api_port, web_port) == RESERVED_TEST_PORTS
        state = Path(args.state_dir) if args.state_dir else (SHARED_STATE if reserved else shots / "stack-state")
        if state.resolve() == SHARED_STATE.resolve() and not reserved:
            print(f"refused: --reset on ports {api_port}/{web_port} must not use the shared state dir {SHARED_STATE} "
                  "(its pids.json holds the IT lane's stacks). Pass another --state-dir or omit it.")
            return 2
        subprocess.run(["powershell", "-NoProfile", "-File", str(REPO_ROOT / "scripts" / "live_stack.ps1"), "reset", "-Stack", "test",
                        "-TestRoot", str(Path(args.db).resolve().parent.parent), "-StateDir", str(state),
                        "-TestServicePort", str(api_port), "-TestWebPort", str(web_port)], check=True)
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
        steps = {
            1: lambda: s1_upload(page, api, web, shots),
            2: lambda: s2_website(page, api, shots),
            3: lambda: s3_donors(page, api, shots),
            4: lambda: s4_duplicates(page, api, Path(args.db), shots),
            5: lambda: s5_home(page, api, web, shots),
            6: lambda: s6_chat(page, api, shots),
            7: lambda: s7_task(page, api, shots),
            8: lambda: s8_enrich(page, api, shots),
            9: lambda: s9_calendar(page, api, web, shots),
            10: lambda: s10_dictation(page, web, shots),
            11: lambda: s11_phone(page, api, web, shots),
        }
        for n in (sorted(int(x) for x in args.only.split(",")) if args.only else steps):
            steps[n]()
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
