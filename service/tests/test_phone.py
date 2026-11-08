"""Phone calls (service/phone.py, routes_phone.py): the guards, both missed-call paths, a full call with a
two-channel recording, and the routes. No network: Twilio and the transcriber are fakes, and the summary and
after-call proposal run on their rules (no model key).
"""

import io
import wave

import numpy as np
import pytest
from fastapi.testclient import TestClient

from service import config, db, phone
from service.main import app

JAMES = 3                      # seed: James Carter
STAFF = "+13055550100"
DONOR = "+13055550142"


@pytest.fixture
def setup(db_file, monkeypatch):
    """A seeded db, James with a phone number, and every guard satisfied."""
    conn = db.connect(db_file)
    conn.execute("UPDATE donors SET phone = '(305) 555-0142' WHERE id = ?", (JAMES,))
    conn.commit()
    for name, value in {"PHONE_CALLS": "on", "TWILIO_ACCOUNT_SID": "ACtest", "TWILIO_AUTH_TOKEN": "token",
                        "STAFF_PHONE": "305-555-0100", "SEND_ALLOWLIST": "305 555 0142",
                        "TWILIO_PHONE_NUMBER": "+17865550199"}.items():
        monkeypatch.setenv(name, value)
    monkeypatch.delenv("PHONE_STAFF_CHANNEL", raising=False)
    monkeypatch.delenv("PHONE_KEEP_RECORDING", raising=False)
    monkeypatch.setenv("AFTER_CALL_DRAFTER", "rules")
    monkeypatch.setattr(config, "HAS_OPENAI_KEY", False)
    phone._WORKERS.clear()
    yield conn
    conn.close()


def wav(channels: list[np.ndarray], rate: int = 8000) -> bytes:
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(len(channels))
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(np.stack(channels, axis=1).astype(np.int16).tobytes())
    return buf.getvalue()


STAFF_SIDE = np.full(800, 1000)     # the staff member's channel, marked by its sample value
HEARD_SIDE = np.full(800, -1000)    # what the staff phone heard: the prompt, then the donor


def fake_transcriber(audio: bytes, mime: str) -> list[dict]:
    assert mime == "audio/wav"
    with wave.open(io.BytesIO(audio)) as w:
        assert w.getnchannels() == 1
        first = np.frombuffer(w.readframes(1), dtype=np.int16)[0]
    if first == 1000:
        return [{"speaker": "spk:0", "text": "Hi James, it's Sam from the Foundation.", "start": 3.0, "end": 5.0},
                {"speaker": "spk:0", "text": "I'll send you the gala details by email.", "start": 20.0, "end": 23.0}]
    return [{"speaker": "spk:0", "text": "Calling James Carter. Please hold.", "start": 0.2, "end": 2.0},
            {"speaker": "spk:0", "text": "Hi Sam! I'd love to bring my family to the gala.", "start": 9.0, "end": 12.0}]


class FakeTwilio:
    """Each leg plays a scripted list of statuses: fetch_call returns the next one and then repeats the last."""

    def __init__(self, staff: list[str], donor: list[str] | None = None, recording: bytes | None = None):
        self.script = {"CA-staff": list(staff), "CA-donor": list(donor or ["ringing"])}
        self.created, self.updates, self.deleted = [], [], []
        self.recording = recording

    def create_call(self, to, from_, twiml, record=False):
        sid = "CA-staff" if not self.created else "CA-donor"
        self.created.append({"to": to, "from": from_, "twiml": twiml, "record": record})
        return {"sid": sid}

    def fetch_call(self, sid):
        steps = self.script[sid]
        status = steps.pop(0) if len(steps) > 1 else steps[0]
        return {"status": status, "duration": "42" if sid == "CA-donor" else "50"}

    def update_call(self, sid, twiml=None, status=None):
        self.updates.append({"sid": sid, "twiml": twiml, "status": status})
        if status:
            self.script[sid] = [status]
        return {}

    def recordings(self, call_sid):
        assert call_sid == "CA-staff"
        return [{"sid": "RE1", "status": "completed"}] if self.recording else []

    def download(self, sid):
        return self.recording

    def delete_recording(self, sid):
        self.deleted.append(sid)


