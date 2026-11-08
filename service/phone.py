"""Call a donor from the staff member's own phone (plan §21 S1). routes_phone.py mounts the routes.

    start_call(conn, donor_id)  -> rings STAFF_PHONE; once answered, rings the donor; returns the phone_calls row
    get_call(conn, call_id)     -> the row (status, detail, note_id, result)
    hang_up(conn, call_id)      -> ends both legs
    retry_call(conn, call_id)   -> Try again: finishes a recorded call whose transcript failed

How a call runs (Twilio, no webhooks: every TwiML document goes inline, and a worker thread polls the REST API,
so the service can stay on 127.0.0.1):
  1. Leg 1 calls STAFF_PHONE, recorded in two channels. The staff member hears "Calling <name>. Please hold."
     and waits in a private conference room.
  2. Once leg 1 is answered, leg 2 calls the donor with caller ID STAFF_PHONE (a Twilio-verified number). The
     donor hears the recording notice (Florida needs every party's consent), then joins the room. Either side
     hanging up ends the room and both legs.
  3. Leg 1's recording has the staff member on one channel and what they heard (the donor) on the other. Each
     channel is transcribed on its own (transcribe.transcribe_file), so "you" and "them" come from the channel,
     not from guessing voices. The channel that holds the "please hold" prompt is the donor's side.
  4. The transcript is summarized (routes_calls.summarize_call), saved as a call note on the donor
     (routes_calls.save_call), and the after-call agent proposes follow-ups (writes nothing until Apply).
  5. The recording is deleted from Twilio once the note is saved (PHONE_KEEP_RECORDING=1 keeps it).

Guards, all checked before Twilio is called: PHONE_CALLS=on, Twilio credentials, STAFF_PHONE, a phone number on
the donor, that number on SEND_ALLOWLIST (outbound.py's rule for live sends), and no other call in progress.
Transcript text is never logged.
"""

from __future__ import annotations

import asyncio
import io
import json
import logging
import os
import re
import sqlite3
import threading
import time
import uuid
import wave
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from typing import Callable
from xml.sax.saxutils import escape

import httpx
import numpy as np

from service import config, db, outbound  # noqa: F401  (config loads .env)

log = logging.getLogger("service.phone")

API = "https://api.twilio.com/2010-04-01/Accounts/{sid}"
POLL_S = float(os.getenv("PHONE_POLL_S", "1.5"))
RING_S = int(os.getenv("PHONE_RING_TIMEOUT_S", "30"))     # how long each phone rings before giving up
MAX_CALL_S = int(os.getenv("PHONE_MAX_CALL_S", "3600"))
RECORDING_WAIT_S = 90                                       # Twilio finishes a recording a few seconds after hang-up
HOLD_PROMPT = "Calling {name}. Please hold."
NOTICE = os.getenv("PHONE_NOTICE", "Hello. This call is recorded for our notes.")
ENDED = {"completed", "busy", "no-answer", "canceled", "failed"}
ACTIVE = ("calling_you", "calling_donor", "connected")
MISSED = {"busy": "was busy", "no-answer": "didn't answer", "canceled": "was canceled", "failed": "couldn't be reached",
          "completed": "hung up"}


class PhoneError(Exception):
    """A refusal or failure the UI shows as-is."""


_WORKERS: dict[str, threading.Thread] = {}   # call id -> its live worker thread (this process only)


def busy() -> bool:
    return any(t.is_alive() for t in list(_WORKERS.values()))


# ----------------------------------------------------------------------------------------------
# Settings and phone numbers
# ----------------------------------------------------------------------------------------------

def enabled() -> bool:
    return (os.getenv("PHONE_CALLS") or "").strip().lower() == "on"


def e164(raw: str | None) -> str | None:
    """'(305) 555-0142' -> '+13055550142'. US numbers without a country code get +1; None if it isn't a number."""
    if not raw:
        return None
    digits = re.sub(r"\D", "", raw)
    if raw.strip().startswith("+") and 8 <= len(digits) <= 15:
        return "+" + digits
    if len(digits) == 10:
        return "+1" + digits
    if len(digits) == 11 and digits.startswith("1"):
        return "+" + digits
    return None


