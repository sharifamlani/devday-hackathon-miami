"""Voice routes (plan §21.5): live transcription, the recorded-file pass, call notes. main.py mounts this router.

    WS   /transcribe/live?purpose=call|dictation   binary PCM16 frames, then {"type":"end"}
                                                   -> {"type":"interim"|"final","text"} / {"type":"error","detail"}
    POST /transcribe/file                          multipart: audio, staff_name?, contact_name?
                                                   -> {"segments": [{speaker, text, start, end}]}
    POST /people/{id}/call-notes                   {title, folder?, transcript?, segments?, staff_name?,
                                                    contact_name?, duration_s?} -> {id, summary, created_at, undo_token}
    GET  /people/{id}/call-notes                   -> [call note rows, newest first]

Dictation never touches the database; only POST /people/{id}/call-notes writes.
"""

from __future__ import annotations

import logging
import sqlite3

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, WebSocket
from pydantic import BaseModel, Field

from service import call_notes, transcribe
from service.routes_data import get_conn

log = logging.getLogger("service.routes_voice")
router = APIRouter(tags=["voice"])

MAX_AUDIO_BYTES = 20 * 1024 * 1024   # inline audio limit for one request; ~20 min of opus


@router.websocket("/transcribe/live")
async def transcribe_live(ws: WebSocket, purpose: str = "call") -> None:
    await transcribe.relay(ws, purpose)


@router.post("/transcribe/file")
def transcribe_file(audio: UploadFile = File(...), staff_name: str | None = Form(None),
                    contact_name: str | None = Form(None)) -> dict:
    if not transcribe.has_key():
        raise HTTPException(503, "GEMINI_API_KEY not set on the server")
    data = audio.file.read()
    if not data:
        raise HTTPException(400, "empty audio")
    if len(data) > MAX_AUDIO_BYTES:
        raise HTTPException(413, f"audio over {MAX_AUDIO_BYTES // (1024 * 1024)} MB")
    mime = (audio.content_type or "audio/webm").split(";")[0].strip()
    try:
        segments = transcribe.transcribe_file(data, mime)
    except Exception as e:
        log.warning("file transcription failed: %s", e)
        raise HTTPException(502, f"transcription failed: {type(e).__name__}: {e}"[:300])
    return {"segments": transcribe.name_speakers(segments, staff_name, contact_name)}


class Segment(BaseModel):
    speaker: str | None = None
    text: str = ""
    start: float | None = None
    end: float | None = None


class CallNoteIn(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    folder: str | None = "Call notes"
    transcript: str | None = None
    segments: list[Segment] = []
    staff_name: str | None = None
    contact_name: str | None = None
    duration_s: float | None = None


@router.post("/people/{person_id}/call-notes")
def save_call_note(person_id: int, body: CallNoteIn, conn: sqlite3.Connection = Depends(get_conn)) -> dict:
    if not call_notes.person_exists(conn, person_id):
        raise HTTPException(404, f"no person {person_id}")
    if not (body.transcript or "").strip() and not body.segments:
        raise HTTPException(400, "transcript or segments required")
    return call_notes.save_call_note(conn, person_id, body.model_dump())


@router.get("/people/{person_id}/call-notes")
def list_call_notes(person_id: int, conn: sqlite3.Connection = Depends(get_conn)) -> list[dict]:
    return call_notes.list_call_notes(conn, person_id)
