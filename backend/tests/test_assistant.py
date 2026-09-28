"""Assistant: role filtering, tool handlers, resolvers, and the engine loop with a mocked Claude client."""

from types import SimpleNamespace

import pytest

from app.assistant import engine, registry
from app.assistant.registry import ToolContext, ToolError, ToolOutcome
from app.assistant.resolvers import resolve_course, resolve_fee, resolve_invoice
from app.core.security import CurrentUser


def user(role: str) -> CurrentUser:
    profile = {"id": "u1", "role": role, "full_name": "Test User", "email": "t@x.com", "reg_number": None,
               "staff_title": None, "department": None, "level": None, "face_enrolled": True,
               "must_change_password": False, "is_active": True}
    return CurrentUser(id="u1", role=role, email="t@x.com", full_name="Test User", profile=profile, access_token="t")


def ctx(role: str) -> ToolContext:
    return ToolContext(user=user(role), conversation_id="c1")


# ------------------------------------------------------------------ role filtering (spec 3 / 13.4)

ADMIN_ONLY = {"register_student", "register_teacher", "reset_user_password", "update_fee_amount", "deactivate_user"}


def test_students_never_receive_admin_or_teacher_tools():
    names = {t.name for t in registry.tools_for_role("student")}
    assert not names & ADMIN_ONLY
    assert "create_attendance_session" not in names and "pay_invoice" in names


def test_teachers_cannot_pay_or_register():
    names = {t.name for t in registry.tools_for_role("teacher")}
    assert "create_attendance_session" in names and not names & (ADMIN_ONLY | {"pay_invoice"})


def test_every_spec_tool_exists():
    spec = {"navigate_to_page", "get_my_profile", "get_dashboard_summary", "confirm_pending_action", "list_my_courses",
            "list_fee_types", "create_invoice", "list_my_invoices", "pay_invoice", "list_open_attendance_sessions",
            "get_my_attendance", "create_attendance_session", "extend_attendance_session", "close_attendance_session",
            "get_session_attendance", "get_course_attendance_report", "register_student", "register_teacher",
            "search_users", "create_department", "create_course", "assign_teacher", "enroll_student", "create_fee_type",
            "update_fee_amount", "create_invoice_for_student", "cancel_invoice", "deactivate_user", "reactivate_user",
            "reset_user_password", "resend_credentials_email", "get_system_stats"}
    assert spec <= set(registry.all_tools())


def test_sensitive_tools_need_confirmation():
    tools = registry.all_tools()
    for name in ("pay_invoice", "close_attendance_session", "register_student", "register_teacher", "create_fee_type",
                 "update_fee_amount", "create_invoice_for_student", "cancel_invoice", "deactivate_user",
                 "reactivate_user", "reset_user_password"):
        assert tools[name].requires_confirmation, name
    for name in ("create_invoice", "create_attendance_session", "navigate_to_page", "resend_credentials_email"):
        assert not tools[name].requires_confirmation, name


def test_student_asking_for_admin_tool_is_refused():
    out = registry.execute("register_student", {"full_name": "X"}, ctx("student"))
    assert out.data == {"ok": False, "error": "That action is not available for your role."}


def test_tool_schemas_are_sorted_and_valid():
    schemas = registry.tool_schemas_for_role("admin")
    assert [x["name"] for x in schemas] == sorted(x["name"] for x in schemas)
    assert all(x["input_schema"]["type"] == "object" for x in schemas)


# ------------------------------------------------------------------ confirmation step (spec 13.5)

def test_confirmation_tool_does_not_run_but_stores_pending(monkeypatch):
    ran = []
    tool = registry.all_tools()["pay_invoice"]
    monkeypatch.setattr(tool, "prepare", lambda c, a: ("Pay 4,500.00 USD for invoice INV-1", {"invoice_id": "i1"}))
    monkeypatch.setattr(tool, "run", lambda c, a: ran.append(a))
    monkeypatch.setattr(registry, "store_pending_action", lambda c, n, a, summ: {"id": "p1"})
    out = registry.execute("pay_invoice", {}, ctx("student"))
    assert ran == []
    assert out.data["status"] == "confirmation_required" and out.pending_action == {"id": "p1", "summary": "Pay 4,500.00 USD for invoice INV-1"}


def test_tool_errors_are_returned_not_raised(monkeypatch):
    tool = registry.all_tools()["create_invoice"]
    monkeypatch.setattr(tool, "run", lambda c, a: (_ for _ in ()).throw(ToolError("No such fee", ["Tuition"])))
    out = registry.execute("create_invoice", {"fee": "hostel"}, ctx("student"))
    assert out.data == {"ok": False, "error": "No such fee", "valid_options": ["Tuition"]}
    monkeypatch.setattr(tool, "run", lambda c, a: 1 / 0)
    assert registry.execute("create_invoice", {"fee": "x"}, ctx("student")).data["ok"] is False