def pretty(number: str | None) -> str | None:
    """'+13055550142' -> '+1 (305) 555-0142'; other countries as stored. Shown in full: it's the CRM's job."""
    if number and number.startswith("+1") and len(number) == 12:
        return f"+1 ({number[2:5]}) {number[5:8]}-{number[8:]}"
    return number


def shown(raw: str | None) -> str | None:
    """Any stored number in full, formatted when it parses ('305-555-0142' -> '+1 (305) 555-0142')."""
    return pretty(e164(raw)) or raw or None


def staff_phone() -> str | None:
    return e164(os.getenv("STAFF_PHONE"))


def twilio_number() -> str | None:
    """Caller ID for leg 1. Never STAFF_PHONE: a carrier sends a call from your own number to your voicemail login."""
    return e164(os.getenv("TWILIO_PHONE_NUMBER"))


def has_twilio() -> bool:
    return bool(os.getenv("TWILIO_ACCOUNT_SID") and os.getenv("TWILIO_AUTH_TOKEN"))


def allowlisted(number: str) -> bool:
    return outbound._norm(number) in outbound.allowlist()


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


# ----------------------------------------------------------------------------------------------
# Twilio REST, the four calls this needs. Tests replace the whole object.
# ----------------------------------------------------------------------------------------------

class Twilio:
    def __init__(self, sid: str, token: str):
        self.base = API.format(sid=sid)
        self.http = httpx.Client(auth=(sid, token), timeout=30)

    def _check(self, r: httpx.Response) -> httpx.Response:
        if r.status_code >= 400:
            try:
                message = r.json().get("message") or r.text
            except ValueError:
                message = r.text
            raise PhoneError(f"Twilio said: {message}"[:300])
        return r

    def create_call(self, to: str, from_: str, twiml: str, record: bool = False) -> dict:
        data = {"To": to, "From": from_, "Twiml": twiml, "Timeout": str(RING_S)}
        if record:
            data |= {"Record": "true", "RecordingChannels": "dual"}
        return self._check(self.http.post(f"{self.base}/Calls.json", data=data)).json()

    def fetch_call(self, call_sid: str) -> dict:
        return self._check(self.http.get(f"{self.base}/Calls/{call_sid}.json")).json()

    def update_call(self, call_sid: str, twiml: str | None = None, status: str | None = None) -> dict:
        data = {"Twiml": twiml} if twiml else {"Status": status}
        return self._check(self.http.post(f"{self.base}/Calls/{call_sid}.json", data=data)).json()

    def recordings(self, call_sid: str) -> list[dict]:
        r = self._check(self.http.get(f"{self.base}/Recordings.json", params={"CallSid": call_sid}))
        return r.json().get("recordings", [])

    def download(self, recording_sid: str) -> bytes:
        r = self.http.get(f"{self.base}/Recordings/{recording_sid}.wav", params={"RequestedChannels": 2},
                          follow_redirects=True)
        return self._check(r).content

    def delete_recording(self, recording_sid: str) -> None:
        self._check(self.http.delete(f"{self.base}/Recordings/{recording_sid}.json"))


def twilio() -> Twilio:
    if not has_twilio():
        raise PhoneError("TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN are not set in .env")
    return Twilio(os.environ["TWILIO_ACCOUNT_SID"], os.environ["TWILIO_AUTH_TOKEN"])


# ----------------------------------------------------------------------------------------------
# TwiML: what each phone hears
# ----------------------------------------------------------------------------------------------

def _room(room: str, wait_silently: bool) -> str:
    wait = ' waitUrl=""' if wait_silently else ""
    return (f'<Dial><Conference beep="false" startConferenceOnEnter="true" endConferenceOnExit="true"{wait}>'
            f"{escape(room)}</Conference></Dial>")


def staff_twiml(room: str, donor_name: str) -> str:
    return f"<Response><Say>{escape(HOLD_PROMPT.format(name=donor_name))}</Say>{_room(room, True)}</Response>"


def donor_twiml(room: str) -> str:
    """The notice plays before the donor joins the room: nothing they say is heard or recorded before it."""
    return f"<Response><Say>{escape(NOTICE)}</Say>{_room(room, False)}</Response>"


