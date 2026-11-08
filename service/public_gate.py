"""The public link's on/off switch (docs/public-tunnel.md "Toggle").

A flag file next to the db, so the laptop service (:8001, where Sharif flips it) and the public service (:8401,
PUBLIC_MODE, which obeys it) share it without a restart. Off: the public service answers 503 to everything, the
Vercel app's 2 s /health probe fails and visitors get the snapshot. The tunnel and its URL stay up, so no redeploy.
Missing file = on (the public service only runs because someone started it).
"""
import json
import os
from pathlib import Path

from service import db

_cache: dict = {"key": None, "on": True}


def gate_file() -> Path:
    return Path(db.db_path()).parent / "public_link.json"


def is_on() -> bool:
    """Read on each request; re-parsed only when the file's mtime changes."""
    path = gate_file()
    try:
        key = (str(path), path.stat().st_mtime_ns)
    except OSError:
        return True
    if key != _cache["key"]:
        try:
            _cache["on"] = json.loads(path.read_text(encoding="utf-8")).get("on", True) is not False
        except (OSError, ValueError):
            _cache["on"] = True
        _cache["key"] = key
    return _cache["on"]


def set_on(on: bool) -> dict:
    path = gate_file()
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps({"on": bool(on)}), encoding="utf-8")
    os.replace(tmp, path)
    return {"on": is_on()}
