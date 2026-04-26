"""Per-user + per-org data isolation regression tests (M3.2 + M3.3).

Same scenarios as the original standalone smoke script (commit history shows
the migration), but split into pytest functions for CI runtime + targeted
re-runs. Fixtures from conftest.py provide the TestClient + identity switch.

Two scopes covered:
  Personal — A/B can't see each other's rows
  Workspaces — A in org-X / C in org-X / D in org-Y / A-personal — three-way
    cross-isolation: org sharing within X, total invisibility from Y, and
    personal-vs-org separation for the same human user.
"""

from __future__ import annotations

import pytest
from sqlalchemy import text
from sqlmodel import Session

from db.session import engine
from tests.conftest import (
    USER_A,
    USER_A_IN_ORG_X,
    USER_B,
    USER_C_IN_ORG_X,
    USER_D_IN_ORG_X,
    USER_E_IN_ORG_Y,
)


_ALL_USER_IDS = [
    USER_A.user_id,
    USER_B.user_id,
    USER_C_IN_ORG_X.user_id,
    USER_D_IN_ORG_X.user_id,
    USER_E_IN_ORG_Y.user_id,
]
_ALL_ORG_IDS = [
    USER_A_IN_ORG_X.org_id,
    USER_C_IN_ORG_X.org_id,
    USER_D_IN_ORG_X.org_id,
    USER_E_IN_ORG_Y.org_id,
]


@pytest.fixture(autouse=True)
def _reset_test_data():
    """Wipe all rows owned by any test user/org before each test.

    Without this, projects + extractions created in one test leak into the
    next, breaking ownership-counting assertions like
    `len(projects) == 1` in test_a_still_owns_after_b_attempts.
    """
    with Session(engine) as s:
        for uid in _ALL_USER_IDS:
            for tbl in ("usage_log", "extraction", "project", "user_settings"):
                s.execute(text(f"DELETE FROM {tbl} WHERE user_id = :uid"), {"uid": uid})
        for oid in _ALL_ORG_IDS:
            for tbl in ("extraction", "project"):
                s.execute(text(f"DELETE FROM {tbl} WHERE org_id = :oid"), {"oid": oid})
        s.commit()
    yield


# ---- shared setup helpers -------------------------------------------------


def _create_extraction_in_personal_scope(client, project_id: str | None = None) -> str:
    """Create one extraction (mock-mode) in current user's personal scope.
    Returns the extraction id."""
    data = {"text": "isolation test doc", "filename": "iso.txt"}
    if project_id:
        data["project_id"] = project_id
    r = client.post("/api/extract", data=data)
    assert r.status_code == 200, r.text
    return r.json()["id"]


# ---- M3.2 — personal-vs-personal isolation -------------------------------


def test_b_cannot_see_a_extractions(client, as_user):
    as_user(USER_A)
    a_ext = _create_extraction_in_personal_scope(client)

    as_user(USER_B)
    assert client.get("/api/extractions").json() == []
    assert client.get(f"/api/extractions/{a_ext}").status_code == 404
    assert client.get(f"/api/extractions/{a_ext}/versions").status_code == 404
    assert client.get(f"/api/extractions/{a_ext}/gaps").status_code == 404
    assert client.get(f"/api/extractions/{a_ext}/source").status_code == 404


def test_b_cannot_mutate_a_extractions(client, as_user):
    as_user(USER_A)
    a_ext = _create_extraction_in_personal_scope(client)

    as_user(USER_B)
    assert client.patch(f"/api/extractions/{a_ext}", json={"filename": "hacked.txt"}).status_code == 404
    assert client.delete(f"/api/extractions/{a_ext}").status_code == 404
    assert client.patch(f"/api/extractions/{a_ext}/gaps/0", json={"resolved": True}).status_code == 404
    assert client.post(f"/api/extractions/{a_ext}/rerun", json={}).status_code == 404


def test_b_cannot_see_or_attach_to_a_projects(client, as_user):
    as_user(USER_A)
    a_proj = client.post("/api/projects", json={"name": "A's project"}).json()["id"]

    as_user(USER_B)
    assert client.get("/api/projects").json() == []
    assert client.patch(f"/api/projects/{a_proj}", json={"name": "stolen"}).status_code == 404
    assert client.delete(f"/api/projects/{a_proj}").status_code == 404
    # Attempt to attach a new B extraction to A's project should 400
    r = client.post("/api/extract", data={"text": "x", "filename": "x.txt", "project_id": a_proj})
    assert r.status_code == 400