def goodbye_twiml(text: str) -> str:
    return f"<Response><Say>{escape(text)}</Say><Hangup/></Response>"


# ----------------------------------------------------------------------------------------------
# The phone_calls row
# ----------------------------------------------------------------------------------------------

def _row(conn: sqlite3.Connection, call_id: str) -> dict | None:
    row = conn.execute("SELECT * FROM phone_calls WHERE id = ?", (call_id,)).fetchone()
    return dict(row) if row else None


def _set(conn: sqlite3.Connection, call_id: str, **fields) -> None:
    if "result" in fields:
        fields["result"] = json.dumps(fields["result"], ensure_ascii=False)
    conn.execute(f"UPDATE phone_calls SET {', '.join(f'{k} = ?' for k in fields)} WHERE id = ?",
                 (*fields.values(), call_id))
    conn.commit()


def _fail(conn: sqlite3.Connection, call_id: str, detail: str) -> None:
    log.info("phone %s failed: %s", call_id, detail)
    _set(conn, call_id, status="failed", detail=detail, ended_at=now_iso())


def get_call(conn: sqlite3.Connection, call_id: str, check_worker: bool = False) -> dict:
    """The row, result parsed. check_worker=True (the status route): a call still marked running with no live
    worker means the service restarted mid-call, so it is marked failed instead of spinning forever."""
    row = _row(conn, call_id)
    if row is None:
        raise LookupError(f"phone call {call_id} not found")
    alive = call_id in _WORKERS and _WORKERS[call_id].is_alive()
    if check_worker and row["status"] in ACTIVE + ("processing",) and not alive:
        _fail(conn, call_id, "The service restarted during this call, so it wasn't transcribed.")
        row = _row(conn, call_id)
    row["result"] = json.loads(row["result"] or "{}")
    return row


# ----------------------------------------------------------------------------------------------
# Before a call: is everything in place?
# ----------------------------------------------------------------------------------------------

def preview(conn: sqlite3.Connection, donor_id: int) -> dict:
    """What the call dialog shows before Call: {ready, reason, donor_name, donor_phone, staff_phone, notice}.
    LookupError for an unknown donor."""
    row = conn.execute("SELECT id, full_name, org_name, phone FROM donors WHERE id = ?", (donor_id,)).fetchone()
    if row is None:
        raise LookupError(f"donor {donor_id} not found")
    name = row["full_name"] or row["org_name"] or f"donor {donor_id}"
    donor, staff = e164(row["phone"]), staff_phone()
    reason = ("Phone calls are off: set PHONE_CALLS=on in .env" if not enabled()
              else "Twilio isn't set up: TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN are missing" if not has_twilio()
              else "Your phone number isn't set: add STAFF_PHONE to .env" if not staff
              else ("No Twilio number: buy one and set TWILIO_PHONE_NUMBER in .env (a call to your phone from "
                    "your own number goes to your voicemail)") if not twilio_number()
              else f"No phone number on file for {name}" if not donor
              else f"{name}'s number is your own number; calling it from itself reaches your voicemail" if donor == staff
              else f"{name}'s number isn't on SEND_ALLOWLIST, so the app won't call it" if not allowlisted(donor)
              else "Another call is in progress" if busy()
              else None)
    return {"ready": reason is None, "reason": reason, "donor_id": donor_id, "donor_name": name,
            "donor_phone": pretty(donor), "staff_phone": pretty(staff), "notice": NOTICE}


# ----------------------------------------------------------------------------------------------
# Placing the call
# ----------------------------------------------------------------------------------------------

