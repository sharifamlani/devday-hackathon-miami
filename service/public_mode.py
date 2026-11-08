"""Public mode: the Vercel app talks to this laptop through a tunnel (docs/public-tunnel.md).

Off unless PUBLIC_MODE=1. When on:
- config.py has already added PUBLIC_ORIGINS to CORS_ORIGINS (the WS Origin check reads the same list);
- a per-IP rate limit guards the model-backed routes (chat, ask, transcribe) so strangers cannot burn the key;
- at most MAX_LIVE_SOCKETS live transcription sockets run at once;
- every send stays simulated, whatever EMAIL_SEND / SMS_PROVIDER say (outbound.py and sms.py ask forced_simulated()).
"""
import json
import time
from collections import defaultdict, deque

from service import config

RATE_LIMIT = 20          # requests per window, per client IP, per route group
RATE_WINDOW_S = 60.0
MAX_LIVE_SOCKETS = 3     # concurrent WS /transcribe/live, all clients together

_hits: dict[tuple[str, str], deque] = defaultdict(deque)
_live_sockets = 0


def enabled() -> bool:
    return config.PUBLIC_MODE


def forced_simulated() -> bool:
    """True when no email or text may leave the laptop."""
    return config.PUBLIC_MODE


def set_enabled(on: bool, origins: list[str] | None = None) -> None:
    """Flip public mode in-process (tests; the service itself reads the env once at start-up).

    CORS_ORIGINS is edited in place: the CORS middleware holds a reference to that list."""
    config.PUBLIC_MODE = on
    if origins is not None:
        config.PUBLIC_ORIGINS[:] = [o.rstrip("/") for o in origins]
    for origin in config.PUBLIC_ORIGINS:
        present = origin in config.CORS_ORIGINS
        if on and not present:
            config.CORS_ORIGINS.append(origin)
        elif not on and present:
            config.CORS_ORIGINS.remove(origin)
    reset()


def reset() -> None:
    global _live_sockets
    _hits.clear()
    _live_sockets = 0


def group_of(path: str) -> str | None:
    if path == "/chat" or path.startswith("/chat/"):
        return "chat"
    if path == "/ask" or path.startswith("/ask/"):
        return "ask"
    if path.startswith("/transcribe"):
        return "transcribe"
    return None


def client_ip(scope) -> str:
    for key, value in scope.get("headers", []):
        if key == b"cf-connecting-ip":     # set by Cloudflare; trusted only because the tunnel is the way in
            return value.decode("latin-1").strip()
    client = scope.get("client")
    return client[0] if client else "unknown"


def over_limit(ip: str, group: str, now: float | None = None) -> float | None:
    """Record a hit; return seconds to wait if this one is over the limit, else None."""
    now = time.monotonic() if now is None else now
    q = _hits[(ip, group)]
    while q and now - q[0] >= RATE_WINDOW_S:
        q.popleft()
    if len(q) >= RATE_LIMIT:
        return max(1.0, RATE_WINDOW_S - (now - q[0]))
    q.append(now)
    return None


class PublicModeMiddleware:
    """Pure ASGI, so it covers HTTP and WebSocket scopes. A no-op while public mode is off."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        global _live_sockets
        if scope["type"] not in ("http", "websocket") or not config.PUBLIC_MODE:
            return await self.app(scope, receive, send)
        path = scope["path"]
        if scope["type"] == "websocket":
            if path != "/transcribe/live":
                return await self.app(scope, receive, send)
            if _live_sockets >= MAX_LIVE_SOCKETS:
                await receive()                      # the connect event
                return await send({"type": "websocket.close", "code": 1013})
            _live_sockets += 1
            try:
                return await self.app(scope, receive, send)
            finally:
                _live_sockets -= 1
        group = group_of(path)
        if group and scope["method"] != "OPTIONS":
            wait = over_limit(client_ip(scope), group)
            if wait is not None:
                body = json.dumps({"detail": "Too many requests. Try again shortly."}).encode()
                await send({"type": "http.response.start", "status": 429, "headers": [
                    (b"content-type", b"application/json"), (b"content-length", str(len(body)).encode()),
                    (b"retry-after", str(int(wait) + 1).encode())]})
                return await send({"type": "http.response.body", "body": body})
        return await self.app(scope, receive, send)
