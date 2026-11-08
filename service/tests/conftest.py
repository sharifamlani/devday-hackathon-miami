from datetime import date

import pytest

from service import db

AS_OF = date(2026, 11, 7)   # hackathon Saturday, 12 days before Give Miami Day


@pytest.fixture
def conn():
    c = db.connect(":memory:")
    db.create_schema(c)
    yield c
    c.close()


@pytest.fixture
def db_file(tmp_path, monkeypatch):
    """A rebuilt, seeded, scored db file that the routes read via $DONORS_DB."""
    path = tmp_path / "donors.db"
    monkeypatch.setenv("DONORS_DB", str(path))
    monkeypatch.setenv("SCORE_AS_OF", AS_OF.isoformat())
    db.rebuild(path, with_seed=True, as_of=AS_OF)
    return path


@pytest.fixture(autouse=True)
def no_live_events_search(monkeypatch):
    """/context/run starts the events agent's live web search next to the website read. Tests never go
    online: it's off unless a test sets ONBOARDING_EVENTS=on (and stands in extract_events). No import here:
    importing service.events_agent would bypass tests that swap in a fake module."""
    monkeypatch.setenv("ONBOARDING_EVENTS", "off")