def start_call(conn: sqlite3.Connection, donor_id: int, client: Twilio | None = None,
               background: bool = True) -> dict:
    """Ring the staff member's phone and start the worker. PhoneError if anything isn't in place."""
    ready = preview(conn, donor_id)
    if not ready["ready"]:
        raise PhoneError(ready["reason"])
    client = client or twilio()
    staff = staff_phone()
    call_id = uuid.uuid4().hex[:16]
    leg1 = client.create_call(to=staff, from_=twilio_number(),
                              twiml=staff_twiml(f"dd-{call_id}", ready["donor_name"]), record=True)
    conn.execute("INSERT INTO phone_calls (id, donor_id, donor_name, status, staff_call_sid, started_at) "
                 "VALUES (?, ?, ?, 'calling_you', ?, ?)",
                 (call_id, donor_id, ready["donor_name"], leg1["sid"], now_iso()))
    conn.commit()
    log.info("phone %s: ringing the staff phone for donor %s", call_id, donor_id)
    if background:
        worker = threading.Thread(target=run_call, args=(call_id, client), daemon=True, name=f"phone-{call_id}")
        _WORKERS[call_id] = worker
        worker.start()
    return get_call(conn, call_id)


def hang_up(conn: sqlite3.Connection, call_id: str, client: Twilio | None = None) -> dict:
    """End both legs; the worker sees them end and finishes the call (a connected call is still transcribed)."""
    row = get_call(conn, call_id)
    if row["status"] not in ACTIVE:
        return row
    client = client or twilio()
    for sid in (row["donor_call_sid"], row["staff_call_sid"]):
        if sid:
            _end_leg(client, sid)
    return get_call(conn, call_id)


def retry_call(conn: sqlite3.Connection, call_id: str, client: Twilio | None = None, background: bool = True) -> dict:
    """Try again: finish a recorded call whose transcript failed, from the recording kept on Twilio."""
    row = get_call(conn, call_id)
    if row["status"] != "failed" or not row["result"].get("retryable") or row["note_id"]:
        raise PhoneError("Only a recorded call whose transcript failed can be tried again")
    client = client or twilio()
    _set(conn, call_id, status="processing", detail="Getting the recording", result={})
    log.info("phone %s: trying the transcript again", call_id)
    if background:
        worker = threading.Thread(target=run_call, args=(call_id, client), kwargs={"step": _finish}, daemon=True,
                                  name=f"phone-retry-{call_id}")
        _WORKERS[call_id] = worker
        worker.start()
    return get_call(conn, call_id)


def _end_leg(client: Twilio, sid: str) -> None:
    try:
        status = client.fetch_call(sid)["status"]
        if status not in ENDED:
            client.update_call(sid, status="canceled" if status in ("queued", "ringing") else "completed")
    except PhoneError as e:
        log.warning("could not end leg %s: %s", sid, e)


def run_call(call_id: str, client: Twilio, sleep: Callable[[float], None] = time.sleep,
             connect: Callable[[], sqlite3.Connection] = db.connect, transcriber: Callable | None = None,
             step: Callable | None = None) -> None:
    """The worker: one thread per call (step = _drive for a new call, _finish for Try again). Any error marks
    the call failed with the reason."""
    _WORKERS.setdefault(call_id, threading.current_thread())
    conn = connect()
    try:
        (step or _drive)(conn, call_id, client, sleep, transcriber)
    except Exception as e:
        log.exception("phone %s: worker error", call_id)
        _fail(conn, call_id, f"Something went wrong: {type(e).__name__}: {e}"[:300])
    finally:
        conn.close()
        _WORKERS.pop(call_id, None)


