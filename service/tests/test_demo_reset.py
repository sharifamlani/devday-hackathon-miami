"""scripts/demo_reset.py: reset, warm-up and check logic (no model calls: the upload is faked)."""

import importlib.util
import socket
import sqlite3

import pytest

from service import db

spec = importlib.util.spec_from_file_location("demo_reset", db.REPO_ROOT / "scripts" / "demo_reset.py")
demo_reset = importlib.util.module_from_spec(spec)
spec.loader.exec_module(demo_reset)


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


@pytest.fixture
def busy_port():
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    s.listen()
    yield s.getsockname()[1]
    s.close()


def count(path, table="donors"):
    conn = sqlite3.connect(path)
    try:
        return conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
    finally:
        conn.close()


# ---- reset ----------------------------------------------------------------------------------------

def test_reset_backs_up_then_empties(db_file):
    people = count(db_file)
    assert people > 0
    saved = demo_reset.reset(db_file, free_port(), log=lambda *_: None)
    assert saved is not None and saved.exists() and saved.name.startswith("donors.backup-")
    assert count(saved) == people                       # the backup holds the old rows
    assert count(db_file) == 0 and count(db_file, "gifts") == 0
    assert demo_reset.reset(db_file, free_port(), log=lambda *_: None) is None   # empty now: no second backup


def test_reset_on_a_missing_db_creates_an_empty_schema(tmp_path):
    path = tmp_path / "fresh.db"
    assert demo_reset.reset(path, free_port(), log=lambda *_: None) is None   # nothing to back up
    assert count(path) == 0


def test_reset_refuses_while_the_service_port_answers(db_file, busy_port):
    people = count(db_file)
    with pytest.raises(demo_reset.Refused, match=f"port {busy_port}"):
        demo_reset.reset(db_file, busy_port, log=lambda *_: None)
    assert count(db_file) == people                     # untouched
    demo_reset.reset(db_file, busy_port, force=True, log=lambda *_: None)
    assert count(db_file) == 0


def test_main_exit_codes(db_file, busy_port, capsys):
    assert demo_reset.main(["--db", str(db_file), "--port", str(busy_port)]) == demo_reset.REFUSED
    assert "REFUSED" in capsys.readouterr().out
    assert demo_reset.main(["--db", str(db_file), "--port", str(free_port())]) == 0
    out = capsys.readouterr().out
    assert "PASS reset" in out and "VITE_DATA_MODE=local" in out and "--port 5173" in out
    assert "except answer_key.json and _README.md" in out
    assert demo_reset.main(["--db", str(db_file), "--check"]) == demo_reset.FAILED   # empty db: nothing to check


# ---- warm-up --------------------------------------------------------------------------------------

def test_warm_uploads_once_then_leaves_an_empty_db(db_file, tmp_path, monkeypatch):
    monkeypatch.setenv("INGEST_CACHE_DIR", str(tmp_path / "cache"))
    inputs = tmp_path / "inputs"
    inputs.mkdir()
    for name in ("a.xlsx", "b.docx", "answer_key.json", "_README.md"):
        (inputs / name).write_bytes(b"x")
    uploaded = []

    def fake_upload(files):
        uploaded.append([f.name for f in files])
        (tmp_path / "cache" / "answer.json").write_text("{}")       # the model answer the real path caches
        conn = db.connect(db_file)
        db.insert_donor(conn, {"full_name": "Warm Donor", "gifts": [(10, "2026-01-01", "online")]})
        conn.commit()
        conn.close()
        return {"people": 1}

    lines = []
    info = demo_reset.warm(db_file, free_port(), inputs, upload=fake_upload, log=lines.append)
    assert uploaded == [["a.xlsx", "b.docx"]]                          # answer key and README never uploaded
    assert info["counts"]["donors"] == 1 and info["cache_after"] == info["cache_before"] + 1
    assert count(db_file) == 0                                        # empty again for the stage
    assert any("duplicate suggestions" in line for line in lines)
    assert sum(line.startswith("PASS reset") for line in lines) == 2


def warm_inputs(tmp_path):
    inputs = tmp_path / "inputs"
    inputs.mkdir()
    (inputs / "a.xlsx").write_bytes(b"x")
    return inputs


def uploads_giving(db_file, cache, people_per_attempt):
    """A fake upload: attempt n writes its own cached answer and gives people_per_attempt[n] people."""
    calls = []

    def fake_upload(files):
        n = len(calls)
        calls.append(n)
        if cache is not None:
            (cache / f"answer-{n}.json").write_text("{}")
        conn = db.connect(db_file)
        for i in range(people_per_attempt[min(n, len(people_per_attempt) - 1)]):
            db.insert_donor(conn, {"full_name": f"Person {i}"})
        conn.commit()
        conn.close()
        return {}

    return fake_upload, calls


def test_warm_asks_again_until_the_stage_numbers_match(db_file, tmp_path, monkeypatch):
    """S1: a cold read that adds a person (a ghost from a mention) is asked again; that attempt's answers go."""
    cache = tmp_path / "cache"
    monkeypatch.setenv("INGEST_CACHE_DIR", str(cache))
    upload, calls = uploads_giving(db_file, cache, [3, 2])
    lines = []
    info = demo_reset.warm(db_file, free_port(), warm_inputs(tmp_path), upload=upload, log=lines.append,
                           expect={"people": 2, "pairs": 0}, tries=3)
    assert info["matched"] and info["attempts"] == 2 and len(calls) == 2
    assert sorted(p.name for p in cache.iterdir()) == ["answer-1.json"]   # attempt 1's answers dropped, 2's kept
    assert any(line.startswith("RETRY the upload gave 3 people / 0 pairs") for line in lines)
    assert any(line.startswith("PASS stage numbers: 2 people / 0 duplicate suggestions") for line in lines)
    assert count(db_file) == 0                                            # empty again for the stage


