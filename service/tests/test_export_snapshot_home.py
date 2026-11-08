"""The home board's live-only routes in snapshot.json (plan.md §21: the Vercel build's populated home)."""

from service import db, tasks
from service.export_snapshot import build_snapshot

HOME_KEYS = {"home_summary", "people_attention", "tasks", "tasks_today", "calendar", "artifacts", "target_quarters"}


def test_snapshot_has_the_home_keys_in_route_shapes(db_file):
    conn = db.connect(db_file)
    snap = build_snapshot(conn)
    conn.close()

    assert HOME_KEYS <= set(snap)
    assert {"gifts_at_risk", "duplicates", "tasks_today", "next_event", "reached_today", "suggestions"} <= set(
        snap["home_summary"])
    for person in snap["people_attention"]:
        assert {"id", "name", "initials", "line", "badge"} <= set(person)
    # The generator ran (idempotent), so the sample DB has tasks; today's are a subset of all.
    assert snap["tasks"], "the snapshot should carry generated tasks"
    all_ids = {t["id"] for t in snap["tasks"]}
    assert {t["id"] for t in snap["tasks_today"]} <= all_ids
    for item in snap["calendar"]:
        assert item["kind"] in ("event", "task")
        if item["kind"] == "task":
            assert "task_kind" in item and "done" in item
    assert set(snap["target_quarters"]) == {"quarters", "ytd"}


def test_snapshot_never_carries_call_note_artifacts(db_file, monkeypatch):
    real = tasks.artifacts

    def with_a_call_note(conn, limit=50):
        return [{"kind": "call_note", "title": "Call with someone", "date": "2026-11-07", "ref": "call:1"},
                *real(conn, limit)]

    monkeypatch.setattr(tasks, "artifacts", with_a_call_note)
    conn = db.connect(db_file)
    snap = build_snapshot(conn)
    conn.close()
    assert all(a["kind"] != "call_note" for a in snap["artifacts"])
