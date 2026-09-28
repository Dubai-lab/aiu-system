"""Pending-action confirmation and expiry (spec 13.5 / 20.1), against an in-memory table."""

from datetime import datetime, timedelta, timezone

import pytest

from app.assistant import registry
from app.assistant.registry import ToolContext, ToolOutcome
from app.core.security import CurrentUser


class _Query:
    """Just enough of the supabase-py query builder for registry's pending-action code."""

    def __init__(self, rows: list[dict], op: str = "select", values: dict | None = None):
        self.rows, self.op, self.values, self.filters, self.n = rows, op, values, [], None

    def select(self, *_):
        return self

    def update(self, values):
        return _Query(self.rows, "update", values)

    def insert(self, values):
        return _Query(self.rows, "insert", values)

    def eq(self, key, value):
        self.filters.append((key, value))
        return self

    def order(self, *_, **__):
        return self

    def limit(self, n):
        self.n = n
        return self

    def execute(self):
        if self.op == "insert":
            row = {"id": f"p{len(self.rows) + 1}", "status": "pending", **self.values}
            self.rows.append(row)
            return type("R", (), {"data": [row]})
        hits = [r for r in self.rows if all(r.get(k) == v for k, v in self.filters)]
        if self.op == "update":
            for r in hits:
                r.update(self.values)
        return type("R", (), {"data": hits[: self.n] if self.n else hits})


class _DB:
    def __init__(self):
        self.rows: list[dict] = []

    def table(self, _name):
        return _Query(self.rows)


def _ctx(user_id="u1", role="student", conversation="c1") -> ToolContext:
    user = CurrentUser(id=user_id, role=role, email="s@x.com", full_name="S", profile={}, access_token="t")
    return ToolContext(user=user, conversation_id=conversation)


@pytest.fixture
def db(monkeypatch):
    fake = _DB()
    monkeypatch.setattr(registry, "service_client", lambda: fake)
    ran: list[dict] = []
    tool = registry.all_tools()["pay_invoice"]
    monkeypatch.setattr(tool, "run", lambda c, a: ran.append(a) or ToolOutcome(data={"ok": True, "paid": a}))
    fake.ran = ran
    return fake


def _store(ctx):
    return registry.store_pending_action(ctx, "pay_invoice", {"invoice_id": "i1"}, "Pay 100.00 USD")


def test_confirm_runs_exactly_once(db):
    ctx = _ctx()
    pending = _store(ctx)
    assert registry.resolve_pending(ctx, pending["id"], "confirm").data["ok"] is True
    assert db.ran == [{"invoice_id": "i1"}]
    # A second confirm (double click, or "yes" again by voice) does nothing.
    again = registry.resolve_pending(ctx, pending["id"], "confirm").data
    assert again["ok"] is False and db.ran == [{"invoice_id": "i1"}]


def test_cancel_never_runs(db):
    ctx = _ctx()
    pending = _store(ctx)
    out = registry.resolve_pending(ctx, pending["id"], "cancel").data
    assert out["cancelled"] is True and db.ran == []
    assert registry.resolve_pending(ctx, pending["id"], "confirm").data["ok"] is False and db.ran == []


def test_expired_confirmation_cannot_run(db):
    ctx = _ctx()
    pending = _store(ctx)
    pending["expires_at"] = (datetime.now(timezone.utc) - timedelta(seconds=1)).isoformat()
    out = registry.resolve_pending(ctx, pending["id"], "confirm").data
    assert out["ok"] is False and "expired" in out["error"]
    assert db.ran == [] and db.rows[0]["status"] == "expired"


def test_someone_elses_pending_action_cannot_be_confirmed(db):
    pending = _store(_ctx(user_id="owner"))
    out = registry.resolve_pending(_ctx(user_id="intruder"), pending["id"], "confirm").data
    assert out["ok"] is False and db.ran == []


def test_new_request_replaces_the_old_one(db):
    ctx = _ctx()
    first = _store(ctx)
    second = _store(ctx)
    assert first["status"] == "cancelled" and second["status"] == "pending"
    # Voice "yes" without an id confirms the latest one only.
    registry.resolve_pending(ctx, None, "confirm")
    assert len(db.ran) == 1 and second["status"] == "confirmed"


def test_role_is_rechecked_at_confirmation(db):
    """Even a stored action can't run if the caller's role doesn't have the tool."""
    teacher = _ctx(role="teacher")
    pending = _store(teacher)
    out = registry.resolve_pending(teacher, pending["id"], "confirm").data
    assert out["ok"] is False and db.ran == []