def test_warm_stops_after_tries_and_says_what_the_stage_will_show(db_file, tmp_path, monkeypatch):
    """S-neg: never loops forever; after `tries` uploads it keeps the last cache and FAILs with the numbers."""
    cache = tmp_path / "cache"
    monkeypatch.setenv("INGEST_CACHE_DIR", str(cache))
    upload, calls = uploads_giving(db_file, cache, [3])
    lines = []
    info = demo_reset.warm(db_file, free_port(), warm_inputs(tmp_path), upload=upload, log=lines.append,
                           expect={"people": 2, "pairs": 0}, tries=3)
    assert not info["matched"] and info["attempts"] == 3 and len(calls) == 3
    assert [p.name for p in cache.iterdir()] == ["answer-2.json"]          # the last attempt's cache is kept
    assert any(line.startswith("FAIL stage numbers: 3 people / 0 duplicate suggestions (expected 2 / 0, 3 uploads)")
               for line in lines)
    assert count(db_file) == 0


def test_warm_moves_aside_an_older_cache_that_gives_the_wrong_numbers(db_file, tmp_path, monkeypatch):
    """An already-warm cache that replays the wrong numbers is set aside (not deleted) so the model is asked again."""
    cache = tmp_path / "cache"
    cache.mkdir()
    (cache / "old-answer.json").write_text("{}")
    monkeypatch.setenv("INGEST_CACHE_DIR", str(cache))
    upload, calls = uploads_giving(db_file, None, [3, 2])                  # attempt 1 replays: writes nothing new
    info = demo_reset.warm(db_file, free_port(), warm_inputs(tmp_path), upload=upload, log=lambda *_: None,
                           expect={"people": 2, "pairs": 0}, tries=3)
    assert info["matched"] and info["attempts"] == 2
    aside = [p for p in tmp_path.iterdir() if p.name.startswith("cache.set-aside-")]
    assert len(aside) == 1 and (aside[0] / "old-answer.json").exists()
    assert not (cache / "old-answer.json").exists()


def test_warm_without_an_expectation_uploads_once(db_file, tmp_path, monkeypatch):
    monkeypatch.setenv("INGEST_CACHE_DIR", str(tmp_path / "cache"))
    upload, calls = uploads_giving(db_file, None, [3])
    info = demo_reset.warm(db_file, free_port(), warm_inputs(tmp_path), upload=upload, log=lambda *_: None, tries=3)
    assert info["matched"] and info["attempts"] == 1 and len(calls) == 1


def test_warm_refuses_while_the_service_runs(db_file, tmp_path, busy_port):
    with pytest.raises(demo_reset.Refused):
        demo_reset.warm(db_file, busy_port, tmp_path, upload=lambda files: {}, log=lambda *_: None)


# ---- check ----------------------------------------------------------------------------------------

def observed_expectation(db_file):
    """What the seeded db looks like after approving its duplicates (computed on a copy)."""
    copy = demo_reset.copy_db(db_file, db_file.with_name("probe.db"))
    obs = demo_reset.observe(copy, "2026-11-08")
    n, total = obs["post_gifts"]
    return {"tabs": {t: obs["post"][t] for t in ("giver", "neighbor", "community")}, "gifts": n, "amount": total,
            "alerts": obs["alerts"], "as_of": "2026-11-08"}, obs


def test_check_passes_on_a_match_and_never_touches_the_real_db(db_file):
    expected, obs = observed_expectation(db_file)
    assert obs["approved"] and obs["pre"]["giver"] == obs["post"]["giver"] + len(obs["approved"])
    pending, people = count(db_file, "duplicate_suggestions"), count(db_file)
    lines = []
    assert demo_reset.check(db_file, expected, log=lines.append) is True
    assert all(not line.startswith("FAIL") for line in lines)
    assert count(db_file, "duplicate_suggestions") == pending and count(db_file) == people   # merges ran on a copy


def test_check_fails_with_a_line_per_mismatch(db_file):
    expected, _ = observed_expectation(db_file)
    wrong = {**expected, "tabs": {**expected["tabs"], "giver": expected["tabs"]["giver"] + 1},
             "gifts": expected["gifts"] + 1, "alerts": expected["alerts"] + ["Nobody Real"]}
    lines = []
    assert demo_reset.check(db_file, wrong, log=lines.append) is False
    fails = [line for line in lines if line.startswith("FAIL")]
    assert any(line.startswith("FAIL Givers") for line in fails)
    assert sum("gifts" in line for line in fails) == 2                # before and after approval
    assert any("gift alerts" in line and "missing ['nobody real']" in line for line in fails)


def test_compare_reports_unexpected_alerts():
    expected = {"tabs": {"giver": 1, "neighbor": 0, "community": 0}, "gifts": 1, "amount": 5, "alerts": ["A"]}
    observed = {"pre": {"giver": 1}, "post": {"giver": 1, "neighbor": 0, "community": 0},
                "pre_gifts": (1, 5.0), "post_gifts": (1, 5.0), "alerts": ["A", "B"], "alert_count": 2}
    lines = demo_reset.compare(expected, observed)
    assert [ok for ok, _ in lines] == [True, True, True, True, True, False]
    assert "unexpected ['b']" in lines[-1][1]


def test_expected_numbers_come_from_the_answer_key():
    e = demo_reset.expected_from_answer_key()
    assert e["tabs"] == {"giver": 33, "neighbor": 20, "community": 15}
    assert (e["gifts"], e["amount"]) == (131, 1367535)
    assert len(e["alerts"]) == 5 and "Hye-jin Park" in e["alerts"] and e["as_of"] == "2026-11-08"
