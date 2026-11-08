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


@pytest.fixture
def instant_agents(monkeypatch):
    """The rate-limit tests measure the limiter, not the model: with a real key, 21 chat calls take ~100 s, the
    first requests leave the 60 s window and the 21st is allowed (and each run spends money). Stub both agents so
    every request answers at once, key or no key."""
    from service import chat_agent, config, routes_ask

    async def no_plan(question, as_of):
        return None, "stub", None, None

    monkeypatch.setattr(config, "HAS_OPENAI_KEY", True)
    monkeypatch.setattr(chat_agent, "run_chat", lambda *a, **k: {"reply": "stub", "steps": [], "approvals": []})
    monkeypatch.setattr(routes_ask, "plan_for", no_plan)


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
    assert chat.status_code not in (403, 429) and chat.headers["access-control-allow-origin"] == VERCEL
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


def test_21st_chat_request_in_a_minute_is_429(client, instant_agents):
    public_mode.set_enabled(True)
    codes = [client.post("/chat", json={"message": "hi"}, headers={"Origin": VERCEL}).status_code for _ in range(21)]
    assert 429 not in codes[:20] and codes[20] == 429
    r = client.post("/chat", json={"message": "hi"}, headers={"Origin": VERCEL})
    assert r.status_code == 429 and "retry-after" in r.headers and r.headers["access-control-allow-origin"] == VERCEL
    assert client.get("/people", headers={"Origin": VERCEL}).status_code == 200   # other routes are not limited


def test_rate_limit_is_per_client_ip(client, instant_agents):
    public_mode.set_enabled(True)
    for _ in range(20):
        client.post("/ask", json={"question": "x"}, headers={"CF-Connecting-IP": "1.1.1.1", "Origin": VERCEL})
    assert client.post("/ask", json={"question": "x"}, headers={"CF-Connecting-IP": "1.1.1.1", "Origin": VERCEL}).status_code == 429
    assert client.post("/ask", json={"question": "x"}, headers={"CF-Connecting-IP": "2.2.2.2", "Origin": VERCEL}).status_code != 429


def test_rate_limit_off_when_public_mode_off(client, instant_agents):
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


# ---- deny by default (CORS is not access control) ----------------------------------------------------------

FOREIGN = "https://evil.example"


def seeded_task(c) -> int:
    return c.post("/tasks", json={"kind": "call", "title": "t"}).json()["id"]


@pytest.mark.parametrize("headers", [{}, {"Origin": FOREIGN}], ids=["no-origin", "foreign-origin"])
def test_no_or_foreign_origin_gets_403_everywhere_but_health(client, headers):
    tid = seeded_task(client)                       # public mode still off here
    public_mode.set_enabled(True)
    for method, path in [("get", "/donors"), ("get", "/calls"), ("get", "/people"), ("post", "/ingest"),
                         ("delete", f"/tasks/{tid}"), ("post", "/tasks"), ("post", "/chat"), ("post", "/ask")]:
        r = getattr(client, method)(path, headers=headers)
        assert r.status_code == 403 and r.json() == {"detail": "not available in the public preview"}, (method, path)
    assert client.get("/health", headers=headers).status_code == 200 and client.get("/public-mode").status_code == 200
    public_mode.set_enabled(False)
    assert any(t["id"] == tid for t in client.get("/tasks").json())      # nothing was deleted


def test_vercel_origin_gets_the_allow_list_and_nothing_else(client):
    tid = seeded_task(client)
    public_mode.set_enabled(True)
    h = {"Origin": VERCEL}
    for path in ["/health", "/public-mode", "/home/summary", "/people", "/people/attention", "/donors", "/donors/1",
                 "/targets", "/calendar", "/tasks", "/events", "/context", "/context/search?q=x", "/artifacts",
                 "/duplicates", "/people/1/merges"]:
        assert client.get(path, headers=h).status_code == 200, path
    denied = [("post", "/ingest"), ("get", "/phone/preview"), ("post", "/phone/calls"), ("post", "/send"),
              ("get", "/calls"), ("post", "/calls"), ("get", "/crm/contacts"), ("post", "/enrich/1"),
              ("post", "/context/run"), ("post", "/context/refresh"), ("post", "/events/refresh"),
              ("post", "/campaigns"), ("post", "/campaigns/1/send"), ("post", "/calls/summarize"),
              ("post", "/duplicates/1/merge"), ("post", "/merges/1/undo"), ("post", "/tasks"),
              ("patch", "/people/1"), ("patch", f"/tasks/{tid}"), ("delete", f"/tasks/{tid}"), ("put", "/people/1")]
    for method, path in denied:
        assert getattr(client, method)(path, headers=h).status_code == 403, (method, path)
    public_mode.set_enabled(False)
    assert any(t["id"] == tid for t in client.get("/tasks").json())


def has_unmasked(value) -> list[str]:
    """Full email addresses (not x***@host) or long phone numbers anywhere in a JSON value."""
    import json
    import re
    text = json.dumps(value)
    return re.findall(r"[\w.+-]{2,}@[\w.-]+", text) + re.findall(public_mode.PHONE_RE.pattern, text)


