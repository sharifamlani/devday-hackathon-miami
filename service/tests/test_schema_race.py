"""A db made by an older build upgrades once, even when the first page load fires many requests at once."""
import sqlite3
from concurrent.futures import ThreadPoolExecutor

from fastapi.testclient import TestClient

from service import db
from service.main import app

ROUTES = ["/targets", "/home/summary", "/people/attention", "/campaigns", "/donors", "/duplicates"]
DROPPED = {"org_profile": ["staff_name", "last_refreshed_at"], "research_facts": ["cached"], "gifts": ["status"],
           "donors": ["tab_review", "has_dog"]}


def old_db(path):
    """A fresh db with several ADDED_COLUMNS removed, as an older build would have left it."""
    db.rebuild(path)
    conn = sqlite3.connect(path)
    for table, cols in DROPPED.items():
        for col in cols:
            conn.execute(f"ALTER TABLE {table} DROP COLUMN {col}")
    conn.commit()
    conn.close()


def columns(path, table):
    conn = sqlite3.connect(path)
    try:
        return {r[1] for r in conn.execute(f"PRAGMA table_info({table})")}
    finally:
        conn.close()


def test_concurrent_first_requests_on_an_old_db_all_return_200(tmp_path, monkeypatch):
    path = tmp_path / "donors.db"
    old_db(path)
    assert "staff_name" not in columns(path, "org_profile")
    monkeypatch.setenv("DONORS_DB", str(path))
    db._MIGRATED.clear()
    client = TestClient(app)                              # no startup run: per-request callers must cope alone

    with ThreadPoolExecutor(max_workers=20) as pool:
        codes = list(pool.map(lambda i: (ROUTES[i % len(ROUTES)], client.get(ROUTES[i % len(ROUTES)]).status_code),
                              range(20)))

    assert [c for c in codes if c[1] != 200] == []
    for table, cols in DROPPED.items():
        assert set(cols) <= columns(path, table)


def test_startup_migrates_once_and_requests_do_not(tmp_path, monkeypatch):
    path = tmp_path / "donors.db"
    old_db(path)
    monkeypatch.setenv("DONORS_DB", str(path))
    db._MIGRATED.clear()
    with TestClient(app) as client:                       # runs the startup handlers
        assert "staff_name" in columns(path, "org_profile")
        calls = []
        real = db._migrate
        monkeypatch.setattr(db, "_migrate", lambda conn: calls.append(1) or real(conn))
        assert all(client.get(r).status_code == 200 for r in ROUTES)
        assert calls == []


def test_add_column_tolerates_a_column_that_already_exists(conn):
    db._add_column(conn, "org_profile", "staff_name", "TEXT")      # create_schema already added it
    db._add_column(conn, "org_profile", "staff_name", "TEXT")


def test_reset_db_still_recreates_after_a_migration(tmp_path):
    path = tmp_path / "donors.db"
    db.rebuild(path)
    db.reset_db(path)
    conn = db.connect(path)
    assert conn.execute("SELECT COUNT(*) FROM donors").fetchone()[0] == 0
    conn.close()
