"""QA link check in a real (headless) browser: what a judge sees when they click a [src] link.

    python qa/link_check.py URL [URL ...]
    python qa/link_check.py --from-db data/donors.db --from-json service/org_facts.json

A link passes when the page finishes on HTTP 200 and shows a real title and article text, not a
challenge or error page. Uses Chromium's own identity; no spoofed headers. Exits 1 if any link fails.
"""

from __future__ import annotations

import argparse
import json
import re
import sqlite3
import sys

from playwright.sync_api import sync_playwright

sys.stdout.reconfigure(encoding="utf-8")


def collect(args) -> list[str]:
    urls = list(args.urls)
    if args.from_db:
        con = sqlite3.connect(args.from_db)
        urls += [r[0] for r in con.execute("SELECT DISTINCT source_url FROM research_facts")]
        for (fu,) in con.execute("SELECT facts_used FROM outreach_drafts WHERE facts_used IS NOT NULL"):
            urls += [f["url"] for f in json.loads(fu)]
    if args.from_json:
        text = open(args.from_json, encoding="utf-8").read()
        urls += re.findall(r'"(?:url|source_url)":\s*"([^"]+)"', text)
    return list(dict.fromkeys(urls))


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("urls", nargs="*")
    ap.add_argument("--from-db")
    ap.add_argument("--from-json")
    args = ap.parse_args()

    fails = 0
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page()
        for url in collect(args):
            if not url.startswith(("http://", "https://")) or " " in url:
                print(f"FAIL  not a clickable URL  | {url!r}")
                fails += 1
                continue
            if url.lower().split("?")[0].endswith(".pdf"):
                # Chromium downloads PDFs instead of rendering them; fetch it in the same browser context
                r = page.request.get(url, timeout=30000)
                ctype = r.headers.get("content-type", "")
                ok = r.status == 200 and "pdf" in ctype and len(r.body()) > 10_000
                fails += not ok
                print(f"{'PASS' if ok else 'FAIL'}  {r.status}  {len(r.body()) // 1024:>5} KB    {ctype!r}  | {url}")
                continue
            page.goto("about:blank")                  # never read a stale previous page
            try:
                resp = page.goto(url, wait_until="domcontentloaded", timeout=30000)
                page.wait_for_load_state("networkidle", timeout=15000)
            except Exception as e:
                resp = None
                note = type(e).__name__
            # A challenge page may reload itself into the article; read where the page ended up
            status = resp.status if resp else 0
            try:
                status = page.evaluate("performance.getEntriesByType('navigation')[0]?.responseStatus") or status
            except Exception:
                pass
            title, words = "", 0
            for _ in range(20):                       # the page may still be reloading itself
                try:
                    page.wait_for_load_state("domcontentloaded", timeout=5000)
                    title = page.title().strip()
                    words = len(page.inner_text("body").split())
                    if words >= 150:
                        break
                except Exception:
                    pass
                page.wait_for_timeout(1000)
            try:
                status = page.evaluate("performance.getEntriesByType('navigation')[0]?.responseStatus") or status
            except Exception:
                pass
            ok = status == 200 and words >= 150 and not re.search(r"just a moment|attention required|access denied|404", title, re.I)
            fails += not ok
            print(f"{'PASS' if ok else 'FAIL'}  {status}  {words:>5} words  {title[:70]!r}  | {url}")
        browser.close()
    print(f"\n{'all links load' if not fails else f'{fails} link(s) fail'}")
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
