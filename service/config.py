"""Service settings, loaded once from the repo-root .env.

Import this before any other service module: it pins SCORE_AS_OF (default 2026-11-08, the demo day)
so score.py and outreach_agent.py read the same date.
"""
import os
from pathlib import Path

from dotenv import load_dotenv

REPO_ROOT = Path(__file__).resolve().parent.parent
load_dotenv(REPO_ROOT / ".env")

os.environ.setdefault("SCORE_AS_OF", "2026-11-08")

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
