"""Public mode: the Vercel app talks to this laptop through a tunnel (docs/public-tunnel.md).

Off unless PUBLIC_MODE=1. When on:
- config.py has already added PUBLIC_ORIGINS to CORS_ORIGINS (the WS Origin check reads the same list);
- a per-IP rate limit guards the model-backed routes (chat, ask, transcribe) so strangers cannot burn the key;
- at most MAX_LIVE_SOCKETS live transcription sockets run at once;
- DENY BY DEFAULT: only the (method, path) pairs in ALLOW are served, and only to a request carrying a
  PUBLIC_ORIGINS Origin (GET /health and /public-mode excepted). Origin is not authentication (any script can send it), so the
  allow-list, the contact masking below and the rate limit are the whole defence;
- call transcripts and staff free-text fields are blanked, and email and phone values are masked, in JSON responses (same format as routes_campaigns.mask_address);
- the chat agent runs read-only (chat_agent.tools_for_mode);
- every send stays simulated, whatever EMAIL_SEND / SMS_PROVIDER say (outbound.py and sms.py ask forced_simulated()).
"""
import json
import re
import time
from collections import defaultdict, deque

from service import config

RATE_LIMIT = 20          # requests per window, per client IP, per route group
RATE_WINDOW_S = 60.0
MAX_LIVE_SOCKETS = 3     # concurrent WS /transcribe/live, all clients together

NOT_AVAILABLE = "not available in the public preview"

# (method, path regex). Everything else, including every PATCH/PUT/DELETE, /phone/*, /ingest, /send*, /calls*,
# /crm/*, /merges*, /enrich*, /context/run|refresh, /events/refresh, /chat/stream, is refused.
ALLOW: list[tuple[str, re.Pattern]] = [(m, re.compile(rf"^{p}$")) for m, p in [
    ("GET", r"/health"), ("GET", r"/public-mode"), ("GET", r"/home/summary"),
    ("GET", r"/people(/.*)?"), ("GET", r"/donors(/\d+)?"), ("GET", r"/duplicates"),
    ("GET", r"/targets(/.*)?"), ("GET", r"/calendar"), ("GET", r"/tasks"), ("GET", r"/artifacts"),
    ("GET", r"/events(/\d+(/drafts)?)?"), ("GET", r"/context"), ("GET", r"/context/(search|status)"),
    ("GET", r"/community/stats"), ("GET", r"/alerts"), ("GET", r"/icp"), ("GET", r"/prospects(/\d+)?"),
    ("GET", r"/org-profile"), ("GET", r"/interest-tags"), ("GET", r"/campaigns(/\d+)?"), ("GET", r"/outbox"),
    ("POST", r"/chat"), ("POST", r"/chat/approve"), ("POST", r"/ask"),
]]
ALLOW_ANY_ORIGIN = {("GET", "/health"), ("GET", "/public-mode")}   # no data in either

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


def allowed(method: str, path: str) -> bool:
    return any(m == method and rx.match(path) for m, rx in ALLOW)


EMAIL_RE = re.compile(r"[\w.+-]+@[\w-]+(?:\.[\w-]+)+")


PHONE_RE = re.compile(r"(?<![\d.])(?:\+\d{10,15}|\d{10,11}|\(?\d{3}\)?[ .-]\d{3}[ .-]\d{4})(?!\d)")


def mask_address(address: str, channel: str) -> str:
    """Same format as routes_campaigns.mask_address: r***@example.com, ***-***-0177."""
    if channel == "email" or "@" in address:
        local, _, domain = address.partition("@")
        return f"{local[:1]}***@{domain}" if domain else "***"
    digits = re.sub(r"\D", "", address)
    return f"***-***-{digits[-4:]}" if len(digits) >= 4 else "***"


# Free-text staff and call fields: what was said on a call and private staff notes never go public
# (the public snapshot drops the same things). Blanked in every JSON response, whatever route served it.
BLANK_KEYS = {"call_notes", "transcript", "notes", "private_notes", "background", "next_steps"}


def mask_json(value, key: str = ""):
    """Blank staff free-text fields; mask email/phone values (by key name) and any email address in a string."""
    k = key.lower()
    if k in BLANK_KEYS:
        return [] if isinstance(value, list) else ("" if isinstance(value, str) else None)
    if isinstance(value, dict):
        return {kk: mask_json(v, kk) for kk, v in value.items()}
    if isinstance(value, list):
        return [mask_json(v, key) for v in value]
    if isinstance(value, str) and value:
        if "phone" in k and "@" not in value:
            return mask_address(value, "phone")
        value = EMAIL_RE.sub(lambda m: mask_address(m.group(0), "email"), value)
        return PHONE_RE.sub(lambda m: mask_address(m.group(0), "phone"), value)
    return value


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
        method = scope["method"]
        if method != "OPTIONS":                      # preflights are answered by the CORS middleware outside this one
            origin = ""
            for key, value in scope.get("headers", []):
                if key == b"origin":
                    origin = value.decode("latin-1").rstrip("/")
            if (method, path) not in ALLOW_ANY_ORIGIN and (origin not in config.PUBLIC_ORIGINS
                                                           or not allowed(method, path)):
                return await respond_json(send, 403, {"detail": NOT_AVAILABLE})
        group = group_of(path)
        if group and method != "OPTIONS":
            wait = over_limit(client_ip(scope), group)
            if wait is not None:
                return await respond_json(send, 429, {"detail": "Too many requests. Try again shortly."},
                                          [(b"retry-after", str(int(wait) + 1).encode())])
        return await self.app(scope, receive, mask_sender(send))


async def respond_json(send, status: int, payload: dict, extra: list | None = None) -> None:
    body = json.dumps(payload).encode()
    await send({"type": "http.response.start", "status": status, "headers": [
        (b"content-type", b"application/json"), (b"content-length", str(len(body)).encode()), *(extra or [])]})
    await send({"type": "http.response.body", "body": body})


def mask_sender(send):
    """Wrap send: buffer each JSON response and mask its contact fields; other content passes through."""
    state: dict = {"start": None, "chunks": []}

    async def wrapped(message):
        if message["type"] == "http.response.start":
            ctype = dict(message.get("headers", [])).get(b"content-type", b"")
            if b"json" not in ctype:
                state["start"] = False
                return await send(message)
            state["start"] = message
            return
        if state["start"] in (None, False) or message["type"] != "http.response.body":
            return await send(message)
        state["chunks"].append(message.get("body", b""))
        if message.get("more_body"):
            return
        raw = b"".join(state["chunks"])
        try:
            raw = json.dumps(mask_json(json.loads(raw))).encode()
        except ValueError:
            pass
        start = state["start"]
        headers = [(k, v) for k, v in start["headers"] if k.lower() != b"content-length"]
        await send({**start, "headers": [*headers, (b"content-length", str(len(raw)).encode())]})
        await send({"type": "http.response.body", "body": raw})
    return wrapped
