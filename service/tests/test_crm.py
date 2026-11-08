"""The Donors tab's notes, tasks and tags (service/routes_crm.py): react-admin-shaped CRUD, donor and tag
checks, default tags, the migration, logging and the snapshot export. No network."""

import logging

import pytest
from fastapi.testclient import TestClient

from service import db
from service.export_snapshot import build_snapshot
from service.main import app

JAMES = 3       # seed donors (db.SEED_DONORS)
MARIA = 1
SECRET = "prefers to give anonymously because of a family matter"


@pytest.fixture
def client(db_file):
    return TestClient(app)


def note(**over):
    return {"contact_id": JAMES, "text": SECRET, "date": "2026-11-07T18:00:00.000Z", "status": "warm",
            "sales_id": 0, **over}


def task(**over):
    return {"contact_id": JAMES, "type": "call", "text": "Call about the gala", "due_date": "2026-11-09T15:00:00.000Z",
            "sales_id": 0, **over}


# ----------------------------------------------------------------------------------------------
# Notes and tasks
# ----------------------------------------------------------------------------------------------

def test_note_create_get_update_delete(client):
    created = client.post("/crm/contact_notes", json=note()).json()
    assert created["id"] and created["contact_id"] == JAMES and created["text"] == SECRET
    assert created["sales_id"] == 0 and created["attachments"] == [] and created["created_at"]
    assert client.get(f"/crm/contact_notes/{created['id']}").json() == created

    changed = client.patch(f"/crm/contact_notes/{created['id']}", json={"text": "Edited", "id": created["id"]}).json()
    assert changed["text"] == "Edited" and changed["date"] == created["date"] and changed["status"] == "warm"

    removed = client.delete(f"/crm/contact_notes/{created['id']}")
    assert removed.status_code == 200 and removed.json()["text"] == "Edited"
    assert client.get(f"/crm/contact_notes/{created['id']}").status_code == 404
    assert client.delete(f"/crm/contact_notes/{created['id']}").status_code == 404


def test_list_filters_by_donor_sorts_and_pages(client):
    for day in ("05", "07", "06"):
        client.post("/crm/contact_notes", json=note(date=f"2026-11-{day}T10:00:00.000Z", text=f"day {day}"))
    client.post("/crm/contact_notes", json=note(contact_id=MARIA, text="other donor"))

    mine = client.get(f"/crm/contact_notes?contact_id={JAMES}").json()
    assert mine["total"] == 3
    assert [n["text"] for n in mine["data"]] == ["day 07", "day 06", "day 05"]     # newest first by default

    page = client.get(f"/crm/contact_notes?contact_id={JAMES}&sort=date&order=ASC&page=2&per_page=2").json()
    assert page["total"] == 3 and [n["text"] for n in page["data"]] == ["day 07"]

    assert client.get("/crm/contact_notes").json()["total"] == 4
    assert client.get("/crm/contact_notes?sort=text").status_code == 422          # not a sortable column
    assert client.get("/crm/contact_notes?per_page=5000").status_code == 422


def test_tasks_open_done_and_sales_filter(client):
    a = client.post("/crm/tasks", json=task()).json()
    client.post("/crm/tasks", json=task(sales_id="7", due_date="2026-11-08"))
    assert a["done_date"] is None and a["type"] == "call"

    done = client.patch(f"/crm/tasks/{a['id']}", json={"done_date": "2026-11-08T09:00:00.000Z"}).json()
    assert done["done_date"] == "2026-11-08T09:00:00.000Z"
    reopened = client.patch(f"/crm/tasks/{a['id']}", json={"done_date": None}).json()
    assert reopened["done_date"] is None                                            # null clears it

    listed = client.get(f"/crm/tasks?contact_id={JAMES}").json()
    assert [t["due_date"] for t in listed["data"]] == ["2026-11-08", "2026-11-09T15:00:00.000Z"]   # due first
    assert [t["sales_id"] for t in client.get("/crm/tasks?sales_id=7").json()["data"]] == ["7"]
    assert client.get("/crm/tasks?sales_id=0").json()["total"] == 1


def test_get_many_by_ids(client):
    ids = [client.post("/crm/tasks", json=task()).json()["id"] for _ in range(3)]
    got = client.get(f"/crm/tasks?ids={ids[0]},{ids[2]}&sort=id").json()
    assert [t["id"] for t in got["data"]] == [ids[0], ids[2]]
    assert client.get("/crm/tasks?ids=").json()["data"] == []
    assert client.get("/crm/tasks?ids=a,b").status_code == 422


def test_unknown_donor_bad_dates_and_cleared_required_fields_are_refused(client):
    assert client.post("/crm/contact_notes", json=note(contact_id=9999)).status_code == 422
    assert client.post("/crm/tasks", json=task(due_date="next week")).status_code == 422
    assert client.post("/crm/tasks", json=task(due_date="")).status_code == 422
    created = client.post("/crm/tasks", json=task()).json()
    assert client.patch(f"/crm/tasks/{created['id']}", json={"text": None}).status_code == 422
    assert client.patch(f"/crm/tasks/{created['id']}", json={"contact_id": 9999}).status_code == 422
    assert client.patch("/crm/tasks/9999", json={"text": "x"}).status_code == 404
    assert client.get("/crm/deals").status_code == 422                              # not a CRM resource here


def test_attachments_keep_durable_urls_only(client):
    ok = client.post("/crm/contact_notes", json=note(attachments=[
        {"src": "data:text/plain;base64,aGk=", "title": "hi.txt", "type": "text/plain"}])).json()
    assert ok["attachments"] == [{"src": "data:text/plain;base64,aGk=", "title": "hi.txt", "type": "text/plain"}]
    for src in ("blob:http://localhost/123", "javascript:alert(1)"):
        r = client.post("/crm/contact_notes", json=note(attachments=[{"src": src, "title": "x"}]))
        assert r.status_code == 422


