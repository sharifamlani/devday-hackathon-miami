"""Voice routes (plan §21.5): live transcription and the recorded-file pass. main.py mounts this router.

    WS   /transcribe/live?purpose=call|dictation   binary PCM16 frames, then {"type":"end"}
                                                   -> {"type":"interim"|"final","text"} / {"type":"error","detail"}
    POST /transcribe/file                          multipart: audio, first_speaker? (you|them), you_name?, them_name?
                                                   -> {"segments": [{speaker: you|them, name, text, at}]}

Nothing here writes. Call notes persist through routes_calls.py (POST /calls), which takes these segments
as its transcript lines unchanged.
"""

from __future__ import annotations

import logging
from typing import Literal

from fastapi import APIRouter, File, Form, HTTPException, UploadFile, WebSocket

from service import transcribe

log = logging.getLogger("service.routes_voice")
router = APIRouter(tags=["voice"])

MAX_AUDIO_BYTES = 20 * 1024 * 1024   # inline audio limit for one request; ~20 min of opus


@router.websocket("/transcribe/live")
async def transcribe_live(ws: WebSocket, purpose: str = "call") -> None:
    await transcribe.relay(ws, purpose)


@router.post("/transcribe/file")
def transcribe_file(audio: UploadFile = File(...), first_speaker: Literal["you", "them"] = Form("you"),
                    you_name: str | None = Form(None), them_name: str | None = Form(None)) -> dict:
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
    return {"segments": transcribe.to_transcript_lines(segments, first_speaker, you_name, them_name)}
