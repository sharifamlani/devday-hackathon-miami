"""Service settings, loaded once from the repo-root .env.

Import this before any other service module: it pins SCORE_AS_OF (default 2026-11-08, the demo day)
so score.py and outreach_agent.py read the same date.
"""
import os
from pathlib import Path

import httpx
from agents import set_default_openai_client
from dotenv import load_dotenv
from openai import AsyncOpenAI

REPO_ROOT = Path(__file__).resolve().parent.parent
load_dotenv(REPO_ROOT / ".env")

os.environ.setdefault("SCORE_AS_OF", "2026-11-08")

# The SDK's default client waits 600 s per request; one hung call froze outreach for 10+ minutes.
# Every agent call in this process uses this client instead.
OPENAI_TIMEOUT_S = float(os.getenv("OPENAI_TIMEOUT_S", "90"))
OPENAI_MAX_RETRIES = int(os.getenv("OPENAI_MAX_RETRIES", "2"))
# Wall-clock cap per agent route: past it the route answers 504 even if a retry is still running
AGENT_DEADLINE_S = float(os.getenv("AGENT_DEADLINE_S", "120"))
# Onboarding screen 2 waits on this one; past it /context/run serves the cached context
CONTEXT_DEADLINE_S = float(os.getenv("CONTEXT_DEADLINE_S", "30"))
# After a website read that ran past CONTEXT_DEADLINE_S, how much longer onboarding waits for the events search
# (started at the same moment) so the dashboard still lands with events.
ONBOARDING_EVENTS_GRACE_S = float(os.getenv("ONBOARDING_EVENTS_GRACE_S", "30"))
# Invites drafted per event during setup (the first calendar): enough to review each event, done in minutes.
# Refresh now / the daily pass still drafts up to refresh.MAX_DRAFTS_PER_EVENT for new events.
SETUP_DRAFTS_PER_EVENT = int(os.getenv("SETUP_DRAFTS_PER_EVENT", "12"))
# The chat panel and event drafting (plan.md §17): 90 s, then 504
CHAT_DEADLINE_S = float(os.getenv("CHAT_DEADLINE_S", "90"))
# Daily context + calendar refresh, local time "HH:MM" (e.g. 07:00). Unset = off; always off under pytest
REFRESH_DAILY_AT = (os.getenv("REFRESH_DAILY_AT") or "").strip() or None
# A refresh still running after this long is reported as such (a live pass took ~120 s on the Foundation)
REFRESH_DEADLINE_S = float(os.getenv("REFRESH_DEADLINE_S", "150"))
if os.getenv("OPENAI_API_KEY"):
    # No pooled connections: each request runs in its own event loop (Runner.run_sync / asyncio.run in a
    # worker thread), and a kept-alive connection from a closed loop fails the next call with
    # "Event loop is closed". One fresh connection per call costs a TLS handshake and nothing else.
    set_default_openai_client(AsyncOpenAI(
        timeout=OPENAI_TIMEOUT_S, max_retries=OPENAI_MAX_RETRIES,
        http_client=httpx.AsyncClient(timeout=OPENAI_TIMEOUT_S, limits=httpx.Limits(max_keepalive_connections=0))))

SCORE_AS_OF = os.environ["SCORE_AS_OF"]
MODEL_DEFAULT = os.getenv("OPENAI_MODEL_DEFAULT")
MODEL_FAST = os.getenv("OPENAI_MODEL_FAST") or MODEL_DEFAULT
HAS_OPENAI_KEY = bool(os.getenv("OPENAI_API_KEY"))

# Vite dev servers for the web UI
DEFAULT_CORS_ORIGINS = [
    "http://localhost:5173",
    "http://localhost:5174",
    "http://127.0.0.1:5173",
    "http://127.0.0.1:5174",
]


def cors_origins(extra: str | None) -> list[str]:
    """The defaults plus CORS_ORIGINS (comma-separated, e.g. a QA web on a spare port). Unset = the defaults."""
    added = [o.strip().rstrip("/") for o in (extra or "").split(",") if o.strip()]
    return DEFAULT_CORS_ORIGINS + [o for o in added if o not in DEFAULT_CORS_ORIGINS]


# Also gates the dictation WebSocket's Origin check (routes_voice.py)
CORS_ORIGINS = cors_origins(os.getenv("CORS_ORIGINS"))

# Public mode (docs/public-tunnel.md): the laptop service is reachable from the Vercel app through a tunnel.
# Off by default. When on, the origins in PUBLIC_ORIGINS join CORS and the /transcribe/live Origin check
# (routes_voice reads CORS_ORIGINS), and service/public_mode.py rate limits the model-backed routes and
# forces every send to stay simulated.
PUBLIC_MODE = (os.getenv("PUBLIC_MODE") or "").strip().lower() in ("1", "true", "on", "yes")
PUBLIC_ORIGINS = [o.strip().rstrip("/") for o in (os.getenv("PUBLIC_ORIGINS") or "").split(",") if o.strip()]
if PUBLIC_MODE:
    CORS_ORIGINS = CORS_ORIGINS + [o for o in PUBLIC_ORIGINS if o not in CORS_ORIGINS]
# Demo data is fictional (Sharif, Sun Nov 8): PUBLIC_SHOW_ALL=1 keeps public mode read-only and rate limited but
# hides nothing: every GET is served, contacts are not masked, call notes, staff notes, summaries and staff tasks show.
PUBLIC_SHOW_ALL = (os.getenv("PUBLIC_SHOW_ALL") or "").strip().lower() in ("1", "true", "on", "yes")