def test_text_is_never_logged_or_echoed_in_errors(client, caplog):
    with caplog.at_level(logging.DEBUG):
        created = client.post("/crm/contact_notes", json=note()).json()
        client.patch(f"/crm/contact_notes/{created['id']}", json={"text": SECRET + " again"})
        bad = client.post("/crm/contact_notes", json=note(date="not a date"))
        client.delete(f"/crm/contact_notes/{created['id']}")
    assert any("crm:" in r.getMessage() for r in caplog.records)
    assert all(SECRET not in r.getMessage() for r in caplog.records)
    assert bad.status_code == 422 and SECRET not in bad.text


# ----------------------------------------------------------------------------------------------
# Tags and what the tab adds to a donor
# ----------------------------------------------------------------------------------------------

def test_new_database_starts_with_the_fundraising_tags(client):
    names = [t["name"] for t in client.get("/crm/tags?per_page=100").json()["data"]]
    assert names[:2] == ["Board member", "Volunteer"] and len(names) == len(db.CRM_DEFAULT_TAGS)


def test_a_deleted_default_tag_stays_deleted(client, db_file):
    assert client.delete("/crm/tags/1").status_code == 200
    conn = db.connect(db_file)
    db.create_schema(conn)                          # every request runs this
    conn.close()
    assert 1 not in [t["id"] for t in client.get("/crm/tags").json()["data"]]


def test_tag_crud_and_validation(client):
    tag = client.post("/crm/tags", json={"name": "  Gala host ", "color": "#fad2e1"}).json()
    assert tag["name"] == "Gala host"
    assert client.patch(f"/crm/tags/{tag['id']}", json={"color": "#e2ece9"}).json()["color"] == "#e2ece9"
    assert client.post("/crm/tags", json={"name": "x", "color": "red; drop"}).status_code == 422
    assert client.post("/crm/tags", json={"name": "   ", "color": "#ffffff"}).status_code == 422


def test_donor_tags_background_and_last_seen(client):
    assert client.get("/crm/contacts").json() == []
    saved = client.patch(f"/crm/contacts/{JAMES}", json={"tags": [3, 1, 3]}).json()
    assert saved == {"contact_id": JAMES, "tags": [3, 1], "background": None, "last_seen": None}   # order kept
    saved = client.patch(f"/crm/contacts/{JAMES}", json={"background": "Met at the 2025 gala",
                                                          "last_seen": "2026-11-07T18:00:00.000Z"}).json()
    assert saved["tags"] == [3, 1] and saved["background"] == "Met at the 2025 gala"     # tags untouched

    tagged = client.get(f"/crm/tags?contact_id={JAMES}&sort=id").json()
    assert [t["id"] for t in tagged["data"]] == [1, 3]                                   # getManyReference

    client.delete("/crm/tags/3")
    assert client.get("/crm/contacts").json()[0]["tags"] == [1]                          # gone from the donor

    assert client.patch(f"/crm/contacts/{JAMES}", json={"tags": [999]}).status_code == 422
    assert client.patch("/crm/contacts/9999", json={"tags": []}).status_code == 404
    assert client.patch(f"/crm/contacts/{JAMES}", json={"tags": []}).json()["tags"] == []


def test_routes_are_in_the_openapi_table(client):
    """The web's routes.ts only calls routes listed here."""
    paths = client.get("/openapi.json").json()["paths"]
    assert {"get", "post"} <= paths["/crm/{resource}"].keys()
    assert {"get", "patch", "delete"} <= paths["/crm/{resource}/{record_id}"].keys()
    assert "patch" in paths["/crm/contacts/{contact_id}"]


# ----------------------------------------------------------------------------------------------
# Migration, merges and the snapshot
# ----------------------------------------------------------------------------------------------

def test_create_schema_adds_the_crm_tables_to_an_older_db(tmp_path):
    conn = db.connect(tmp_path / "old.db")
    db.create_schema(conn)
    for table in ("crm_contacts", "crm_contact_tags", "crm_tags", "crm_tasks", "crm_contact_notes"):
        conn.execute(f"DROP TABLE {table}")         # a donors.db from before these tables existed
    conn.commit()
    db.create_schema(conn)
    db.create_schema(conn)                          # idempotent
    assert len(db.crm_list(conn, "tags", per_page=100)[0]) == len(db.CRM_DEFAULT_TAGS)
    assert db.crm_list(conn, "contact_notes") == ([], 0)
    conn.close()


def test_notes_outlive_a_merge_of_their_donor(client, db_file):
    """No foreign key to donors: a merge deletes the dropped row, and staff notes must not go with it."""
    created = client.post("/crm/contact_notes", json=note()).json()
    conn = db.connect(db_file)
    conn.execute("DELETE FROM donors WHERE id = ?", (JAMES,))
    conn.commit()
    conn.close()
    assert client.get(f"/crm/contact_notes/{created['id']}").json()["text"] == SECRET


def test_snapshot_never_exports_crm_records(client, db_file):
    client.post("/crm/contact_notes", json=note())
    client.post("/crm/tasks", json=task(text="Private follow-up"))
    client.patch(f"/crm/contacts/{JAMES}", json={"tags": [1], "background": "Private background"})
    conn = db.connect(db_file)
    snap = str(build_snapshot(conn, rescore=False))
    conn.close()
    for private in (SECRET, "Private follow-up", "Private background", "Board member"):
        assert private not in snap
