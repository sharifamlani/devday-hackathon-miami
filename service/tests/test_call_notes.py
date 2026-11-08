"""B3 voice (plan §21.2.7, §21.5): call_notes table, save/list/undo, the live relay and the file pass.

No network: Gemini is replaced by a fake Live session (transcribe.live_connect) or a stubbed
transcribe_file, and the summary model by a stubbed call_notes.summarize.
"""

import asyncio
import contextlib
import sqlite3
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from service import call_notes, db, transcribe
from service.main import app

NOTE = {"title": "Call with Rosa Delgado · card update", "folder": "Call notes",
        "segments": [{"speaker": "Denise", "text": "Hi Rosa, your monthly gift didn't go through.", "start": 0.1, "end": 3.2},
                     {"speaker": "Rosa", "text": "I got a new card. Put me down for the beach cleanup.", "start": 3.6, "end": 7.0}],
        "staff_name": "Denise", "contact_name": "Rosa Delgado", "duration_s": 7.0}


def count(path) -> int:
    c = db.connect(path)
    try:
        return c.execute("SELECT COUNT(*) FROM call_notes").fetchone()[0]
    finally:
        c.close()


@pytest.fixture
def client(db_file, monkeypatch):
    monkeypatch.setattr(call_notes, "summarize", lambda text: "Rosa has a new card and will join the beach cleanup.")
    monkeypatch.setenv("GEMINI_API_KEY", "test-key")
    return TestClient(app)


# --- schema --------------------------------------------------------------------------------------------

def test_schema_creates_call_notes_and_leaves_donors_alone(conn):
    cols = [r[1] for r in conn.execute("PRAGMA table_info(call_notes)")]
    assert cols == ["id", "person_id", "title", "folder", "transcript", "segments", "staff_name",
                    "contact_name", "duration_s", "summary", "created_at"]
    assert "call_notes" not in {r[1] for r in conn.execute("PRAGMA table_info(donors)")}
    db.create_schema(conn)   # idempotent
    assert "call_notes" in db.TABLES


# --- service functions ---------------------------------------------------------------------------------

def test_save_list_undo(conn):
    pid = db.insert_donor(conn, {"full_name": "Rosa Delgado", "donor_type": "individual"})
    saved = call_notes.save_call_note(conn, pid, NOTE, summary="s")
    assert saved["undo_token"] == f"call_note:{saved['id']}" and saved["summary"] == "s"
    [row] = call_notes.list_call_notes(conn, pid)
    assert row["segments"][1]["speaker"] == "Rosa" and row["contact_name"] == "Rosa Delgado"
    assert row["transcript"].startswith("Denise: Hi Rosa")   # built from segments when none is given
    assert call_notes.undo_call_note(conn, saved["undo_token"]) is True
    assert call_notes.list_call_notes(conn, pid) == []
    assert call_notes.undo_call_note(conn, saved["undo_token"]) is False   # already gone
    assert call_notes.undo_call_note(conn, "task:1") is False              # not ours


def test_summary_failure_still_saves(conn, monkeypatch):
    monkeypatch.setattr(call_notes.config, "HAS_OPENAI_KEY", False)
    pid = db.insert_donor(conn, {"full_name": "Rosa Delgado", "donor_type": "individual"})
    saved = call_notes.save_call_note(conn, pid, NOTE)
    assert saved["summary"] is None and call_notes.get_call_note(conn, saved["id"])["title"] == NOTE["title"]


def test_group_and_name_speakers():
    words = [{"speaker": "spk:0", "text": "Hi", "start_offset": "0.100s", "end_offset": "0.200s"},
             {"speaker": "spk:0", "text": "Rosa.", "start_offset": "0.200s", "end_offset": "0.800s"},
             {"speaker": "spk:1", "text": "Hello.", "start_offset": "1.000s", "end_offset": "1.500s"},
             {"speaker": "spk:2", "text": "Hey.", "start_offset": "2.000s", "end_offset": "2.300s"}]
    segs = transcribe.group_words(words)
    assert segs[0] == {"speaker": "spk:0", "text": "Hi Rosa.", "start": 0.1, "end": 0.8}
    named = transcribe.name_speakers(segs, "Denise", "Rosa")
    assert [s["speaker"] for s in named] == ["Denise", "Rosa", "Speaker 3"]
    assert [s["speaker"] for s in transcribe.name_speakers(segs, None, None)] == ["Speaker 1", "Speaker 2", "Speaker 3"]


# --- call-note routes ----------------------------------------------------------------------------------

def test_post_and_get_call_notes_survive_a_new_connection(client, db_file):
    r = client.post("/people/1/call-notes", json=NOTE)
    assert r.status_code == 200, r.text
    body = r.json()
    assert set(body) == {"id", "summary", "created_at", "undo_token"} and body["summary"].startswith("Rosa")
    # a fresh client and connection (what a restart gives) still sees the note
    rows = TestClient(app).get("/people/1/call-notes").json()
    assert [n["id"] for n in rows] == [body["id"]] and rows[0]["segments"][0]["speaker"] == "Denise"
    assert count(db_file) == 1


def test_post_call_note_rejects_unknown_person_and_empty(client, db_file):
    assert client.post("/people/99999/call-notes", json=NOTE).status_code == 404
    assert client.post("/people/1/call-notes", json={"title": "x"}).status_code == 400
    assert count(db_file) == 0


# --- /transcribe/file ----------------------------------------------------------------------------------