def test_b_import_collision_on_a_extraction_id(client, as_user):
    as_user(USER_A)
    a_ext = _create_extraction_in_personal_scope(client)

    as_user(USER_B)
    payload = {
        "id": a_ext,
        "filename": "evil.txt",
        "saved_at": "2025-01-01T00:00:00Z",
        "payload": {
            "filename": "evil.txt",
            "raw_text": "x",
            "live": False,
            "brief": {"summary": "x", "tags": []},
            "actors": [],
            "stories": [],
            "nfrs": [],
            "gaps": [],
        },
    }
    assert client.post("/api/extractions/import", json=payload).status_code == 409


def test_a_still_owns_after_b_attempts(client, as_user):
    as_user(USER_A)
    a_ext = _create_extraction_in_personal_scope(client)
    a_proj = client.post("/api/projects", json={"name": "A's project"}).json()["id"]

    as_user(USER_B)
    client.delete(f"/api/extractions/{a_ext}")  # 404 — no-op
    client.delete(f"/api/projects/{a_proj}")     # 404 — no-op
    client.post("/api/projects", json={"name": "B's project"})  # creates B's own

    as_user(USER_A)
    r = client.get(f"/api/extractions/{a_ext}")
    assert r.status_code == 200
    assert r.json()["filename"] == "iso.txt"
    projects = client.get("/api/projects").json()
    assert len(projects) == 1 and projects[0]["id"] == a_proj


# ---- M3.3 — workspace (org) isolation ------------------------------------


def test_personal_data_invisible_in_org_context(client, as_user):
    """A's personal extraction must NOT show up when A switches into org-X."""
    as_user(USER_A)
    a_ext = _create_extraction_in_personal_scope(client)

    as_user(USER_A_IN_ORG_X)
    assert client.get("/api/extractions").json() == []
    assert client.get(f"/api/extractions/{a_ext}").status_code == 404


def test_org_data_visible_to_all_org_members(client, as_user):
    """Workspace data is shared — C creates, D sees, both can mutate."""
    as_user(USER_C_IN_ORG_X)
    proj = client.post("/api/projects", json={"name": "shared org-X project"}).json()["id"]
    ext = client.post(
        "/api/extract",
        files={"file": ("doc.txt", b"shared.", "text/plain")},
        data={"project_id": proj},
    ).json()["id"]

    as_user(USER_D_IN_ORG_X)
    extractions = client.get("/api/extractions").json()
    assert any(e["id"] == ext for e in extractions), "D should see C's extraction"
    projects = client.get("/api/projects").json()
    assert any(p["id"] == proj for p in projects), "D should see C's project"
    # And mutate
    r = client.patch(f"/api/extractions/{ext}", json={"filename": "edited-by-d.txt"})
    assert r.status_code == 200


def test_other_org_sees_nothing(client, as_user):
    """E in org-Y must be totally blind to org-X data."""
    as_user(USER_C_IN_ORG_X)
    proj = client.post("/api/projects", json={"name": "org-X only"}).json()["id"]
    ext = client.post(
        "/api/extract",
        files={"file": ("d.txt", b"x", "text/plain")},
        data={"project_id": proj},
    ).json()["id"]

    as_user(USER_E_IN_ORG_Y)
    assert client.get("/api/extractions").json() == []
    assert client.get("/api/projects").json() == []
    assert client.get(f"/api/extractions/{ext}").status_code == 404
    assert client.delete(f"/api/extractions/{ext}").status_code == 404
    assert client.patch(f"/api/projects/{proj}", json={"name": "stolen"}).status_code == 404


def test_org_data_invisible_when_user_returns_to_personal(client, as_user):
    """A creates in org-X, switches back to personal — org row gone from view."""
    as_user(USER_A_IN_ORG_X)
    proj = client.post("/api/projects", json={"name": "org-X work"}).json()["id"]
    ext = client.post(
        "/api/extract",
        files={"file": ("o.txt", b"x", "text/plain")},
        data={"project_id": proj},
    ).json()["id"]

    as_user(USER_A)
    extractions = client.get("/api/extractions").json()
    assert not any(e["id"] == ext for e in extractions)
    assert client.get(f"/api/extractions/{ext}").status_code == 404