def run(conn, db_file, fake, transcriber=fake_transcriber) -> dict:
    call = phone.start_call(conn, JAMES, client=fake, background=False)
    phone.run_call(call["id"], fake, sleep=lambda s: None, connect=lambda: db.connect(db_file), transcriber=transcriber)
    return phone.get_call(conn, call["id"])


# ----------------------------------------------------------------------------------------------
# Numbers and guards
# ----------------------------------------------------------------------------------------------

def test_e164_and_pretty():
    assert phone.e164("(305) 555-0142") == "+13055550142"
    assert phone.e164("1 305 555 0142") == "+13055550142"
    assert phone.e164("+44 20 7946 0958") == "+442079460958"
    assert phone.e164("555-0142") is None and phone.e164(None) is None
    assert phone.pretty("+13055550142") == "+1 (305) 555-0142"
    assert phone.pretty("+442079460958") == "+442079460958" and phone.pretty(None) is None


def test_preview_is_ready_and_shows_full_numbers(setup):
    p = phone.preview(setup, JAMES)
    assert p["ready"] and p["reason"] is None
    assert p["donor_name"] == "James Carter"
    assert p["donor_phone"] == "+1 (305) 555-0142" and p["staff_phone"] == "+1 (305) 555-0100"
    assert "recorded" in p["notice"]


@pytest.mark.parametrize("env, expected", [
    ({"PHONE_CALLS": "off"}, "Phone calls are off"),
    ({"STAFF_PHONE": ""}, "STAFF_PHONE"),
    ({"TWILIO_AUTH_TOKEN": ""}, "Twilio isn't set up"),
    ({"SEND_ALLOWLIST": ""}, "isn't on SEND_ALLOWLIST"),
    ({"SEND_ALLOWLIST": "305 555 9999"}, "isn't on SEND_ALLOWLIST"),
    ({"TWILIO_PHONE_NUMBER": ""}, "TWILIO_PHONE_NUMBER"),
    ({"STAFF_PHONE": "305-555-0142"}, "your own number"),
])
def test_preview_names_what_is_missing(setup, monkeypatch, env, expected):
    for name, value in env.items():
        monkeypatch.setenv(name, value)
    p = phone.preview(setup, JAMES)
    assert not p["ready"] and expected in p["reason"]


def test_no_phone_on_file(setup):
    setup.execute("UPDATE donors SET phone = NULL WHERE id = ?", (JAMES,))
    setup.commit()
    assert phone.preview(setup, JAMES)["reason"] == "No phone number on file for James Carter"


def test_refused_call_never_reaches_twilio(setup, monkeypatch):
    monkeypatch.setenv("SEND_ALLOWLIST", "")
    fake = FakeTwilio(["ringing"])
    with pytest.raises(phone.PhoneError, match="SEND_ALLOWLIST"):
        phone.start_call(setup, JAMES, client=fake, background=False)
    assert fake.created == []
    assert setup.execute("SELECT COUNT(*) FROM phone_calls").fetchone()[0] == 0


def test_unknown_donor(setup):
    with pytest.raises(LookupError):
        phone.preview(setup, 999999)


# ----------------------------------------------------------------------------------------------
# A full call
# ----------------------------------------------------------------------------------------------