def test_origin_is_not_authentication_contacts_are_masked(client):
    """A script can send the vercel Origin: the masking still holds on every allowed route that returns people."""
    public_mode.set_enabled(False)
    raw = client.get("/donors/1").json()
    assert raw.get("email") and "***" not in raw["email"]                       # local mode: full contacts
    public_mode.set_enabled(True)
    h = {"Origin": VERCEL}
    d = client.get("/donors/1", headers=h).json()
    assert d["email"].startswith(raw["email"][0] + "***@") and raw["email"] not in str(d)
    if raw.get("phone"):
        assert d["phone"].startswith("***-***-") and raw["phone"] not in str(d)
    for path in ["/people", "/donors", "/people/attention", "/home/summary", "/duplicates", "/targets/donors"]:
        r = client.get(path, headers=h)
        assert r.status_code == 200, path
        assert raw["email"] not in r.text, path
        assert not has_unmasked(r.json()), path


def test_chat_agent_is_read_only_in_public_mode(client, monkeypatch):
    """A stub model asks for add_contact and delete_task; 0 rows change and the reply says read-only preview."""
    import json
    from agents import Runner
    from agents.models.interface import Model, ModelResponse
    from agents.usage import Usage
    from openai.types.responses import ResponseFunctionToolCall, ResponseOutputMessage, ResponseOutputText

    from service import chat_agent, config, db

    tid = seeded_task(client)

    def counts():
        conn = db.connect()
        try:
            return tuple(conn.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0] for t in ("donors", "tasks"))
        finally:
            conn.close()

    class StubModel(Model):
        def __init__(self):
            self.turn = 0

        async def get_response(self, system_instructions, input, model_settings, tools, output_schema, handoffs,
                               tracing, **kw):
            self.turn += 1
            if self.turn == 1:
                out = [ResponseFunctionToolCall(type="function_call", call_id="c1", name="add_contact",
                                                arguments=json.dumps({"full_name": "Zed Intruder"})),
                       ResponseFunctionToolCall(type="function_call", call_id="c2", name="delete_task",
                                                arguments=json.dumps({"task_id": tid}))]
            else:
                out = [ResponseOutputMessage(id="m", type="message", role="assistant", status="completed",
                                             content=[ResponseOutputText(type="output_text", text="Done!", annotations=[])])]
            return ModelResponse(output=out, usage=Usage(), response_id=None)

        def stream_response(self, *a, **k):
            raise NotImplementedError

    stub = StubModel()
    real_build = chat_agent.build_agent
    monkeypatch.setattr(chat_agent, "build_agent", lambda *a, **k: (lambda ag: (setattr(ag, "model", stub), ag)[1])(real_build(*a, **k)))
    monkeypatch.setattr(config, "HAS_OPENAI_KEY", True)
    public_mode.set_enabled(True)
    before = counts()
    r = client.post("/chat", json={"message": "add Zed Intruder and delete my task"}, headers={"Origin": VERCEL})
    assert r.status_code == 200, r.text
    body = r.json()
    assert counts() == before
    assert "read-only preview" in body["reply"] and body["approvals"] == []
    assert [s["tool"] for s in body["steps"]] == ["add_contact", "delete_task"]
    assert all(s["status"] == "error" and "not available in the public preview" in s["summary"] for s in body["steps"])
    public_mode.set_enabled(False)
    assert "add_contact" in {t.name for t in chat_agent.tools_for_mode()}   # local mode keeps every tool
    assert "get_call_notes" in chat_agent.READ_ONLY_TOOLS                  # allowed, but masked: see the next test