def test_transcribe_file_names_speakers(client, monkeypatch):
    seen = {}

    def fake(data, mime):
        seen.update(n=len(data), mime=mime)
        return [{"speaker": "spk:0", "text": "Hi Rosa.", "start": 0.1, "end": 0.8},
                {"speaker": "spk:1", "text": "Hello.", "start": 1.0, "end": 1.5}]

    monkeypatch.setattr(transcribe, "transcribe_file", fake)
    r = client.post("/transcribe/file", files={"audio": ("call.webm", b"\x1a\x45\xdf\xa3fake", "audio/webm;codecs=opus")},
                    data={"staff_name": "Denise", "contact_name": "Rosa"})
    assert r.status_code == 200, r.text
    assert [s["speaker"] for s in r.json()["segments"]] == ["Denise", "Rosa"]
    assert seen == {"n": 8, "mime": "audio/webm"}


def test_transcribe_file_errors(client, monkeypatch):
    assert client.post("/transcribe/file", files={"audio": ("a.webm", b"", "audio/webm")}).status_code == 400
    monkeypatch.setattr(transcribe, "transcribe_file", lambda d, m: (_ for _ in ()).throw(RuntimeError("boom")))
    assert client.post("/transcribe/file", files={"audio": ("a.webm", b"x", "audio/webm")}).status_code == 502
    monkeypatch.delenv("GEMINI_API_KEY")
    assert client.post("/transcribe/file", files={"audio": ("a.webm", b"x", "audio/webm")}).status_code == 503


# --- WS /transcribe/live -------------------------------------------------------------------------------

def msg(interim=None, final=None, turn_complete=False):
    t = lambda s: SimpleNamespace(text=s) if s else None
    return SimpleNamespace(server_content=SimpleNamespace(
        interim_input_transcription=t(interim), input_transcription=t(final),
        turn_complete=turn_complete, generation_complete=False))


class FakeSession:
    """Echoes a scripted transcript: two interims while audio flows, the final once the stream ends."""
    def __init__(self, finalize=True):
        self.frames, self.ended, self.finalize = [], asyncio.Event(), finalize

    async def send_realtime_input(self, audio=None, audio_stream_end=None):
        if audio is not None:
            self.frames.append(audio.data)
        if audio_stream_end:
            self.ended.set()

    async def receive(self):
        yield msg(interim="Who gave")
        yield msg(interim="Who gave")            # duplicate: not re-sent
        yield msg(interim="Who gave this quarter")
        await self.ended.wait()
        if self.finalize:
            yield msg(final="Who gave this quarter?", turn_complete=True)
        else:
            await asyncio.sleep(60)


def fake_connect(sessions, finalize=True):
    @contextlib.asynccontextmanager
    async def connect(purpose):
        s = FakeSession(finalize)
        sessions.append((purpose, s))
        yield s
    return connect


def drain(ws) -> list[dict]:
    out = []
    with contextlib.suppress(WebSocketDisconnect):
        while True:
            out.append(ws.receive_json())
    return out


@pytest.mark.parametrize("purpose", ["call", "dictation"])
def test_live_relay_interim_then_final_and_stores_nothing(client, db_file, monkeypatch, purpose):
    sessions = []
    monkeypatch.setattr(transcribe, "live_connect", fake_connect(sessions))
    with client.websocket_connect(f"/transcribe/live?purpose={purpose}") as ws:
        for _ in range(3):
            ws.send_bytes(b"\x00\x01" * 1600)   # 100 ms of PCM16 at 16 kHz
        ws.send_json({"type": "end"})
        events = drain(ws)
    assert events == [{"type": "interim", "text": "Who gave"}, {"type": "interim", "text": "Who gave this quarter"},
                      {"type": "final", "text": "Who gave this quarter?"}]
    [(seen_purpose, session)] = sessions
    assert seen_purpose == purpose and len(session.frames) == 3
    assert count(db_file) == 0   # neither purpose writes; only POST /people/{id}/call-notes does


def test_live_relay_promotes_last_interim_when_no_final(client, monkeypatch):
    monkeypatch.setattr(transcribe, "END_GRACE_S", 0.2)
    monkeypatch.setattr(transcribe, "live_connect", fake_connect([], finalize=False))
    with client.websocket_connect("/transcribe/live?purpose=dictation") as ws:
        ws.send_bytes(b"\x00\x01" * 1600)
        ws.send_json({"type": "end"})
        events = drain(ws)
    assert events[-1] == {"type": "final", "text": "Who gave this quarter"}


def test_live_relay_refuses_bad_purpose_and_missing_key(client, monkeypatch):
    with client.websocket_connect("/transcribe/live?purpose=karaoke") as ws:
        assert ws.receive_json()["type"] == "error"
    monkeypatch.delenv("GEMINI_API_KEY")
    with client.websocket_connect("/transcribe/live?purpose=call") as ws:
        assert ws.receive_json() == {"type": "error", "detail": "GEMINI_API_KEY not set on the server"}


def test_live_relay_reports_gemini_failure(client, monkeypatch):
    @contextlib.asynccontextmanager
    async def broken(purpose):
        raise ConnectionError("handshake 404")
        yield

    monkeypatch.setattr(transcribe, "live_connect", broken)
    with client.websocket_connect("/transcribe/live?purpose=call") as ws:
        e = ws.receive_json()
    assert e["type"] == "error" and "handshake 404" in e["detail"]