def _drive(conn: sqlite3.Connection, call_id: str, client: Twilio, sleep, transcriber) -> None:
    row = get_call(conn, call_id)
    name, staff_sid = row["donor_name"], row["staff_call_sid"]
    donor_phone = e164(conn.execute("SELECT phone FROM donors WHERE id = ?", (row["donor_id"],)).fetchone()[0])

    # 1. The staff member's phone rings
    waited = 0.0
    while True:
        status = client.fetch_call(staff_sid)["status"]
        if status == "in-progress":
            break
        if status in ENDED:
            return _fail(conn, call_id, "You didn't pick up, so we didn't call " + name + "."
                         if status in ("no-answer", "busy", "canceled") else f"Your phone {MISSED[status]}.")
        if waited > RING_S + 30:
            _end_leg(client, staff_sid)
            return _fail(conn, call_id, "You didn't pick up, so we didn't call " + name + ".")
        sleep(POLL_S)
        waited += POLL_S

    # 2. The donor's phone rings, showing the staff member's number
    _set(conn, call_id, status="calling_donor")
    leg2 = client.create_call(to=donor_phone, from_=staff_phone(), twiml=donor_twiml(f"dd-{call_id}"))
    donor_sid = leg2["sid"]
    _set(conn, call_id, donor_call_sid=donor_sid)
    waited = 0.0
    while True:
        donor, staff = client.fetch_call(donor_sid)["status"], client.fetch_call(staff_sid)["status"]
        if donor == "in-progress":
            break
        if staff in ENDED:
            _end_leg(client, donor_sid)
            return _fail(conn, call_id, f"You hung up before {name} answered.")
        if donor in ENDED or waited > RING_S + 30:
            why = MISSED.get(donor, "didn't answer")
            _end_leg(client, donor_sid)
            try:   # tell the staff member, then hang up their leg
                client.update_call(staff_sid, twiml=goodbye_twiml(f"{name} {why}. Goodbye."))
            except PhoneError:
                _end_leg(client, staff_sid)
            return _fail(conn, call_id, f"{name} {why}.")
        sleep(POLL_S)
        waited += POLL_S

    # 3. Talking, until either side hangs up (the conference ends both legs)
    _set(conn, call_id, status="connected", connected_at=now_iso())
    waited = 0.0
    while True:
        donor_leg, staff = client.fetch_call(donor_sid), client.fetch_call(staff_sid)["status"]
        if donor_leg["status"] in ENDED and staff in ENDED:
            break
        if waited > MAX_CALL_S:
            _end_leg(client, donor_sid)
            _end_leg(client, staff_sid)
        sleep(POLL_S)
        waited += POLL_S
    duration = int(donor_leg.get("duration") or 0)
    _set(conn, call_id, status="processing", detail="Getting the recording", ended_at=now_iso(), duration_sec=duration)
    _finish(conn, call_id, client, sleep, transcriber)


def _finish(conn: sqlite3.Connection, call_id: str, client: Twilio, sleep, transcriber) -> None:
    """Steps 4-5, after hang-up: recording -> transcript -> note -> follow-ups -> recording deleted. Shared by a
    live call and Try again (retry_call). If any of it fails, the recording stays on Twilio and the call is
    marked failed with result.retryable, so nothing said on the call is lost."""
    try:
        _transcribe_and_save(conn, call_id, client, sleep, transcriber)
    except Exception as e:
        log.exception("phone %s: processing failed; the recording is kept", call_id)
        _set(conn, call_id, status="failed", ended_at=now_iso(), result={"retryable": True},
             detail=(f"The call was recorded, but the transcript couldn't be finished ({type(e).__name__}: {e}). "
                     "The recording is kept: click Try again.")[:400])


def _transcribe_and_save(conn: sqlite3.Connection, call_id: str, client: Twilio, sleep, transcriber) -> None:
    row = get_call(conn, call_id)
    name, staff_sid, duration = row["donor_name"], row["staff_call_sid"], row["duration_sec"]

    # 4. The recording -> a transcript with "you" and "them" from the channels
    recording, waited = None, 0.0
    while recording is None:
        recording = next((r for r in client.recordings(staff_sid) if r.get("status") == "completed"), None)
        if recording is None:
            if waited > RECORDING_WAIT_S:
                return _fail(conn, call_id, "Twilio has no recording for this call, so there is no transcript.")
            sleep(POLL_S * 2)
            waited += POLL_S * 2
    _set(conn, call_id, recording_sid=recording["sid"], detail="Transcribing")
    lines = transcript_from_recording(client.download(recording["sid"]), name, transcriber)

    # 5. Summary, saved note, proposed follow-ups
    _set(conn, call_id, detail="Summarizing")
    note, summary = save_note(conn, get_call(conn, call_id), lines)
    _set(conn, call_id, note_id=note["id"], detail="Suggesting follow-ups")
    proposal = propose_actions(conn, note["id"])
    if os.getenv("PHONE_KEEP_RECORDING", "").strip() not in ("1", "on", "true"):
        try:
            client.delete_recording(recording["sid"])
        except PhoneError as e:
            log.warning("phone %s: recording not deleted: %s", call_id, e)
    _set(conn, call_id, status="done", detail=None, result={
        "summary": note["summary"], "next_steps": note["next_steps"], "summary_source": summary["source"],
        "transcript_lines": len(lines), "steps": proposal.get("steps", []),
        "actions": [{k: a.get(k) for k in ("id", "type", "label", "evidence")} for a in proposal.get("actions", [])],
        "actions_detail": proposal.get("error")})
    log.info("phone %s: done (%d lines, %s s)", call_id, len(lines), duration)


