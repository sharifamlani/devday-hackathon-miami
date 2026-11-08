"""One switch for the public tunnel: python scripts/public_tunnel.py on | off | status

on      start `cloudflared tunnel --url http://localhost:8001`, record pid + URL in .public-tunnel.json, and
        print (never run) the three commands that point the Vercel app at it.
off     kill ONLY the cloudflared process recorded in .public-tunnel.json, then print the commands that put
        the Vercel app back on its snapshot.
status  is the recorded pid alive, the URL, and an HTTP check of <url>/health.

Exit codes: 0 ok, 1 failure, 2 cloudflared is not installed. Runbook: docs/public-tunnel.md
"""
import argparse
import json
import re
import shutil
import subprocess
import sys
import time
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
STATE = REPO_ROOT / ".public-tunnel.json"
LOG = REPO_ROOT / ".public-tunnel.log"
VERCEL_ORIGIN = "https://devday-donor-desk.vercel.app"
DEFAULT_PORT = 8001          # session 20: the LIVE stack runs on :8001
URL_RE = re.compile(r"https://[a-z0-9-]+\.trycloudflare\.com")
INSTALL = "winget install --id Cloudflare.cloudflared"


def read_state() -> dict | None:
    try:
        return json.loads(STATE.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


def process_name(pid: int) -> str | None:
    """Lower-cased image name of a pid, or None when no such process."""
    if sys.platform == "win32":
        out = subprocess.run(["tasklist", "/FI", f"PID eq {pid}", "/FO", "CSV", "/NH"],
                             capture_output=True, text=True).stdout.strip()
        m = re.match(r'"([^"]+)"', out)
        return m.group(1).lower() if m else None
    out = subprocess.run(["ps", "-p", str(pid), "-o", "comm="], capture_output=True, text=True).stdout.strip()
    return Path(out).name.lower() if out else None


def is_cloudflared(pid: int) -> bool:
    name = process_name(pid)
    return bool(name) and name.startswith("cloudflared")


def http_status(url: str, timeout: float = 5.0) -> str:
    try:
        with urllib.request.urlopen(url, timeout=timeout) as r:
            return f"HTTP {r.status}"
    except urllib.error.HTTPError as e:
        return f"HTTP {e.code}"
    except Exception as e:
        return f"unreachable ({type(e).__name__})"


def cmd_on(args) -> int:
    port = args.port
    state = read_state()
    if state and is_cloudflared(state["pid"]):
        print(f"already on: {state['url']} (pid {state['pid']}). Run `off` first to restart it.")
        return 1
    exe = shutil.which("cloudflared")
    if not exe:
        print("cloudflared is not on PATH. Install it with the official command, then re-run:\n"
              f"  {INSTALL}")
        return 2
    with LOG.open("w", encoding="utf-8") as log:
        flags = subprocess.CREATE_NEW_PROCESS_GROUP if sys.platform == "win32" else 0
        proc = subprocess.Popen([exe, "tunnel", "--url", f"http://localhost:{port}"], stdout=log,
                                stderr=subprocess.STDOUT, creationflags=flags)
    url, deadline = None, time.time() + 40
    while time.time() < deadline and not url:
        time.sleep(0.5)
        if proc.poll() is not None:
            print(f"cloudflared exited early (code {proc.returncode}). See {LOG.name}.")
            return 1
        m = URL_RE.search(LOG.read_text(encoding="utf-8", errors="replace"))
        url = m.group(0) if m else None
    if not url:
        proc.terminate()
        print(f"no tunnel URL after 40 s; stopped cloudflared. See {LOG.name}.")
        return 1
    STATE.write_text(json.dumps({"pid": proc.pid, "url": url,
                                 "started_at": datetime.now(timezone.utc).isoformat(timespec="seconds")}, indent=2),
                     encoding="utf-8")
    print(f"tunnel on: {url} (pid {proc.pid})\n\nNext, run these yourself (nothing below has been run):\n"
          f"(1) restart the service:\n"
          f"    PUBLIC_MODE=1 PUBLIC_ORIGINS={VERCEL_ORIGIN} uvicorn service.main:app --host 127.0.0.1 --port {port}\n"
          f"(2) point Vercel at the tunnel (from web/, in Git Bash):\n"
          f"    printf '%s' \"{url}\" | vercel env add VITE_API_URL production\n"
          f"    printf '%s' \"local\" | vercel env add VITE_DATA_MODE production   # `vercel env rm` the old value first\n"
          f"(3) redeploy:\n"
          f"    vercel --prod --yes")
    return 0


def cmd_off(_args) -> int:
    state = read_state()
    if not state:
        print("off: no .public-tunnel.json, nothing to stop.")
    else:
        pid = state["pid"]
        if not is_cloudflared(pid):
            print(f"pid {pid} is not a running cloudflared ({process_name(pid) or 'no such process'}); not killing anything.")
        else:
            if sys.platform == "win32":
                subprocess.run(["taskkill", "/PID", str(pid), "/T", "/F"], capture_output=True)
            else:
                subprocess.run(["kill", "-9", str(pid)], capture_output=True)
            for _ in range(20):
                if not is_cloudflared(pid):
                    break
                time.sleep(0.25)
            print(f"stopped cloudflared pid {pid}; {state['url']} is dead.")
        STATE.unlink(missing_ok=True)
    print("\nNext, run these yourself (nothing below has been run):\n"
          "(1) put the Vercel app back on its snapshot (from web/, in Git Bash):\n"
          "    printf '%s' \"snapshot\" | vercel env add VITE_DATA_MODE production   # `vercel env rm` the old value first\n"
          "(2) redeploy:\n"
          "    vercel --prod --yes\n"
          "Until then the app falls back to the snapshot on its own (2 s health check).\n"
          "(3) restart the service without PUBLIC_MODE (or leave it: it only listens on 127.0.0.1).")
    return 0


def cmd_status(_args) -> int:
    state = read_state()
    if not state or not is_cloudflared(state["pid"]):
        print("off" + (" (stale .public-tunnel.json: recorded pid is not cloudflared)" if state else ""))
        return 0
    print(f"on\n  pid:     {state['pid']}\n  url:     {state['url']}\n  started: {state['started_at']}\n"
          f"  health:  {http_status(state['url'] + '/health')}")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("action", choices=["on", "off", "status"])
    ap.add_argument("--port", type=int, default=DEFAULT_PORT, help="local service port to tunnel (default %(default)s)")
    args = ap.parse_args()
    return {"on": cmd_on, "off": cmd_off, "status": cmd_status}[args.action](args)


if __name__ == "__main__":
    sys.exit(main())