# ------------------------------------------------------------------ navigation (spec 13.6)

def test_navigate_existing_page():
    out = registry.execute("navigate_to_page", {"page_key": "student.invoices"}, ctx("student"))
    assert out.ui_actions == [{"type": "navigate", "path": "/student/finance/invoices"}]


def test_navigate_by_spoken_alias():
    out = registry.execute("navigate_to_page", {"page_key": "bills"}, ctx("student"))
    assert out.ui_actions and out.ui_actions[0]["path"] == "/student/finance/invoices"


def test_page_that_does_not_exist():
    out = registry.execute("navigate_to_page", {"page_key": "hostel page"}, ctx("student"))
    assert out.data["found"] is False and "My Invoices" in out.data["available_pages"] and not out.ui_actions


def test_other_roles_pages_are_not_reachable():
    out = registry.execute("navigate_to_page", {"page_key": "admin.students"}, ctx("student"))
    assert out.data["found"] is False


def test_pages_needing_an_item_point_to_the_specific_tool():
    out = registry.execute("navigate_to_page", {"page_key": "student.invoices.pay"}, ctx("student"))
    assert out.data["ok"] is False and not out.ui_actions


# ------------------------------------------------------------------ resolvers

COURSES = [{"id": "1", "code": "CSC401", "title": "Software Engineering"},
           {"id": "2", "code": "CSC301", "title": "Database Systems"},
           {"id": "3", "code": "CSC201", "title": "Data Structures and Algorithms"}]


@pytest.mark.parametrize("q,expected", [("CSC 401", "1"), ("csc401", "1"), ("software engineering", "1"),
                                        ("database", "2"), ("Sofware Engineering", "1")])
def test_resolve_course(q, expected):
    assert resolve_course(q, COURSES)["id"] == expected


def test_ambiguous_course_asks_with_options():
    with pytest.raises(ToolError) as e:
        resolve_course("data", COURSES)
    assert len(e.value.options) == 2


FEES = [{"id": "t", "name": "Tuition Fee - Semester 1", "category": "tuition", "amount": 4500, "currency": "USD"},
        {"id": "m", "name": "Medical Insurance - Annual", "category": "medical_insurance", "amount": 300, "currency": "USD"},
        {"id": "l", "name": "Library/ICT Fee", "category": "other", "amount": 150, "currency": "USD"}]


@pytest.mark.parametrize("q,expected", [("tuition", "t"), ("school fees", "t"), ("medical insurance", "m"),
                                        ("library", "l"), ("ICT fee", "l")])
def test_resolve_fee(q, expected):
    assert resolve_fee(q, FEES)["id"] == expected


def test_unknown_fee_lists_options():
    with pytest.raises(ToolError) as e:
        resolve_fee("hostel", FEES)
    assert len(e.value.options) == 3


INVOICES = [{"id": "a", "invoice_number": "INV-2026-000142", "status": "unpaid", "fee_type": {"name": "Tuition"}},
            {"id": "b", "invoice_number": "INV-2026-000150", "status": "paid", "fee_type": {"name": "Library"}}]


def test_resolve_invoice_by_last_digits_and_only_unpaid():
    assert resolve_invoice("142", INVOICES)["id"] == "a"
    assert resolve_invoice(None, INVOICES, only_unpaid=True)["id"] == "a"  # the only unpaid one
    with pytest.raises(ToolError):
        resolve_invoice("150", INVOICES, only_unpaid=True)                 # paid invoices cannot be paid


# ------------------------------------------------------------------ engine loop with a mocked Claude client

class FakeClaude:
    """Returns scripted responses and records what it was sent."""

    def __init__(self, responses):
        self.responses = list(responses)
        self.calls = []
        self.messages = self

    def create(self, **kwargs):
        self.calls.append({**kwargs, "messages": list(kwargs["messages"])})  # snapshot: the engine keeps appending
        return self.responses.pop(0)


def text(t):
    return SimpleNamespace(type="text", text=t)


def tool_use(i, name, inp):
    return SimpleNamespace(type="tool_use", id=i, name=name, input=inp)


def resp(stop, *blocks):
    return SimpleNamespace(stop_reason=stop, content=list(blocks),
                           usage=SimpleNamespace(input_tokens=1, output_tokens=1, cache_read_input_tokens=0,
                                                 cache_creation_input_tokens=0))