def test_agent_reads_are_masked_and_a_refused_read_does_not_block_the_answer(client, monkeypatch):
    """S1 + S-neg (96's probe): "tell me about <donor>" made the agent call get_call_notes, which wasn't a read the
    preview allowed, so the whole reply became the read-only refusal. Now reads answer (masked) and the model's
    own answer comes back. A call note and staff notes seeded with a marker never reach the model or the reply."""
    import json
    from agents.models.interface import Model, ModelResponse
    from agents.usage import Usage
    from openai.types.responses import ResponseFunctionToolCall, ResponseOutputMessage, ResponseOutputText

    from service import chat_agent, config, db

    marker, donor_id = "ZEBRA-TRANSCRIPT-8842", 3
    conn = db.connect()
    try:
        db.create_schema(conn)
        db.save_call_note(conn, {
            "id": "n-agent", "title": f"Call {marker}", "created_at": "2026-11-07T10:00:00", "duration_sec": 60,
            "destinations": [{"kind": "donor", "id": donor_id, "label": "Donor"}],
            "transcript": [{"speaker": "them", "name": "Donor", "text": f"{marker} card ends 4242", "at": 1}],
            "notes": marker, "summary": [marker], "next_steps": [marker]})
        conn.execute("UPDATE donors SET notes = ? WHERE id = ?", (marker, donor_id))
        conn.commit()
    finally:
        conn.close()
    seen = []

    class StubModel(Model):
        def __init__(self):
            self.turn = 0

        async def get_response(self, system_instructions, input, model_settings, tools, output_schema, handoffs,
                               tracing, **kw):
            self.turn += 1
            if self.turn == 1:
                out = [ResponseFunctionToolCall(type="function_call", call_id="r1", name="get_person",
                                                arguments=json.dumps({"person_id": donor_id})),
                       ResponseFunctionToolCall(type="function_call", call_id="r2", name="get_call_notes",
                                                arguments=json.dumps({"person_id": donor_id})),
                       ResponseFunctionToolCall(type="function_call", call_id="r3", name="get_call_list",
                                                arguments=json.dumps({}))]
            else:
                seen.append(json.dumps(input, default=str))              # everything the tools handed the model
                out = [ResponseOutputMessage(id="m", type="message", role="assistant", status="completed",
                                             content=[ResponseOutputText(type="output_text", annotations=[],
                                                                         text="Here is what the records show.")])]
            return ModelResponse(output=out, usage=Usage(), response_id=None)

        def stream_response(self, *a, **k):
            raise NotImplementedError

    stub = StubModel()
    real_build = chat_agent.build_agent
    monkeypatch.setattr(chat_agent, "build_agent", lambda *a, **k: (lambda ag: (setattr(ag, "model", stub), ag)[1])(real_build(*a, **k)))
    monkeypatch.setattr(config, "HAS_OPENAI_KEY", True)
    public_mode.set_enabled(True)
    r = client.post("/chat", json={"message": "Tell me about this donor"}, headers={"Origin": VERCEL})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["reply"] == "Here is what the records show."            # the answer, not READ_ONLY_REPLY
    assert [s["tool"] for s in body["steps"]] == ["get_person", "get_call_notes", "get_call_list"]
    assert all(s["status"] == "done" for s in body["steps"])
    assert seen and marker not in seen[0] and "4242" not in seen[0]      # never reached the model
    assert marker not in r.text and "4242" not in r.text                 # nor the reply
    notes_out = next(i["output"] for i in json.loads(seen[0]) if i.get("call_id") == "r2" and "output" in i)
    assert "call_notes" in notes_out and "[]" in notes_out                 # get_call_notes answered empty


def test_call_notes_and_staff_notes_never_appear_in_any_allowed_get(client):
    """Seed a call note and staff notes with a unique marker; no allowed GET may return it in public mode."""
    import re

    from service import db

    marker = "ZEBRA-TRANSCRIPT-7731"
    conn = db.connect()
    try:
        db.create_schema(conn)
        donor_id = 3
        db.save_call_note(conn, {
            "id": "n-marker", "title": f"Call {marker}", "created_at": "2026-11-07T10:00:00", "duration_sec": 60,
            "destinations": [{"kind": "donor", "id": donor_id, "label": marker}],
            "transcript": [{"speaker": "them", "name": "Donor", "text": f"{marker} card ends 4242", "at": 1}],
            "notes": marker, "summary": [marker], "next_steps": [marker]})
        conn.execute("UPDATE donors SET notes = ? WHERE id = ?", (marker, donor_id))
        conn.commit()
    finally:
        conn.close()
    from service import score
    private = "PRIVATE-TASK-9931"                                      # a Donors-tab task (tasks.crm): private staff text
    due = score.default_as_of().isoformat()
    public_mode.set_enabled(False)
    made = client.post("/crm/tasks", json={"contact_id": donor_id, "type": "call", "text": f"{private} call back",
                                           "due_date": due})
    assert made.status_code in (200, 201), made.text
    assert marker in client.get(f"/donors/{donor_id}").text           # local mode still shows it
    for path in ("/tasks", "/tasks?due=today", "/calendar", "/people?type=giver", "/donors", f"/donors/{donor_id}"):
        assert private in client.get(path).text, path                  # ... and the private task
    public_mode.set_enabled(True)
    h = {"Origin": VERCEL}
    paths = ["/health", "/public-mode", "/home/summary", "/people", "/people/attention",
             f"/people/{donor_id}/merges", f"/people/{donor_id}/pledges", f"/people/{donor_id}/interests",
             "/donors", f"/donors/{donor_id}", "/duplicates", "/targets", "/targets/quarters", "/targets/donors",
             "/calendar", "/tasks", "/tasks?due=today", "/people?type=giver", "/artifacts", "/events", "/context", f"/context/search?q={marker}",
             "/context/search?q=call", "/context/status", "/community/stats", "/alerts", "/icp", "/prospects",
             "/org-profile", "/interest-tags", "/campaigns", "/outbox"]
    for path in paths:
        r = client.get(path, headers=h)
        assert r.status_code in (200, 404), (path, r.status_code)
        assert marker not in r.text and "4242" not in r.text and private not in r.text, path
    assert client.get(f"/donors/{donor_id}", headers=h).json()["call_notes"] == []
    # every allow-listed GET pattern is covered by a probed path above
    for method, rx in public_mode.ALLOW:
        if method == "GET":
            assert any(rx.match(p.split("?")[0]) for p in paths), rx.pattern
