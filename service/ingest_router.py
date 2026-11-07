"""POST /ingest: multipart files + target -> people and gifts in donors.db.

The service agent mounts this: `app.include_router(ingest_router.router)`.
"""

from __future__ import annotations

import asyncio
from typing import Annotated, Literal

from fastapi import APIRouter, File, Form, HTTPException, UploadFile

from service import config
from service.ingest_adapter import ingest_files

router = APIRouter()
MAX_FILE_BYTES = 10_000_000


@router.post("/ingest")
async def ingest(files: Annotated[list[UploadFile], File()],
                 target: Annotated[Literal["giver", "neighbor", "community", "auto"], Form()] = "auto") -> dict:
    if not files:
        raise HTTPException(400, "no files uploaded")
    payload: list[tuple[str, bytes]] = []
    for f in files:
        data = await f.read()
        if len(data) > MAX_FILE_BYTES:
            raise HTTPException(413, f"{f.filename} is over 10 MB")
        payload.append((f.filename or "upload", data))
    try:
        return await asyncio.wait_for(asyncio.to_thread(ingest_files, payload, target), timeout=config.AGENT_DEADLINE_S)
    except asyncio.TimeoutError:
        raise HTTPException(504, f"ingest took longer than {config.AGENT_DEADLINE_S:.0f} s; try fewer files")
