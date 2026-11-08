"""Public mode (docs/public-tunnel.md): off = no public origin; on = origin allowed, rate limited, sends simulated."""
import pytest
from fastapi.testclient import TestClient

from service import outbound, public_mode, sms
from service.main import app

VERCEL = "https://devday-donor-desk.vercel.app"


@pytest.fixture(autouse=True)
def restore_public_mode():
    public_mode.set_enabled(False, [VERCEL])
    yield
    public_mode.set_enabled(False)


@pytest.fixture
def client(db_file):
    return TestClient(app)


def preflight(c, path="/chat"):
    return c.options(path, headers={"Origin": VERCEL, "Access-Control-Request-Method": "POST"})


def test_off_rejects_the_vercel_origin(client):
    assert "access-control-allow-origin" not in client.get("/people", headers={"Origin": VERCEL}).headers
    assert preflight(client).status_code == 400
    assert public_mode.group_of("/chat") == "chat" and client.get("/public-mode").json() == {"enabled": False}


def test_on_accepts_the_vercel_origin_on_people_and_chat(client):
    public_mode.set_enabled(True)
    r = client.get("/people", headers={"Origin": VERCEL})
    assert r.status_code == 200 and r.headers["access-control-allow-origin"] == VERCEL
    assert preflight(client).status_code == 200
    chat = client.post("/chat", json={"message": "hi"}, headers={"Origin": VERCEL})
    assert chat.status_code != 429 and chat.headers["access-control-allow-origin"] == VERCEL
    assert client.get("/public-mode").json() == {"enabled": True}


def test_on_still_rejects_an_unlisted_origin(client):
    public_mode.set_enabled(True)
    assert "access-control-allow-origin" not in client.get("/people", headers={"Origin": "https://evil.example"}).headers


def test_ws_origin_check_follows_the_switch():
    from service.routes_voice import origin_allowed
    assert not origin_allowed(VERCEL)
    public_mode.set_enabled(True)
    assert origin_allowed(VERCEL) and not origin_allowed("https://evil.example")
    public_mode.set_enabled(False)
    assert not origin_allowed(VERCEL)


def test_21st_chat_request_in_a_minute_is_429(client):
    public_mode.set_enabled(True)
    codes = [client.post("/chat", json={"message": "hi"}, headers={"Origin": VERCEL}).status_code for _ in range(21)]
    assert 429 not in codes[:20] and codes[20] == 429
    r = client.post("/chat", json={"message": "hi"}, headers={"Origin": VERCEL})
    assert r.status_code == 429 and "retry-after" in r.headers and r.headers["access-control-allow-origin"] == VERCEL
    assert client.get("/people").status_code == 200          # other routes are not limited


def test_rate_limit_is_per_client_ip(client):
    public_mode.set_enabled(True)
    for _ in range(20):
        client.post("/ask", json={"question": "x"}, headers={"CF-Connecting-IP": "1.1.1.1"})
    assert client.post("/ask", json={"question": "x"}, headers={"CF-Connecting-IP": "1.1.1.1"}).status_code == 429
    assert client.post("/ask", json={"question": "x"}, headers={"CF-Connecting-IP": "2.2.2.2"}).status_code != 429


def test_rate_limit_off_when_public_mode_off(client):
    codes = {client.post("/chat", json={"message": "hi"}).status_code for _ in range(25)}
    assert 429 not in codes


def test_window_expires():
    assert public_mode.over_limit("9.9.9.9", "chat", now=0.0) is None
    for i in range(19):
        public_mode.over_limit("9.9.9.9", "chat", now=1.0)
    assert public_mode.over_limit("9.9.9.9", "chat", now=2.0) is not None
    assert public_mode.over_limit("9.9.9.9", "chat", now=61.5) is None


def test_fourth_live_socket_is_refused(client):
    public_mode.set_enabled(True)
    public_mode._live_sockets = public_mode.MAX_LIVE_SOCKETS
    with pytest.raises(Exception):
        with client.websocket_connect("/transcribe/live", headers={"Origin": VERCEL}):
            pass


def test_sends_stay_simulated_in_public_mode(monkeypatch):
    monkeypatch.setenv("EMAIL_SEND", "on")
    monkeypatch.setenv("GMAIL_TOKEN_PATH", "/nonexistent")
    monkeypatch.setenv("SMS_PROVIDER", "twilio")
    monkeypatch.setenv("TWILIO_ACCOUNT_SID", "x")
    monkeypatch.setenv("TWILIO_AUTH_TOKEN", "x")
    monkeypatch.setenv("TWILIO_PHONE_NUMBER", "+15555550100")
    public_mode.set_enabled(True)

    def boom(*a, **k):
        raise AssertionError("a real send was attempted")
    monkeypatch.setattr(outbound.httpx, "post", boom)
    monkeypatch.setattr(sms.httpx, "post", boom)
    e = outbound.send_email("a@b.co", "s", "b")
    t = sms.send_sms("+15555550101", "b")
    assert e["simulated"] and e["provider"] == "dryrun"
    assert t["simulated"] and t["provider"] == "dryrun"
