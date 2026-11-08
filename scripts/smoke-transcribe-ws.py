"""Smoke 10 (plan §21.9): voice through our own service, the way the browser uses it.

Needs the service running (uvicorn service.main:app) and two 16 kHz mono 16-bit WAVs: one voice, and a
two-voice call. Checks, in order:
  1. WS /transcribe/live?purpose=call   interim events, then a final with the expected words
  2. WS /transcribe/live?purpose=dictation   a final arrives; saved call count unchanged
  3. POST /transcribe/file (two-voice clip)   >= 2 distinct speakers, as you/them transcript lines
  4. POST /calls (routes_calls.py) with those lines   saved with an id
Then restart the service and run with --check <note_id> to prove the note survived.

Run from the repo root:
    .venv/Scripts/python.exe scripts/smoke-transcribe-ws.py http://127.0.0.1:8000 solo.wav dialog.wav --donor 1 --expect beach Miami
    .venv/Scripts/python.exe scripts/smoke-transcribe-ws.py http://127.0.0.1:8000 --check <note_id>

Exits non-zero on any failure.
"""
import argparse
import asyncio
import json
import sys
import time
import wave

import httpx
import websockets

FRAME_MS = 100
failures = []


def check(name, ok, detail=""):
    print(f"{'PASS' if ok else 'FAIL'}  {name}  {detail}")
    if not ok:
        failures.append(name)


def read_pcm(path: str) -> bytes:
    with wave.open(path) as w:
        if (w.getframerate(), w.getnchannels(), w.getsampwidth()) != (16000, 1, 2):
            sys.exit(f"FAIL  {path} must be 16 kHz mono 16-bit")
        return w.readframes(w.getnframes())


async def stream(base: str, purpose: str, pcm: bytes) -> tuple[list[dict], float | None]:
    """Send the clip at real-time pace; return every event and the first interim's delay."""
    url = base.replace("http", "ws", 1) + f"/transcribe/live?purpose={purpose}"
    step = 16000 * 2 * FRAME_MS // 1000
    events, first = [], None
    async with websockets.connect(url) as ws:
        t0 = time.monotonic()

        async def send():
            for i in range(0, len(pcm), step):
                await ws.send(pcm[i:i + step])
                await asyncio.sleep(FRAME_MS / 1000)
            await ws.send(json.dumps({"type": "end"}))

        sender = asyncio.create_task(send())
        try:
            async for raw in ws:
                e = json.loads(raw)
                e["at"] = round(time.monotonic() - t0, 2)
                events.append(e)
                if e["type"] == "interim" and first is None:
                    first = e["at"]
        except websockets.ConnectionClosed:
            pass
        sender.cancel()
    return events, first


def saved_call_ids(http: httpx.Client) -> list[str]:
    r = http.get("/calls", params={"limit": 200})   # routes_calls caps limit at 200
    r.raise_for_status()
    return [n["id"] for n in r.json()]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("base")
    ap.add_argument("solo", nargs="?")
    ap.add_argument("dialog", nargs="?")
    ap.add_argument("--donor", type=int, default=1)
    ap.add_argument("--expect", nargs="*", default=[])
    ap.add_argument("--check", help="a call note id saved by an earlier run (after a restart)")
    a = ap.parse_args()
    http = httpx.Client(base_url=a.base, timeout=120)

    if a.check:
        ids = saved_call_ids(http)
        check("note survives a restart", a.check in ids, f"{len(ids)} saved call(s)")
        return 1 if failures else 0
    if not (a.solo and a.dialog):
        sys.exit(__doc__)

    solo = read_pcm(a.solo)
    events, first = asyncio.run(stream(a.base, "call", solo))
    finals = " ".join(e["text"] for e in events if e["type"] == "final")
    errors = [e for e in events if e["type"] == "error"]
    interims = sum(e["type"] == "interim" for e in events)
    missing = [w for w in a.expect if w.lower() not in finals.lower()]
    check("live call: interim events", interims > 0, f"{interims} interim, first at {first}s")
    check("live call: final text", bool(finals) and not missing and not errors,
          f"{finals!r}" + (f" missing {missing}" if missing else "") + (f" errors {errors}" if errors else ""))

    before = saved_call_ids(http)
    events, _ = asyncio.run(stream(a.base, "dictation", solo))
    dictated = " ".join(e["text"] for e in events if e["type"] == "final")
    check("dictation: final text (SMART)", bool(dictated), repr(dictated))
    after = saved_call_ids(http)
    check("dictation: adds 0 call notes", after == before, f"{len(before)} saved call(s) before and {len(after)} after")

    t = time.monotonic()
    with open(a.dialog, "rb") as f:
        r = http.post("/transcribe/file", files={"audio": ("call.wav", f, "audio/wav")},
                      data={"you_name": "Denise", "them_name": "Rosa"})
    segs = r.json().get("segments", []) if r.status_code == 200 else []
    speakers = sorted({s["speaker"] for s in segs})
    check("file pass: >= 2 speakers", speakers == ["them", "you"],
          f"HTTP {r.status_code} in {time.monotonic() - t:.1f}s, {len(segs)} segments, speakers {speakers}")
    for s in segs:
        print(f"    {s['at']:5.1f}s {s['speaker']:>4} {s['name']:>6}: {s['text']}")

    r = http.post("/calls", json={"title": "Smoke 10 call", "transcript": segs,
                                  "duration_sec": int(segs[-1]["at"]) + 1 if segs else 0,
                                  "destinations": [{"kind": "donor", "id": str(a.donor)}]})
    body = r.json() if r.status_code == 200 else {}
    check("call note saved via POST /calls", bool(body.get("id")) and len(body.get("transcript", [])) == len(segs),
          f"HTTP {r.status_code} id={body.get('id')} lines={len(body.get('transcript', []))}")
    if body.get("id"):
        print(f"restart the service, then: --check {body['id']}")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