@pytest.fixture
def engine_env(monkeypatch):
    saved = []
    monkeypatch.setattr(engine, "load_history", lambda c: [])
    monkeypatch.setattr(engine, "_save", lambda c, msgs: saved.extend(msgs))
    monkeypatch.setattr(engine.registry, "latest_pending", lambda c: None)
    return saved


def test_engine_runs_tools_then_replies(monkeypatch, engine_env):
    fake = FakeClaude([
        resp("tool_use", text("Creating it."), tool_use("t1", "create_invoice", {"fee": "tuition"})),
        resp("end_turn", text("Done. Invoice INV-1 for 4,500 US dollars. Pay now or later?")),
    ])
    monkeypatch.setattr(engine, "get_client", lambda: fake)
    monkeypatch.setattr(engine.registry, "execute",
                        lambda n, a, c: ToolOutcome(data={"ok": True, "invoice": "INV-1"}, ui_actions=[{"type": "refresh", "keys": ["finance"]}]))
    r = engine._run_turn(user("student"), "c1", "Create an invoice for tuition", "/student", None)
    assert r.reply.startswith("Done.") and r.actions == [{"type": "refresh", "keys": ["finance"]}]
    # the tool result went back to Claude, paired with the tool_use id
    second = fake.calls[1]["messages"]
    assert second[-1]["content"][0] == {"type": "tool_result", "tool_use_id": "t1", "content": '{"ok": true, "invoice": "INV-1"}'}
    # only the student's tools were offered
    offered = {t["name"] for t in fake.calls[0]["tools"]}
    assert "register_student" not in offered and "create_invoice" in offered
    assert [m["role"] for m in engine_env] == ["user", "assistant", "user", "assistant"]


def test_engine_stops_after_max_rounds(monkeypatch, engine_env):
    loops = [resp("tool_use", tool_use(f"t{i}", "get_my_profile", {})) for i in range(6)]
    fake = FakeClaude(loops + [resp("end_turn", text("Here is what I found."))])
    monkeypatch.setattr(engine, "get_client", lambda: fake)
    monkeypatch.setattr(engine.registry, "execute", lambda n, a, c: ToolOutcome(data={"ok": True}))
    r = engine._run_turn(user("student"), "c1", "loop forever", None, None)
    assert len(fake.calls) == 7 and fake.calls[-1]["tool_choice"] == {"type": "none"}
    assert r.reply == "Here is what I found."


def test_engine_reports_pending_confirmation(monkeypatch, engine_env):
    fake = FakeClaude([resp("tool_use", tool_use("t1", "pay_invoice", {})),
                       resp("end_turn", text("You're about to pay 4,500 US dollars. Shall I go ahead?"))])
    monkeypatch.setattr(engine, "get_client", lambda: fake)
    monkeypatch.setattr(engine.registry, "execute", lambda n, a, c: ToolOutcome(
        data={"status": "confirmation_required"}, pending_action={"id": "p1", "summary": "Pay 4,500"}))
    monkeypatch.setattr(engine.registry, "latest_pending", lambda c: {"id": "p1"})
    r = engine._run_turn(user("student"), "c1", "pay now", None, None)
    assert r.pending_action == {"id": "p1", "summary": "Pay 4,500"}


def test_claude_outage_gives_friendly_message(monkeypatch, engine_env):
    import anthropic
    import httpx2

    class Down:
        messages = None

        def __init__(self):
            self.messages = self

        def create(self, **_):
            raise anthropic.APIConnectionError(request=httpx2.Request("POST", "https://api.anthropic.com/v1/messages"))

    monkeypatch.setattr(engine, "get_client", lambda: Down())
    r = engine._run_turn(user("student"), "c1", "hello", None, None)
    assert r.reply == engine.UNAVAILABLE
    assert engine_env[-1]["content"][0]["text"] == engine.UNAVAILABLE


def test_history_never_starts_with_a_tool_result(monkeypatch):
    rows = [{"role": "user", "content": [{"type": "tool_result", "tool_use_id": "x", "content": "{}"}]},
            {"role": "assistant", "content": [{"type": "text", "text": "ok"}]},
            {"role": "user", "content": [{"type": "text", "text": "hi"}]}]

    class Q:
        def __getattr__(self, _):
            return lambda *a, **k: self

        def execute(self):
            return SimpleNamespace(data=list(reversed(rows)))

    monkeypatch.setattr(engine, "service_client", lambda: SimpleNamespace(table=lambda _: Q()))
    history = engine.load_history("c1")
    assert history[0] == {"role": "user", "content": [{"type": "text", "text": "hi"}]}
