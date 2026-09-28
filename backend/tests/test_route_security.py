"""Role checks on every route (spec 20.1): the full route -> roles table is pinned here,
and every restricted route is called as each wrong role (must be 403) and with no token (401).
Adding a route without deciding its roles makes this test fail."""

import pytest
from fastapi.routing import APIRoute
from fastapi.testclient import TestClient

from app.api.router import api_router
from app.core.security import CurrentUser, get_current_user
from app.main import app

PUBLIC = {"POST /auth/login", "POST /auth/face/challenge", "POST /auth/face/login"}

# Expected roles per route. Every other route must be in PUBLIC or ANY_LOGGED_IN.
ROLES: dict[str, set[str]] = {
    **{r: {"admin"} for r in [
        "GET /users", "POST /users/students", "POST /users/teachers", "POST /users/admins", "GET /users/{user_id}",
        "PATCH /users/{user_id}", "POST /users/{user_id}/reset-password", "POST /users/{user_id}/resend-credentials",
        "GET /departments/summary", "POST /departments", "PATCH /departments/{department_id}",
        "DELETE /departments/{department_id}", "POST /courses", "PATCH /courses/{course_id}", "DELETE /courses/{course_id}",
        "POST /courses/{course_id}/teacher", "POST /courses/{course_id}/enrollments",
        "DELETE /courses/{course_id}/enrollments/{student_id}", "GET /face/status", "POST /face/{user_id}/enroll",
        "DELETE /face/{user_id}", "POST /fees", "PATCH /fees/{fee_type_id}", "POST /invoices/{invoice_id}/cancel",
        "GET /audit-logs", "GET /email-logs",
    ]},
    **{r: {"teacher"} for r in [
        "POST /attendance/sessions", "GET /attendance/sessions", "PATCH /attendance/sessions/{session_id}",
        "POST /attendance/sessions/{session_id}/manual-mark",
    ]},
    **{r: {"student"} for r in [
        "GET /attendance/open", "GET /attendance/student-sessions/{session_id}",
        "POST /attendance/sessions/{session_id}/verify-code", "POST /attendance/challenge",
        "POST /attendance/sessions/{session_id}/mark", "GET /attendance/me", "POST /invoices/{invoice_id}/pay",
    ]},
    **{r: {"admin", "teacher"} for r in ["GET /attendance/sessions/{session_id}", "GET /reports/attendance"]},
    **{r: {"admin", "student"} for r in [
        "GET /invoices", "POST /invoices", "GET /invoices/{invoice_id}", "GET /payments/{payment_id}",
    ]},
    "GET /my/courses": {"student", "teacher"},
}
# Logged-in users of every role; the service layer scopes the data to the caller.
ANY_LOGGED_IN = {
    "GET /me", "POST /me/password", "GET /departments", "GET /courses", "GET /courses/{course_id}", "GET /fees",
    "POST /assistant/message", "POST /assistant/confirm", "GET /assistant/conversations",
    "GET /assistant/conversations/{conversation_id}", "DELETE /assistant/conversations/{conversation_id}",
    "GET /dashboard",
}


def _walk(routes):
    for r in routes:
        if isinstance(r, APIRoute):
            yield r
        elif hasattr(r, "original_router"):   # FastAPI keeps included routers lazily
            yield from _walk(r.original_router.routes)


def _calls(dependant):
    for sub in dependant.dependencies:
        yield sub.call
        yield from _calls(sub)


def _route_table() -> dict[str, tuple[bool, set[str]]]:
    """'METHOD /path' -> (requires login, allowed roles or empty set for any role)."""
    table = {}
    for route in _walk(api_router.routes):
        calls = list(_calls(route.dependant))
        roles: set[str] = set()
        for call in calls:   # require_roles(...) closures carry the allowed roles
            for cell in getattr(call, "__closure__", None) or ():
                if isinstance(cell.cell_contents, tuple):
                    roles |= set(cell.cell_contents)
        for method in route.methods:
            table[f"{method} {route.path}"] = (get_current_user in calls, roles)
    return table


TABLE = _route_table()


def test_every_route_has_a_decided_access_rule():
    undecided = set(TABLE) - PUBLIC - ANY_LOGGED_IN - set(ROLES)
    assert undecided == set(), f"New routes need an access decision in this test: {sorted(undecided)}"
    assert set(ROLES) | PUBLIC | ANY_LOGGED_IN <= set(TABLE), "A route listed here no longer exists"


def test_only_login_routes_are_public():
    assert {k for k, (auth, _) in TABLE.items() if not auth} == PUBLIC


@pytest.mark.parametrize("key", sorted(ROLES))
def test_route_roles_match(key):
    assert TABLE[key][1] == ROLES[key]


@pytest.mark.parametrize("key", sorted(ANY_LOGGED_IN))
def test_shared_routes_need_login_only(key):
    assert TABLE[key] == (True, set())


def _url(key: str) -> tuple[str, str]:
    method, path = key.split(" ", 1)
    return method, "/api/v1" + path.replace("{", "").replace("}", "")   # {user_id} -> user_id (any string)


client = TestClient(app)


@pytest.mark.parametrize("key", sorted(set(ROLES) | ANY_LOGGED_IN))
def test_no_token_is_401(key):
    method, url = _url(key)
    assert client.request(method, url, json={}).status_code == 401


WRONG_ROLE_CALLS = [(key, role) for key, allowed in sorted(ROLES.items())
                    for role in ("admin", "teacher", "student") if role not in allowed]


@pytest.mark.parametrize("key,role", WRONG_ROLE_CALLS)
def test_wrong_role_is_403(key, role):
    """E.g. a student calling an admin route is refused before any business logic runs."""
    fake = CurrentUser(id="u1", role=role, email="x@aiu.edu", full_name="X", profile={}, access_token="t")
    app.dependency_overrides[get_current_user] = lambda: fake
    try:
        method, url = _url(key)
        r = client.request(method, url, json={})
    finally:
        app.dependency_overrides.pop(get_current_user, None)
    assert r.status_code == 403, f"{role} -> {key} gave {r.status_code}"
    assert r.json()["error"]["code"] == "forbidden"
