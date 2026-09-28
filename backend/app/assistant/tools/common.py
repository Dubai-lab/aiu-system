"""Tools available to every role (spec 13.4): pages, profile, dashboard, confirmation."""

from typing import Any

from app.assistant import pages, registry
from app.assistant.registry import Tool, ToolContext, ToolOutcome, register
from app.assistant.tools._helpers import ALL_ROLES, money, navigate, obj, s
from app.services import academic_service, dashboard_service, finance_service


def _norm(text: str) -> str:
    return " ".join("".join(ch.lower() if ch.isalnum() else " " for ch in text or "").split())


# --------------------------------------------------------------------------- navigate_to_page

def _navigate(ctx: ToolContext, args: dict[str, Any]) -> ToolOutcome:
    wanted = str(args.get("page_key") or "").strip()
    mine = pages.pages_for_role(ctx.user.role)
    page = next((p for p in mine if p["key"] == wanted), None)
    if page is None:  # allow a spoken name: title or alias
        q = _norm(wanted)
        page = next((p for p in mine if _norm(p["title"]) == q or q in [_norm(a) for a in p.get("aliases", [])]), None)
    available = [p["title"] for p in mine if not p.get("requires_params")]
    if page is None:
        return ToolOutcome(data={"found": False, "requested": wanted, "available_pages": available})
    if page.get("requires_params"):
        return ToolOutcome(data={"found": True, "ok": False,
                                 "error": f"'{page['title']}' is for one specific item. Use the matching tool "
                                          "(for example open_user_page, open_live_session or open_attendance_marking)."})
    return ToolOutcome(data={"found": True, "ok": True, "opened": page["title"]}, ui_actions=[navigate(page["path"])])


register(Tool(
    name="navigate_to_page",
    description=("Open a page of the system for the user. Use the page key from the page list in your instructions "
                 "(for example 'student.invoices'). If the user asks for a page that is not in the list, still call this "
                 "tool: it returns found=false and the pages that do exist, so you can tell the user the page does not exist."),
    input_schema=obj({"page_key": s("Page key from the page list, e.g. 'student.invoices'. Use the user's words if no key fits.")},
                     ["page_key"]),
    roles=ALL_ROLES, run=_navigate,
))


# --------------------------------------------------------------------------- profile / dashboard

def _profile(ctx: ToolContext, _: dict[str, Any]) -> ToolOutcome:
    p = ctx.user.profile
    return ToolOutcome(data={
        "full_name": p["full_name"], "role": p["role"], "email": p["email"], "registration_number": p.get("reg_number"),
        "title": p.get("staff_title"), "department": (p.get("department") or {}).get("name"), "level": p.get("level"),
        "face_enrolled": p["face_enrolled"], "still_using_default_password": p["must_change_password"],
    })


register(Tool(
    name="get_my_profile",
    description="The logged-in user's own details: name, role, department, registration number or email, whether their face is enrolled, and whether they still use the default password.",
    input_schema=obj({}), roles=ALL_ROLES, run=_profile,
))

register(Tool(
    name="get_dashboard_summary",
    description="The numbers on the user's dashboard (courses, open attendance, attendance percentages, unpaid invoices for students; courses and sessions for teachers; system totals for admins). Use it for 'how am I doing' style questions.",
    input_schema=obj({}), roles=ALL_ROLES,
    run=lambda ctx, _: ToolOutcome(data=dashboard_service.get_dashboard(ctx.user)),
))


# --------------------------------------------------------------------------- confirmation by voice

def _confirm(ctx: ToolContext, args: dict[str, Any]) -> ToolOutcome:
    decision = args.get("decision")
    if decision not in ("confirm", "cancel"):
        return ToolOutcome(data={"ok": False, "error": "decision must be 'confirm' or 'cancel'"})
    outcome = registry.resolve_pending(ctx, None, decision)
    outcome.data.setdefault("decision", decision)
    return outcome


register(Tool(
    name="confirm_pending_action",
    description=("Confirm or cancel the action that is waiting for the user's confirmation. Call it with 'confirm' only "
                 "when the user clearly agrees (e.g. 'yes', 'go ahead', 'confirm'); with 'cancel' when they decline. "
                 "The result tells you whether the action succeeded."),
    input_schema=obj({"decision": {"type": "string", "enum": ["confirm", "cancel"]}}, ["decision"]),
    roles=ALL_ROLES, run=_confirm,
))


# --------------------------------------------------------------------------- courses + fees (shared by two roles)

def _my_courses(ctx: ToolContext, _: dict[str, Any]) -> ToolOutcome:
    courses = academic_service.my_courses(ctx.user)
    return ToolOutcome(data={"courses": [
        {"code": c.code, "title": c.title, "credits": c.credits, "semester": c.semester, "department": c.department.name,
         **({"students": c.enrolled_count} if c.role == "teacher" else {"teacher": c.teacher.full_name if c.teacher else None})}
        for c in courses]})


register(Tool(
    name="list_my_courses",
    description="Courses the student is enrolled in, or the courses the teacher teaches.",
    input_schema=obj({}), roles=("student", "teacher"), run=_my_courses,
))


def _fees(ctx: ToolContext, _: dict[str, Any]) -> ToolOutcome:
    fees = finance_service.list_fee_types(include_inactive=False)
    return ToolOutcome(data={"fees": [{"name": f.name, "category": f.category, "amount": f.amount, "currency": f.currency,
                                       "amount_spoken": money(f.amount, f.currency)} for f in fees]})


register(Tool(
    name="list_fee_types",
    description="The official university fees and their amounts.",
    input_schema=obj({}), roles=("student", "admin"), run=_fees,
))