def test_full_call_saves_a_note_on_the_donor(setup, db_file):
    fake = FakeTwilio(staff=["ringing", "in-progress", "in-progress", "completed"],
                      donor=["ringing", "in-progress", "in-progress", "completed"],
                      recording=wav([STAFF_SIDE, HEARD_SIDE]))
    call = run(setup, db_file, fake)

    # Leg 1 rings the staff phone, recorded in two channels, and holds them in the room
    leg1, leg2 = fake.created
    # Leg 1 shows the Twilio number: a call from your own number lands in your voicemail login
    assert leg1["to"] == STAFF and leg1["from"] == "+17865550199" and leg1["record"] is True
    assert "Calling James Carter. Please hold." in leg1["twiml"] and "<Conference" in leg1["twiml"]
    # Leg 2 shows the staff member's own number, and the notice plays before the donor joins the room
    assert leg2["to"] == DONOR and leg2["from"] == STAFF and leg2["record"] is False
    assert leg2["twiml"].index("recorded for our notes") < leg2["twiml"].index("<Conference")
    room = leg1["twiml"].split('">')[1].split("</Conference")[0]
    assert room in leg2["twiml"]

    assert call["status"] == "done" and call["detail"] is None
    assert call["duration_sec"] == 42 and call["note_id"] == f"phone-{call['id']}"
    assert fake.deleted == ["RE1"]

    note = setup.execute("SELECT * FROM call_notes WHERE id = ?", (call["note_id"],)).fetchone()
    saved = db.call_note_out(note)
    assert saved["destinations"] == [{"kind": "donor", "id": str(JAMES), "label": "James Carter"}]
    # "you" and "them" come from the channels, in time order, without the app's own prompt
    assert [(l["speaker"], l["at"]) for l in saved["transcript"]] == [("you", 3.0), ("them", 9.0), ("you", 20.0)]
    assert not any("Please hold" in l["text"] for l in saved["transcript"])
    assert saved["summary"] and "recorded for our notes" in saved["notes"]
    assert call["result"]["summary"] == saved["summary"]
    assert isinstance(call["result"]["actions"], list)

    # The donor's record lists the note, like any other call note
    assert [n["id"] for n in db.list_call_notes(setup, donor_id=JAMES)] == [call["note_id"]]


def test_channel_order_does_not_matter(setup, db_file):
    fake = FakeTwilio(staff=["in-progress", "completed"], donor=["in-progress", "completed"],
                      recording=wav([HEARD_SIDE, STAFF_SIDE]))
    call = run(setup, db_file, fake)
    note = db.call_note_out(setup.execute("SELECT * FROM call_notes WHERE id = ?", (call["note_id"],)).fetchone())
    assert [l["speaker"] for l in note["transcript"]] == ["you", "them", "you"]


def test_keep_recording_setting(setup, db_file, monkeypatch):
    monkeypatch.setenv("PHONE_KEEP_RECORDING", "1")
    fake = FakeTwilio(staff=["in-progress", "completed"], donor=["in-progress", "completed"],
                      recording=wav([STAFF_SIDE, HEARD_SIDE]))
    assert run(setup, db_file, fake)["status"] == "done"
    assert fake.deleted == []


# ----------------------------------------------------------------------------------------------
# Missed calls
# ----------------------------------------------------------------------------------------------

def test_staff_does_not_pick_up(setup, db_file):
    fake = FakeTwilio(staff=["ringing", "no-answer"])
    call = run(setup, db_file, fake)
    assert call["status"] == "failed" and call["detail"] == "You didn't pick up, so we didn't call James Carter."
    assert len(fake.created) == 1                      # the donor was never called
    assert setup.execute("SELECT COUNT(*) FROM call_notes").fetchone()[0] == 0


def test_donor_does_not_answer(setup, db_file):
    fake = FakeTwilio(staff=["in-progress"], donor=["ringing", "no-answer"])
    call = run(setup, db_file, fake)
    assert call["status"] == "failed" and call["detail"] == "James Carter didn't answer."
    goodbye = [u for u in fake.updates if u["sid"] == "CA-staff"]
    assert goodbye and "didn't answer" in goodbye[0]["twiml"]
    assert setup.execute("SELECT COUNT(*) FROM call_notes").fetchone()[0] == 0


