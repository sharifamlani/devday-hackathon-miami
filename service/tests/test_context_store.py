"""§21.2.3 context store: every row gets a kind, a title and an embedding; search is cosine x recency,
newest first on ties. No network: the classifier and the embedder are stood in."""

import numpy as np
import pytest

from service import db, org_context as oc

ROWS = [  # (source, url, posted_at, fact)
    ("news", "https://miamifoundation.org/n/scholarships/", "2026-08-31", "The Miami Foundation awarded scholarships totaling $3.45 million to 969 students."),
    ("news", "https://miamifoundation.org/n/set/", "2026-10-01", "Over 300 nonprofit leaders trained at SET Summits helped prepare for Give Miami Day."),
    ("website", "https://miamifoundation.org/who-we-are/", "2026-03-26", "Since 1967, The Foundation has invested over $905M in Greater Miami."),
    ("website", "https://miamifoundation.org/old/", "2024-12-20", "The Miami Foundation awarded 883 student scholarships in 2024."),
]
KIND_OF = {"3.45": "use_of_funds", "SET": "success_story", "1967": "org_health", "883": "use_of_funds"}


def fake_vector(text: str) -> bytes:
    """Deterministic 4-d 'embedding': one axis per theme, so cosine is predictable."""
    t = text.lower()
    v = np.array([("scholarship" in t) + ("student" in t), ("nonprofit" in t) + ("summit" in t),
                  ("invested" in t) + ("1967" in t), 0.1], dtype=np.float32)
    return v.tobytes()


@pytest.fixture
def store(monkeypatch, tmp_path):
    monkeypatch.setattr(oc, "CONTEXT_LIVE", tmp_path / "live.json")          # no runtime file: classify instead
    monkeypatch.setattr(oc, "CONTEXT_CACHE", tmp_path / "cache.json")
    monkeypatch.setattr(oc, "embed_texts", lambda texts: [fake_vector(t) for t in texts])
    monkeypatch.setattr(oc, "classify_facts",
                        lambda facts: [(next(v for k, v in KIND_OF.items() if k in f), oc.short_title(f)) for f in facts])
    c = db.connect(":memory:")
    db.create_schema(c)
    c.executemany("INSERT INTO org_context (source, url, posted_at, fact) VALUES (?, ?, ?, ?)", ROWS)
    c.commit()
    yield c
    c.close()


def test_schema_adds_the_store_columns(conn):
    cols = {r[1] for r in conn.execute("PRAGMA table_info(org_context)")}
    assert {"kind", "title", "embedding", "cached"} <= cols


def test_index_gives_every_row_a_kind_title_and_embedding(store):
    oc.index_context(store)
    rows = store.execute("SELECT kind, title, embedding, url FROM org_context").fetchall()
    assert all(r[0] in oc.KINDS and r[1] and r[2] and r[3] for r in rows)
    assert oc.index_context(store) == {"classified": 0, "embedded": 0}           # idempotent


def test_no_query_returns_newest_first_within_the_asked_kinds(store):
    got = oc.search_context(kinds=["use_of_funds"], conn=store, as_of="2026-11-08")
    assert [r["posted_at"] for r in got] == ["2026-08-31", "2024-12-20"]
    allrows = oc.search_context(conn=store, as_of="2026-11-08")
    assert [r["posted_at"] for r in allrows] == sorted((r[2] for r in ROWS), reverse=True)
    assert all(r["source_url"] and r["kind"] for r in allrows)


def test_query_ranks_by_similarity_times_recency(store):
    got = oc.search_context("scholarships for students", conn=store, as_of="2026-11-08")
    assert got[0]["source_url"].endswith("/scholarships/")                       # same theme, recent
    old = next(r for r in got if r["source_url"].endswith("/old/"))
    assert old["score"] < got[0]["score"]                                        # same theme, two years older


def test_kind_and_title_come_from_the_run_that_found_the_fact(store, monkeypatch, tmp_path):
    live = tmp_path / "live2.json"
    live.write_text('{"miamifoundation.org": {"facts": [{"url": "https://miamifoundation.org/n/set/", '
                    '"fact": "Over 300 nonprofit leaders trained at SET Summits helped prepare for Give Miami Day.", '
                    '"kind": "program_update", "title": "SET Summits train nonprofit leaders"}]}}', encoding="utf-8")
    monkeypatch.setattr(oc, "CONTEXT_LIVE", live)
    oc.index_context(store)
    kind, title = store.execute("SELECT kind, title FROM org_context WHERE url LIKE '%/set/'").fetchone()
    assert (kind, title) == ("program_update", "SET Summits train nonprofit leaders")


def test_heuristic_kinds_without_a_model():
    assert oc.heuristic_kind("Since 1967, The Foundation has invested over $905M") == "org_health"
    assert oc.heuristic_kind("The Foundation awarded grants to 12 nonprofits") == "use_of_funds"
    assert oc.heuristic_kind("969 students received scholarships") == "success_story"


def test_search_route(db_file, monkeypatch):
    from fastapi.testclient import TestClient
    from service.main import app
    monkeypatch.setattr(oc, "embed_texts", lambda texts: [fake_vector(t) for t in texts])
    monkeypatch.setattr(oc, "classify_facts", lambda facts: [("org_health", oc.short_title(f)) for f in facts])
    c = db.connect(db_file)
    c.executemany("INSERT INTO org_context (source, url, posted_at, fact) VALUES (?, ?, ?, ?)", ROWS)
    c.commit(); c.close()
    r = TestClient(app).get("/context/search", params={"kinds": "org_health", "k": 3})
    assert r.status_code == 200
    body = r.json()
    assert len(body) == 3 and set(body[0]) == {"id", "kind", "title", "text", "source_url", "posted_at", "score"}
    assert [x["posted_at"] for x in body] == sorted((x["posted_at"] for x in body), reverse=True)
