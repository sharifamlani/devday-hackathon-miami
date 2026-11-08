"""The public link switch (service/public_gate.py, docs/public-tunnel.md "Toggle") and the tunnel script's safety check."""
import importlib.util
import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from service import public_gate, public_mode
from service.main import app

VERCEL = "https://devday-donor-desk.vercel.app"
H = {"Origin": VERCEL}


@pytest.fixture(autouse=True)
def restore_public_mode():
    public_mode.set_enabled(False, [VERCEL])
    yield
    public_mode.set_enabled(False)


@pytest.fixture
def client(db_file):
    return TestClient(app)


def test_missing_file_means_on(client):
    assert not public_gate.gate_file().exists()
    assert client.get("/public-link").json() == {"on": True}


def test_off_closes_the_public_service_without_a_restart(client):
    """S1: off -> every public request is 503, /health too (the web's probe fails -> snapshot); on -> served again."""
    public_mode.set_enabled(True)
    assert client.get("/donors", headers=H).status_code == 200
    public_mode.set_enabled(False)
    assert client.put("/public-link", json={"on": False}).json() == {"on": False}    # the laptop flips it
    assert json.loads(public_gate.gate_file().read_text()) == {"on": False}
    public_mode.set_enabled(True)                                                     # the public service obeys
    for path in ["/health", "/public-mode", "/donors", "/home/summary"]:
        r = client.get(path, headers=H)
        assert r.status_code == 503 and r.json()["detail"] == public_mode.LINK_OFF, path
    public_mode.set_enabled(False)
    client.put("/public-link", json={"on": True})
    public_mode.set_enabled(True)
    assert client.get("/health").status_code == 200
    assert client.get("/donors", headers=H).status_code == 200


def test_laptop_service_ignores_the_gate(client):
    """LIVE (:8001, no PUBLIC_MODE) keeps working whatever the switch says."""
    client.put("/public-link", json={"on": False})
    assert client.get("/donors").status_code == 200


def test_switch_is_refused_from_the_public_side(client):
    """S-neg: through the tunnel the switch can't be flipped, with any Origin."""
    public_mode.set_enabled(True)
    for headers in (H, {}, {"Origin": "https://evil.example"}):
        assert client.put("/public-link", json={"on": False}, headers=headers).status_code == 403
    assert not public_gate.gate_file().exists()


def load_script():
    path = Path(__file__).resolve().parents[2] / "scripts" / "public_tunnel.py"
    spec = importlib.util.spec_from_file_location("public_tunnel", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def test_script_defaults_to_the_public_port_and_refuses_a_writable_one(monkeypatch, capsys):
    mod = load_script()
    assert mod.DEFAULT_PORT == 8401
    monkeypatch.setattr(mod, "public_mode_on", lambda port: False)
    monkeypatch.setattr(mod.shutil, "which", lambda name: pytest.fail("must refuse before looking for cloudflared"))
    args = mod.argparse.Namespace(port=8001, unsafe=False)
    assert mod.cmd_on(args) == 1
    assert "refusing" in capsys.readouterr().out
