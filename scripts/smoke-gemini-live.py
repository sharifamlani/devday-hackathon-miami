"""Smoke 3 (plan §21.9): prove GEMINI_API_KEY reaches the live transcription model.

Streams a 16 kHz mono 16-bit WAV to the Gemini Live API in ~100 ms frames at real-time pace, the way
the browser will, and prints every interim and final transcript event with its time since the first frame.

Run from the repo root:
    .venv/Scripts/python.exe scripts/smoke-gemini-live.py <clip.wav> [expected words ...]
    e.g. scripts/smoke-gemini-live.py solo.wav beach cleanup Miami

PASS when at least one final event arrives and every expected word appears in the final text.
Exits non-zero on any failure. Never prints the key.
"""
import asyncio
import os
import sys
import time
import wave
from pathlib import Path

from dotenv import load_dotenv
from google import genai
from google.genai import types

load_dotenv(Path(__file__).resolve().parents[1] / ".env")

MODEL = os.getenv("GEMINI_TRANSCRIBE_LIVE_MODEL", "gemini-3.5-transcribe-live")
FRAME_MS = 100
API_VERSION = os.getenv("GEMINI_LIVE_API_VERSION", "v1alpha")


def read_pcm(path: str) -> bytes:
    with wave.open(path) as w:
        if (w.getframerate(), w.getnchannels(), w.getsampwidth()) != (16000, 1, 2):
            sys.exit(f"FAIL  {path} must be 16 kHz mono 16-bit, got "
                     f"{w.getframerate()} Hz, {w.getnchannels()} ch, {8 * w.getsampwidth()} bit")
        return w.readframes(w.getnframes())


async def main(path: str, expected: list[str]) -> int:
    if not os.getenv("GEMINI_API_KEY"):
        print("FAIL  GEMINI_API_KEY not set")
        return 1
    pcm = read_pcm(path)
    step = 16000 * 2 * FRAME_MS // 1000
    client = genai.Client(api_key=os.environ["GEMINI_API_KEY"], http_options={"api_version": API_VERSION})
    config = types.LiveConnectConfig(input_audio_transcription=types.AudioTranscriptionConfig())
    finals, first_interim = [], None
    t0 = time.monotonic()
    async with client.aio.live.connect(model=MODEL, config=config) as session:
        print(f"PASS  connected to {MODEL}")

        async def send():
            for i in range(0, len(pcm), step):
                await session.send_realtime_input(audio=types.Blob(data=pcm[i:i + step], mime_type="audio/pcm;rate=16000"))
                await asyncio.sleep(FRAME_MS / 1000)
            await session.send_realtime_input(audio_stream_end=True)

        sender = asyncio.create_task(send())
        try:
            async with asyncio.timeout(len(pcm) / 32000 + 20):
                async for msg in session.receive():
                    sc = msg.server_content
                    if not sc:
                        continue
                    at = time.monotonic() - t0
                    if sc.interim_input_transcription and sc.interim_input_transcription.text:
                        first_interim = first_interim or at
                        print(f"  {at:5.1f}s interim  {sc.interim_input_transcription.text!r}")
                    if sc.input_transcription and sc.input_transcription.text:
                        finals.append(sc.input_transcription.text)
                        print(f"  {at:5.1f}s final    {sc.input_transcription.text!r}")
                    if sender.done() and finals and (sc.turn_complete or sc.generation_complete):
                        break
        except TimeoutError:
            pass
        sender.cancel()

    text = " ".join(finals).lower()
    missing = [w for w in expected if w.lower() not in text]
    print(f"first interim at {first_interim:.1f}s" if first_interim else "no interim events")
    print(f"final text: {' '.join(finals)!r}")
    ok = bool(finals) and not missing
    print(f"{'PASS' if ok else 'FAIL'}  {len(finals)} final event(s)" + (f", missing {missing}" if missing else ""))
    return 0 if ok else 1


if __name__ == "__main__":
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    sys.exit(asyncio.run(main(sys.argv[1], sys.argv[2:])))
