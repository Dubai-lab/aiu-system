"""Auth building blocks: passwords, validation, role checks and token rejection."""

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.core.errors import AppError
from app.core.passwords import generate_default_password
from app.core.security import CurrentUser, require_roles
from app.main import app
from app.schemas.auth import ChangePasswordRequest

client = TestClient(app)


def _user(role: str) -> CurrentUser:
    return CurrentUser(id="u1", role=role, email="x@aiu.edu", full_name="X", profile={}, access_token="t")


@pytest.mark.parametrize("_", range(200))
def test_default_password_rules(_):
    pw = generate_default_password()
    assert len(pw) == 10
    assert any(c.isupper() for c in pw) and any(c.islower() for c in pw) and any(c.isdigit() for c in pw)
    assert sum(not c.isalnum() for c in pw) == 1
    assert not set(pw) & set("O0l1I")


def test_default_passwords_are_unique():
    assert len({generate_default_password() for _ in range(500)}) == 500


@pytest.mark.parametrize("bad", ["short1", "allletters", "12345678"])
def test_weak_new_password_rejected(bad):
    with pytest.raises(ValidationError):
        ChangePasswordRequest(current_password="Old12345", new_password=bad)


def test_new_password_must_differ():
    with pytest.raises(ValidationError):
        ChangePasswordRequest(current_password="Same1234", new_password="Same1234")


def test_require_roles_blocks_other_roles():
    only_admin = require_roles("admin")
    assert only_admin(_user("admin")).role == "admin"
    for role in ("teacher", "student"):
        with pytest.raises(AppError) as exc:
            only_admin(_user(role))
        assert exc.value.status_code == 403


def test_me_requires_token():
    r = client.get("/api/v1/me")
    assert r.status_code == 401
    assert r.json()["error"]["code"] == "not_authenticated"


def test_me_rejects_forged_token():
    # A token signed with "HS256" by an attacker must not be accepted.
    import jwt
    forged = jwt.encode({"sub": "someone", "aud": "authenticated"}, "guess", algorithm="HS256")
    r = client.get("/api/v1/me", headers={"Authorization": f"Bearer {forged}"})
    assert r.status_code == 401


def test_login_validation_error_shape():
    r = client.post("/api/v1/auth/login", json={"identifier": "", "password": ""})
    assert r.status_code == 422
    assert set(r.json()["error"]) == {"code", "message"}
