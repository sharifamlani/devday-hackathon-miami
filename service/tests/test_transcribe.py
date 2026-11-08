"""B3 voice (plan §21.2.7, §21.5): the live relay and the recorded-file pass.

No network: Gemini is replaced by a fake Live session (transcribe.live_connect) or a stubbed
transcribe_file. Neither route writes; call notes persist through routes_calls.py.
"""

import asyncio
import contextlib
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from service import db, transcribe
from service.main import app

SEGMENTS = [{"speaker": "spk:0", "text": "Hi Rosa.", "start": 0.1, "end": 0.8},
            {"speaker": "spk:1", "text": "Hello.", "start": 1.0, "end": 1.5},
            {"speaker": "spk:0", "text": "Your gift didn't go through.", "start": 1.9, "end": 3.0}]


def count(path) -> int:
    c = db.connect(path)
    try:
        return c.execute("SELECT COUNT(*) FROM call_notes").fetchone()[0]
    finally:
        c.close()


@pytest.fixture
def client(db_file, monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY", "test-key")
    return TestClient(app)


# --- word grouping and the you/them mapping -----------------------------------------------------------

def test_group_words_into_speaker_turns():
    words = [{"speaker": "spk:0", "text": "Hi", "start_offset": "0.100s", "end_offset": "0.200s"},
             {"speaker": "spk:0", "text": "Rosa.", "start_offset": "0.200s", "end_offset": "0.800s"},
             {"speaker": "spk:1", "text": "Hello.", "start_offset": "1.000s", "end_offset": "1.500s"}]
    assert transcribe.group_words(words) == [{"speaker": "spk:0", "text": "Hi Rosa.", "start": 0.1, "end": 0.8},
                                             {"speaker": "spk:1", "text": "Hello.", "start": 1.0, "end": 1.5}]


def test_lines_match_routes_calls_shape():
    from service.routes_calls import TranscriptLine
    lines = transcribe.to_transcript_lines(SEGMENTS, them_name="Rosa")
    assert [(l["speaker"], l["name"]) for l in lines] == [("you", "You"), ("them", "Rosa"), ("you", "You")]
    assert lines[2]["at"] == 1.9
    for l in lines:
        TranscriptLine(**l)   # POST /calls accepts them unchanged
    flipped = transcribe.to_transcript_lines(SEGMENTS, first_speaker="them")
    assert [l["speaker"] for l in flipped] == ["them", "you", "them"] and flipped[0]["name"] == "Them"


# --- /transcribe/file ----------------------------------------------------------------------------------

def test_transcribe_file_returns_transcript_lines(client, db_file, monkeypatch):
    seen = {}

    def fake(data, mime):
        seen.update(n=len(data), mime=mime)
        return SEGMENTS

    monkeypatch.setattr(transcribe, "transcribe_file", fake)
    r = client.post("/transcribe/file", files={"audio": ("call.webm", b"Eß£fake", "audio/webm;codecs=opus")},
                    data={"you_name": "Denise", "them_name": "Rosa"})
    assert r.status_code == 200, r.text
    assert [(s["speaker"], s["name"]) for s in r.json()["segments"]] == [("you", "Denise"), ("them", "Rosa"), ("you", "Denise")]
    assert seen == {"n": 8, "mime": "audio/webm"}
    assert count(db_file) == 0


def test_transcribe_file_errors(client, monkeypatch):
    assert client.post("/transcribe/file", files={"audio": ("a.webm", b"", "audio/webm")}).status_code == 400
    monkeypatch.setattr(transcribe, "transcribe_file", lambda d, m: (_ for _ in ()).throw(RuntimeError("boom")))
    assert client.post("/transcribe/file", files={"audio": ("a.webm", b"x", "audio/webm")}).status_code == 502
    assert client.post("/transcribe/file", files={"audio": ("a.webm", b"x", "audio/webm")},
                       data={"first_speaker": "nobody"}).status_code == 422
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
    assert count(db_file) == 0   # neither purpose writes; call notes persist through POST /calls


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
