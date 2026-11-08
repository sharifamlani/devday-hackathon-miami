"""Voice transcription (plan §21.2.7): the live relay and the recorded-file pass. routes_voice.py mounts both.

Live: the browser sends raw PCM16 LE 16 kHz mono frames (~100 ms) over our WebSocket; relay() forwards them to
the Gemini Live API and sends back {"type": "interim" | "final", "text"} as the words arrive. The browser
sends {"type": "end"} when the person stops; the last final follows within END_GRACE_S. purpose="dictation"
asks for SMART mode (fillers removed, light cleanup); purpose="call" is verbatim. Nothing here stores anything.

File: transcribe_file() sends the whole recording to the batch model with speaker diarization and word
timestamps, and groups the words into [{speaker, text, start, end}] segments.

GEMINI_API_KEY never leaves the server. Gemini quirks, found by scripts/smoke-gemini-live.py and probing:
the live model only accepts api_version v1alpha; the file model needs v1beta and a "models/" id. A Live
session lasts at most 10 minutes.
"""

from __future__ import annotations

import asyncio
import base64
import json
import logging
import os

from fastapi import WebSocket, WebSocketDisconnect

from service import config  # noqa: F401  (loads .env)

log = logging.getLogger("service.transcribe")

LIVE_MODEL = os.getenv("GEMINI_TRANSCRIBE_LIVE_MODEL", "gemini-3.5-transcribe-live")
FILE_MODEL = os.getenv("GEMINI_TRANSCRIBE_MODEL", "gemini-3.5-transcribe")
# After the browser's "end", wait this long for the last final before closing
END_GRACE_S = float(os.getenv("TRANSCRIBE_END_GRACE_S", "8"))
PURPOSES = ("call", "dictation")


def has_key() -> bool:
    return bool(os.getenv("GEMINI_API_KEY"))


def _client(api_version: str):
    from google import genai
    return genai.Client(api_key=os.environ["GEMINI_API_KEY"], http_options={"api_version": api_version})


def live_connect(purpose: str):
    """An async context manager yielding a Gemini Live session. Tests replace this."""
    from google.genai import types
    mode = types.AudioTranscriptionConfigMode.SMART if purpose == "dictation" else None
    cfg = types.LiveConnectConfig(input_audio_transcription=types.AudioTranscriptionConfig(mode=mode))
    return _client("v1alpha").aio.live.connect(model=LIVE_MODEL, config=cfg)


async def relay(ws: WebSocket, purpose: str) -> None:
    """Browser <-> Gemini Live, two loops: audio up, transcript down."""
    from google.genai import types
    await ws.accept()
    refusal = (f"purpose must be one of {PURPOSES}" if purpose not in PURPOSES
               else None if has_key() else "GEMINI_API_KEY not set on the server")
    if refusal:
        await ws.send_json({"type": "error", "detail": refusal})
        await ws.close()
        return
    ended = asyncio.Event()
    last_interim = {"text": ""}

    async def upstream(session):
        while True:
            msg = await ws.receive()
            if msg["type"] == "websocket.disconnect":
                raise WebSocketDisconnect(msg.get("code", 1000))
            if msg.get("bytes"):
                await session.send_realtime_input(audio=types.Blob(data=msg["bytes"], mime_type="audio/pcm;rate=16000"))
            elif msg.get("text") and json.loads(msg["text"]).get("type") == "end":
                await session.send_realtime_input(audio_stream_end=True)
                ended.set()
                return

    async def downstream(session):
        while True:   # receive() stops at each turn_complete; a long call has many turns
            async for msg in session.receive():
                sc = msg.server_content
                if not sc:
                    continue
                interim = sc.interim_input_transcription
                if interim and interim.text and interim.text != last_interim["text"]:
                    last_interim["text"] = interim.text
                    await ws.send_json({"type": "interim", "text": interim.text})
                if sc.input_transcription and sc.input_transcription.text:
                    last_interim["text"] = ""
                    await ws.send_json({"type": "final", "text": sc.input_transcription.text})
                if ended.is_set() and (sc.turn_complete or sc.generation_complete):
                    return

    try:
        async with live_connect(purpose) as session:
            up, down = asyncio.create_task(upstream(session)), asyncio.create_task(downstream(session))
            done, _ = await asyncio.wait({up, down}, return_when=asyncio.FIRST_COMPLETED)
            if up in done and not up.exception() and not down.done():
                await asyncio.wait({down}, timeout=END_GRACE_S)
            for t in (up, down):
                if not t.done():
                    t.cancel()
            await asyncio.gather(up, down, return_exceptions=True)
            errors = [t.exception() for t in (up, down) if not t.cancelled() and t.exception()]
        if any(isinstance(e, WebSocketDisconnect) for e in errors):
            return
        if last_interim["text"]:   # the model never finalized the last words: promote them
            await ws.send_json({"type": "final", "text": last_interim["text"]})
        if errors:
            raise errors[0]
    except WebSocketDisconnect:
        return
    except Exception as e:   # Gemini refused or dropped: tell the browser, don't hang
        log.warning("live transcription failed: %s", e)
        try:
            await ws.send_json({"type": "error", "detail": f"live transcription failed: {type(e).__name__}: {e}"[:300]})
        except Exception:
            return
    try:
        await ws.close()
    except Exception:
        pass


