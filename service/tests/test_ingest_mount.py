"""POST /ingest is mounted on the service app (main.py prefers Carlos's service.ingest.router, else
service.ingest_router) and takes several files at once. The offline test stubs the ingest step; the live
dry run needs OPENAI_API_KEY (the adapter's tab judge and prose reader call the model)."""

import os
import sqlite3
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from service import ingest_router, main
from service.main import app

SAMPLES = Path(__file__).resolve().parents[2] / "data" / "sample_inputs"
TWO = ["give_miami_day_export_2022-2025.xlsx", "board_retreat_notes.md"]


def upload(names):
    return [("files", (n, (SAMPLES / n).read_bytes(), "application/octet-stream")) for n in names]


def test_ingest_is_mounted_on_the_service():
    assert main.INGEST_MOUNTED is True
    assert "/ingest" in app.openapi()["paths"]


def test_two_files_reach_the_adapter_with_target_and_dry_run(db_file, monkeypatch):
    seen = {}

    def fake_ingest(files, target, conn, dry_run):
        seen.update(names=[n for n, _ in files], sizes=[len(b) for _, b in files], target=target, dry_run=dry_run)
        return {"dry_run": dry_run, "people_added": 0, "gifts_added": 0}

    monkeypatch.setattr(ingest_router, "ingest_files", fake_ingest)

    r = TestClient(app).post("/ingest", files=upload(TWO), data={"target": "giver", "dry_run": "true"})

    assert r.status_code == 200 and r.json()["dry_run"] is True
    assert seen["names"] == TWO and all(seen["sizes"]) and seen["target"] == "giver" and seen["dry_run"] is True


@pytest.mark.skipif(not os.getenv("OPENAI_API_KEY"), reason="the ingest adapter calls the model")
def test_live_dry_run_of_two_sample_files_writes_nothing(db_file):
    before = sqlite3.connect(db_file).execute("SELECT COUNT(*) FROM donors").fetchone()[0]

    r = TestClient(app).post("/ingest", files=upload(TWO), data={"target": "auto", "dry_run": "true"})

    assert r.status_code == 200, r.text
    body = r.json()
    assert body["dry_run"] is True and body["people_added"] > 0 and body["gifts_added"] > 0
    assert sqlite3.connect(db_file).execute("SELECT COUNT(*) FROM donors").fetchone()[0] == before
