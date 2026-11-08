from datetime import date

import sys

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


@pytest.fixture(autouse=True)
def no_slow_read_between_tests():
    """A timed-out /context/run leaves its read for the next refresh (service.main.SLOW_READ); never let one
    test's read reach another test's refresh. sys.modules, not an import, for the same reason as above."""
    yield
    main = sys.modules.get("service.main")
    if main is not None and hasattr(main, "SLOW_READ"):
        main.SLOW_READ.clear()
