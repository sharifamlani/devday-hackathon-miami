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
CORS_ORIGINS = [
    "http://localhost:5173",
    "http://localhost:5174",
    "http://127.0.0.1:5173",
    "http://127.0.0.1:5174",
]