def test_staff_hangs_up_while_donor_rings(setup, db_file):
    fake = FakeTwilio(staff=["in-progress", "completed"], donor=["ringing"])
    call = run(setup, db_file, fake)
    assert call["detail"] == "You hung up before James Carter answered."
    assert {"sid": "CA-donor", "twiml": None, "status": "canceled"} in fake.updates


def test_no_recording_fails_plainly(setup, db_file, monkeypatch):
    monkeypatch.setattr(phone, "RECORDING_WAIT_S", 0)
    fake = FakeTwilio(staff=["in-progress", "completed"], donor=["in-progress", "completed"], recording=None)
    call = run(setup, db_file, fake)
    assert call["status"] == "failed" and "no recording" in call["detail"]


def test_a_dead_worker_is_reported_not_left_spinning(setup):
    setup.execute("INSERT INTO phone_calls (id, donor_id, donor_name, status, started_at) "
                  "VALUES ('x1', ?, 'James Carter', 'connected', '2026-11-08T08:00:00.000Z')", (JAMES,))
    setup.commit()
    assert phone.get_call(setup, "x1")["status"] == "connected"
    call = phone.get_call(setup, "x1", check_worker=True)
    assert call["status"] == "failed" and "restarted" in call["detail"]


# ----------------------------------------------------------------------------------------------
# Recording helpers
# ----------------------------------------------------------------------------------------------

def test_split_channels_round_trip():
    a, b = phone.split_channels(wav([STAFF_SIDE, HEARD_SIDE]))
    for track, value in ((a, 1000), (b, -1000)):
        with wave.open(io.BytesIO(track)) as w:
            # Twilio's 8 kHz becomes 16 kHz for the transcriber; each channel keeps only its own audio
            assert w.getnchannels() == 1 and w.getframerate() == 16000 and w.getnframes() == 1600
            assert set(np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16)) == {value}
    (mono,) = phone.split_channels(wav([STAFF_SIDE]))
    with wave.open(io.BytesIO(mono)) as w:
        assert w.getnchannels() == 1 and w.getframerate() == 16000
    already = wav([STAFF_SIDE], rate=16000)
    assert phone.split_channels(already) == [already]


def test_upsample_keeps_the_waveform():
    ramp = np.arange(0, 800, 100, dtype=np.int16)            # 0, 100, ... 700 at 8 kHz
    out, rate = phone._upsample(ramp, 8000)
    assert rate == 16000 and len(out) == 16
    assert out[0] == 0 and out[-1] == 700 and np.all(np.diff(out) >= 0)


def test_is_prompt():
    prompt = phone.HOLD_PROMPT.format(name="James Carter")
    assert phone.is_prompt("Calling James Carter, please hold.", prompt)
    assert not phone.is_prompt("James, please hold the date for the gala in March.", prompt)


# ----------------------------------------------------------------------------------------------
# Routes
# ----------------------------------------------------------------------------------------------

def test_routes(setup, monkeypatch):
    client = TestClient(app)
    assert client.get(f"/phone/preview?donor_id={JAMES}").json()["ready"] is True
    assert client.get("/phone/preview?donor_id=999999").status_code == 404
    assert client.get("/phone/calls/nope").status_code == 404

    monkeypatch.setenv("PHONE_CALLS", "off")
    r = client.post("/phone/calls", json={"donor_id": JAMES})
    assert r.status_code == 409 and "Phone calls are off" in r.json()["detail"]


# ----------------------------------------------------------------------------------------------
# Transcription failures (live call, Sun Nov 8: "[WinError 10054] ... forcibly closed by the remote host")
# ----------------------------------------------------------------------------------------------

def flaky(failures: int):
    """A transcriber that drops the connection `failures` times, then works."""
    left = {"n": failures}

    def transcriber(audio, mime):
        if left["n"] > 0:
            left["n"] -= 1
            raise ConnectionResetError("[WinError 10054] An existing connection was forcibly closed by the remote host")
        return fake_transcriber(audio, mime)
    return transcriber