def _seconds(offset: str | None) -> float | None:
    return round(float(offset.rstrip("s")), 2) if offset else None


def group_words(words: list[dict]) -> list[dict]:
    """[{speaker, text, start_offset, end_offset}] word annotations -> one segment per speaker turn."""
    segments: list[dict] = []
    for w in words:
        speaker = w.get("speaker") or "spk:0"
        if segments and segments[-1]["speaker"] == speaker:
            seg = segments[-1]
            seg["text"] += " " + w["text"]
            seg["end"] = _seconds(w.get("end_offset")) or seg["end"]
        else:
            segments.append({"speaker": speaker, "text": w["text"],
                             "start": _seconds(w.get("start_offset")), "end": _seconds(w.get("end_offset"))})
    return segments


def name_speakers(segments: list[dict], staff_name: str | None, contact_name: str | None) -> list[dict]:
    """Label speakers by first appearance: the first voice is the staff member (they place the call), the
    second the contact, any others "Speaker N". A guess the save modal lets the person correct."""
    order: list[str] = []
    for s in segments:
        if s["speaker"] not in order:
            order.append(s["speaker"])
    names = {spk: ([staff_name, contact_name][i] if i < 2 else None) or f"Speaker {i + 1}"
             for i, spk in enumerate(order)}
    return [{**s, "speaker": names[s["speaker"]]} for s in segments]


def transcribe_file(audio: bytes, mime_type: str) -> list[dict]:
    """The whole recording -> [{speaker, text, start, end}] with raw labels (spk:0, spk:1, ...)."""
    model = FILE_MODEL if FILE_MODEL.startswith("models/") else f"models/{FILE_MODEL}"
    result = _client("v1beta").interactions.create(
        model=model,
        input=[{"type": "audio", "data": base64.b64encode(audio).decode(), "mime_type": mime_type}],
        generation_config={"transcription_config": {"mode": {
            "type": "verbatim", "diarization_mode": "speaker", "timestamp_granularities": ["word"]}}})
    words = []
    for step in result.steps or []:
        for part in getattr(step, "content", None) or []:
            for a in getattr(part, "annotations", None) or []:
                if getattr(a, "type", None) == "word_info" and a.text:
                    words.append({"speaker": a.speaker, "text": a.text,
                                  "start_offset": a.start_offset, "end_offset": a.end_offset})
    if not words and result.output_text:
        return [{"speaker": "spk:0", "text": result.output_text.strip(), "start": None, "end": None}]
    return group_words(words)