# ----------------------------------------------------------------------------------------------
# Recording -> transcript
# ----------------------------------------------------------------------------------------------

# Twilio records at 8 kHz. Probed: the file model transcribed 8 kHz speech word for word too; 16 kHz is the rate the
# voice lane tested, so tracks are sent at that. (The first request of a process takes ~13 s, later ones ~2 s.)
TRANSCRIBE_RATE = 16000


def _upsample(track: np.ndarray, rate: int) -> tuple[np.ndarray, int]:
    """16-bit samples at `rate` -> TRANSCRIBE_RATE by linear interpolation (already there or higher: unchanged)."""
    if rate >= TRANSCRIBE_RATE or track.dtype != np.int16 or len(track) < 2:
        return track, rate
    n = int(len(track) * TRANSCRIBE_RATE / rate)
    out = np.interp(np.linspace(0, len(track) - 1, n), np.arange(len(track)), track.astype(np.float64))
    return np.round(out).astype(np.int16), TRANSCRIBE_RATE


def split_channels(wav_bytes: bytes) -> list[bytes]:
    """A WAV -> one mono 16 kHz WAV per channel (16-bit audio is upsampled; other widths pass at their rate)."""
    with wave.open(io.BytesIO(wav_bytes)) as w:
        channels, width, rate = w.getnchannels(), w.getsampwidth(), w.getframerate()
        frames = w.readframes(w.getnframes())
    samples = np.frombuffer(frames, dtype={1: np.uint8, 2: np.int16, 4: np.int32}[width]).reshape(-1, channels)
    out = []
    for c in range(channels):
        track, track_rate = _upsample(np.ascontiguousarray(samples[:, c]), rate)
        buf = io.BytesIO()
        with wave.open(buf, "wb") as o:
            o.setnchannels(1)
            o.setsampwidth(width)
            o.setframerate(track_rate)
            o.writeframes(track.tobytes())
        out.append(buf.getvalue())
    return out


def _words(text: str) -> list[str]:
    return re.findall(r"[a-z0-9']+", text.lower())


def is_prompt(text: str, prompt: str) -> bool:
    """True when a transcribed line is mostly the app's own spoken prompt."""
    words, prompt_words = _words(text), set(_words(prompt))
    return bool(words) and sum(w in prompt_words for w in words) / len(words) >= 0.6


# What the phones hear that nobody on the call said: our prompts, and Twilio's trial-account message (a live call,
# Sun Nov 8, transcribed all of it as one "them" line with the hold prompt).
TRIAL_PHRASES = ("You have a trial account", "You can remove this message at any time by upgrading to a full account",
                 "Press any key to execute your code")


def has_phrase(text: str, phrase: str) -> bool:
    words = _words(phrase)
    return bool(words) and re.search(r"\W*".join(re.escape(w) for w in words), text, flags=re.IGNORECASE) is not None


def strip_phrases(text: str, phrases: list[str]) -> str:
    """Remove each phrase wherever it appears (case and punctuation ignored); collapse what's left."""
    for phrase in phrases:
        words = _words(phrase)
        if words:
            text = re.sub(r"\W*".join(re.escape(w) for w in words) + r"\W*", " ", text, flags=re.IGNORECASE)
    return re.sub(r"\s+", " ", text).strip().lstrip(".,;: ")   # a removed phrase can leave leading punctuation


# Each transcription request is retried after these pauses (seconds): a live call (Sun Nov 8) lost its transcript to
# one dropped connection ("[WinError 10054] ... forcibly closed by the remote host") from the speech service.
RETRY_PAUSES = (2.0, 5.0)