def recorded_call():
    return FakeTwilio(staff=["in-progress", "completed"], donor=["in-progress", "completed"],
                      recording=wav([STAFF_SIDE, HEARD_SIDE]))


def test_a_dropped_connection_is_retried(setup, db_file, monkeypatch):
    monkeypatch.setattr(phone, "RETRY_PAUSES", (0, 0))
    fake = recorded_call()
    call = run(setup, db_file, fake, transcriber=flaky(2))      # 2 drops, then it works
    assert call["status"] == "done" and call["note_id"]
    assert fake.deleted == ["RE1"]


def test_transcript_failure_keeps_the_recording_and_try_again_finishes(setup, db_file, monkeypatch):
    monkeypatch.setattr(phone, "RETRY_PAUSES", (0, 0))
    fake = recorded_call()
    call = run(setup, db_file, fake, transcriber=flaky(99))     # every attempt drops
    assert call["status"] == "failed" and call["result"] == {"retryable": True}
    assert "recording is kept" in call["detail"] and call["recording_sid"] == "RE1"
    assert fake.deleted == [] and call["note_id"] is None        # nothing said on the call is lost
    assert setup.execute("SELECT COUNT(*) FROM call_notes").fetchone()[0] == 0

    again = phone.retry_call(setup, call["id"], client=fake, background=False)
    assert again["status"] == "processing" and again["result"] == {}
    phone.run_call(call["id"], fake, sleep=lambda s: None, connect=lambda: db.connect(db_file),
                   transcriber=fake_transcriber, step=phone._finish)
    done = phone.get_call(setup, call["id"])
    assert done["status"] == "done" and done["note_id"] == f"phone-{call['id']}"
    assert fake.deleted == ["RE1"]
    assert len(fake.created) == 2                                # Try again places no new call


def test_try_again_is_refused_unless_a_recorded_transcript_failed(setup, db_file):
    call = run(setup, db_file, FakeTwilio(staff=["ringing", "no-answer"]))
    with pytest.raises(phone.PhoneError, match="tried again"):
        phone.retry_call(setup, call["id"], client=FakeTwilio(["ringing"]), background=False)
    client = TestClient(app)
    assert client.post("/phone/calls/nope/retry").status_code == 404
    assert client.post(f"/phone/calls/{call['id']}/retry").status_code == 409


def test_trial_message_and_prompts_never_reach_the_transcript():
    """The live call's 'them' channel opened with the trial message and the hold prompt as ONE line, and the
    staff phone's mic caught the donor's notice; none of it was said by anyone on the call."""
    def live_shaped(audio, mime):
        with wave.open(io.BytesIO(audio)) as w:
            first = np.frombuffer(w.readframes(1), dtype=np.int16)[0]
        if first == 1000:   # the staff phone's channel
            return [{"speaker": "spk:0", "text": "Hi, I'm calling to Hello, this call is recorded for our notes.", "start": 32.8},
                    {"speaker": "spk:0", "text": "Hey, how's it going?", "start": 42.8}]
        return [{"speaker": "spk:0", "start": 0.0, "text": "you have a trial account. You can remove this message at any "
                 "time by upgrading to a full account. Press any key to execute your code. Calling James Carter. Please hold."},
                {"speaker": "spk:0", "text": "Oh, awesome. Thanks.", "start": 43.5}]
    lines = phone.transcript_from_recording(wav([HEARD_SIDE, STAFF_SIDE]), "James Carter", live_shaped)
    assert [(l["speaker"], l["text"]) for l in lines] == [
        ("you", "Hi, I'm calling to"), ("you", "Hey, how's it going?"), ("them", "Oh, awesome. Thanks.")]


def test_strip_phrases():
    assert phone.strip_phrases("you have a trial account. Hi there!", list(phone.TRIAL_PHRASES)) == "Hi there!"
    assert phone.strip_phrases("CALLING james carter, please hold", ["Calling James Carter. Please hold."]) == ""
    assert phone.has_phrase("... Calling James Carter. Please hold.", "Calling James Carter. Please hold.")