def with_retries(fn: Callable, *args):
    """fn(*args), tried 1 + len(RETRY_PAUSES) times; the last error is raised."""
    for pause in (*RETRY_PAUSES, None):
        try:
            return fn(*args)
        except Exception as e:
            if pause is None:
                raise
            log.warning("phone: %s failed (%s); retrying in %.0f s", getattr(fn, "__name__", "call"), type(e).__name__, pause)
            time.sleep(pause)


def transcript_from_recording(wav_bytes: bytes, donor_name: str, transcriber: Callable | None = None) -> list[dict]:
    """[{speaker: you|them, name, text, at}] in time order, the app's own prompt removed."""
    from service import transcribe
    transcriber = transcriber or transcribe.transcribe_file
    tracks = split_channels(wav_bytes)
    with ThreadPoolExecutor(max_workers=len(tracks)) as pool:
        segments = list(pool.map(lambda audio: with_retries(transcriber, audio, "audio/wav"), tracks))
    prompt = HOLD_PROMPT.format(name=donor_name)
    # The donor's side is the channel that carried the prompt played to the staff phone (found before it's stripped)
    has_prompt = [any(has_phrase(seg["text"], prompt) for seg in segs) for segs in segments]
    noise = [prompt, NOTICE, *TRIAL_PHRASES]
    for segs in segments:
        for seg in segs:
            seg["text"] = strip_phrases(seg["text"], noise)
    segments = [[seg for seg in segs if len(_words(seg["text"])) >= 1] for segs in segments]
    if len(tracks) == 1:   # a mono file: fall back to the model's speaker labels
        lines = transcribe.to_transcript_lines(segments[0], "you", "You", donor_name)
        return [l for l in lines if not is_prompt(l["text"], prompt)]

    override = os.getenv("PHONE_STAFF_CHANNEL", "").strip()
    if override in ("1", "2"):
        staff_track = int(override) - 1
    elif has_prompt.count(True) == 1:
        staff_track = has_prompt.index(False)
    else:
        staff_track = 0
        log.warning("phone: couldn't tell the channels apart by the prompt; channel 1 is taken as the staff side")
    lines = []
    for i, segs in enumerate(segments[:2]):
        side = "you" if i == staff_track else "them"
        for s in segs:
            if side == "them" and is_prompt(s["text"], prompt):
                continue
            text = re.sub(r"\s+", " ", s["text"]).strip()
            if text:
                lines.append({"speaker": side, "name": "You" if side == "you" else donor_name,
                              "text": text[:4000], "at": float(s.get("start") or 0)})
    return sorted(lines, key=lambda l: l["at"])


# ----------------------------------------------------------------------------------------------
# Transcript -> call note and follow-ups, through the same code the transcript pane uses
# ----------------------------------------------------------------------------------------------

def save_note(conn: sqlite3.Connection, call: dict, lines: list[dict]) -> tuple[dict, dict]:
    from service import routes_calls as rc
    title = f"Phone call with {call['donor_name']}"
    notes = f"Recorded phone call placed from Donor Desk. Before joining, the donor heard: “{NOTICE}”"
    transcript = [rc.TranscriptLine(**l) for l in lines[:rc.MAX_LINES]]
    summary = asyncio.run(rc.summarize_call(
        rc.SummarizeRequest(title=title, transcript=transcript, notes="", donor_id=call["donor_id"]), conn))
    note = rc.save_call(rc.CallNoteIn(
        id=f"phone-{call['id']}", title=title, created_at=call["started_at"], duration_sec=call["duration_sec"],
        destinations=[rc.NoteDestination(kind="donor", id=str(call["donor_id"]), label=call["donor_name"])],
        transcript=transcript, notes=notes, summary=summary["summary"], next_steps=summary["next_steps"]), conn)
    return note, summary


def propose_actions(conn: sqlite3.Connection, note_id: str) -> dict:
    try:
        from service import after_call_agent
        return after_call_agent.propose(conn, note_id)
    except Exception as e:   # the note is saved either way; follow-ups can be asked for again
        log.warning("phone: after-call proposal failed: %s", type(e).__name__)
        return {"steps": [], "actions": [], "error": f"Follow-ups couldn't be suggested ({type(e).__name__})"}
