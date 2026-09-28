"""Admin tools (spec 13.4): people, academics, fees and invoices, system stats."""

from datetime import date
from decimal import Decimal
from typing import Any

from app.assistant.registry import Tool, ToolContext, ToolError, ToolOutcome, register
from app.assistant.resolvers import all_courses, person_label, resolve_course, resolve_department, resolve_fee, \
    resolve_invoice, resolve_user
from app.assistant.tools._helpers import money, navigate, obj, refresh, s, validated
from app.db.supabase_client import service_client
from app.schemas.academics import AssignTeacherRequest, CourseIn, DepartmentIn
from app.schemas.finance import FeeTypeIn, FeeTypeUpdate
from app.schemas.users import RegisterStaffRequest, RegisterStudentRequest
from app.services import academic_service, dashboard_service, finance_service, user_service

ADMIN = ("admin",)


def _ensure_email_free(email: str) -> None:
    taken = service_client().table("profiles").select("id").eq("email", email).limit(1).execute().data
    if taken:
        raise ToolError(f"A user with the email {email} already exists.")


# --------------------------------------------------------------------------- register users (confirm)

def _prepare_register_student(ctx: ToolContext, args: dict[str, Any]) -> tuple[str, dict[str, Any]]:
    dept = resolve_department(args.get("department", ""))
    data = validated(RegisterStudentRequest, full_name=args.get("full_name"), email=args.get("email"),
                     phone=args.get("phone"), department_id=dept["id"], level=args.get("level"),
                     intake_year=args.get("intake_year") or date.today().year)
    _ensure_email_free(data.email)
    summary = (f"Register student {data.full_name} ({data.email}), {dept['name']}, level {data.level}, "
               f"intake {data.intake_year}. A registration number and a default password will be emailed to them.")
    return summary, data.model_dump(mode="json")


def _register_student(ctx: ToolContext, args: dict[str, Any]) -> ToolOutcome:
    user = user_service.register_user(ctx.user, "student", RegisterStudentRequest(**args), via="voice")
    return ToolOutcome(
        data={"ok": True, "full_name": user.full_name, "registration_number": user.reg_number,
              "login_details_emailed_to": user.email, "face_enrolled": False,
              "next_step": "Offer to open face enrollment for this student (open_face_enrollment)."},
        ui_actions=[refresh("users")],
    )


register(Tool(
    name="register_student",
    description=("Register a new student. Needs full name, email, department and level (100-400); intake year defaults "
                 "to this year. Convert spoken emails ('john at example dot com') to john@example.com. Ask for anything "
                 "missing one question at a time. Needs the user's confirmation."),
    input_schema=obj({"full_name": s("Student's full name"), "email": s("Email address"),
                      "department": s("Department name or code, e.g. 'Computer Science' or 'CSC'"),
                      "level": {"type": "integer", "enum": [100, 200, 300, 400]},
                      "intake_year": {"type": "integer"}, "phone": s("Optional phone number")},
                     ["full_name", "email", "department", "level"]),
    roles=ADMIN, run=_register_student, requires_confirmation=True, prepare=_prepare_register_student,
))


def _prepare_register_teacher(ctx: ToolContext, args: dict[str, Any]) -> tuple[str, dict[str, Any]]:
    dept = resolve_department(args.get("department", ""))
    data = validated(RegisterStaffRequest, full_name=args.get("full_name"), email=args.get("email"),
                     phone=args.get("phone"), department_id=dept["id"], staff_title=args.get("staff_title"))
    _ensure_email_free(data.email)
    title = f", {data.staff_title}" if data.staff_title else ""
    return (f"Register teacher {data.full_name} ({data.email}){title}, {dept['name']}. "
            "Login details will be emailed to them."), data.model_dump(mode="json")


def _register_teacher(ctx: ToolContext, args: dict[str, Any]) -> ToolOutcome:
    user = user_service.register_user(ctx.user, "teacher", RegisterStaffRequest(**args), via="voice")
    return ToolOutcome(data={"ok": True, "full_name": user.full_name, "login_email": user.email,
                             "login_details_emailed_to": user.email,
                             "next_step": "Offer to open face enrollment for this teacher."},
                       ui_actions=[refresh("users")])


register(Tool(
    name="register_teacher",
    description="Register a new teacher (full name, email, department, optional title). Needs the user's confirmation.",
    input_schema=obj({"full_name": s("Teacher's full name"), "email": s("Email address"),
                      "department": s("Department name or code"), "staff_title": s("Optional, e.g. 'Senior Lecturer'"),
                      "phone": s("Optional phone number")}, ["full_name", "email", "department"]),
    roles=ADMIN, run=_register_teacher, requires_confirmation=True, prepare=_prepare_register_teacher,
))


# --------------------------------------------------------------------------- people: find / open pages

def _search(ctx: ToolContext, args: dict[str, Any]) -> ToolOutcome:
    role = args.get("role") if args.get("role") in ("student", "teacher", "admin") else None
    result = user_service.list_users(role=role, search=args.get("query", ""), page_size=10)
    return ToolOutcome(data={"total": result.total, "users": [
        {"name": u.full_name, "role": u.role, "email": u.email, "registration_number": u.reg_number,
         "department": u.department_code, "active": u.is_active, "face_enrolled": u.face_enrolled} for u in result.items]})


register(Tool(
    name="search_users",
    description="Find users by name, email or registration number, optionally only students, teachers or admins.",
    input_schema=obj({"query": s("Name, email or registration number"),
                      "role": {"type": "string", "enum": ["student", "teacher", "admin"]}}, ["query"]),
    roles=ADMIN, run=_search,
))


def _open_user(ctx: ToolContext, args: dict[str, Any]) -> ToolOutcome:
    u = resolve_user(args.get("user", ""))
    return ToolOutcome(data={"ok": True, "opened": f"{u['full_name']}'s page"}, ui_actions=[navigate(f"/admin/users/{u['id']}")])


register(Tool(
    name="open_user_page",
    description="Open a user's detail page (profile, face status, password reset, deactivate).",
    input_schema=obj({"user": s("Name, email or registration number")}, ["user"]),
    roles=ADMIN, run=_open_user,
))


def _open_face(ctx: ToolContext, args: dict[str, Any]) -> ToolOutcome:
    u = resolve_user(args.get("user", ""))
    if not u["is_active"]:
        raise ToolError(f"{u['full_name']}'s account is deactivated. Reactivate it first.")
    return ToolOutcome(
        data={"ok": True, "opened": f"face enrollment for {u['full_name']}",
              "note": "The person must be at this computer; tick consent, then follow the five camera prompts."},
        ui_actions=[navigate(f"/admin/users/{u['id']}/face-enrollment")])


register(Tool(
    name="open_face_enrollment",
    description="Open the face enrollment page for a user. Face enrollment itself needs the camera, so it is never done by voice.",
    input_schema=obj({"user": s("Name, email or registration number")}, ["user"]),
    roles=ADMIN, run=_open_face,
))


def _resend(ctx: ToolContext, args: dict[str, Any]) -> ToolOutcome:
    u = resolve_user(args.get("user", ""))
    user_service.resend_credentials(ctx.user, u["id"], via="voice")
    return ToolOutcome(data={"ok": True, "emailed_to": u["email"], "name": u["full_name"]}, ui_actions=[refresh("users")])


register(Tool(
    name="resend_credentials_email",
    description="Re-send a user's login details email with a fresh default password (only while they still use their default password). The password is never spoken.",
    input_schema=obj({"user": s("Name, email or registration number")}, ["user"]),
    roles=ADMIN, run=_resend,
))


def _account_tool(action: str):
    def prepare(ctx: ToolContext, args: dict[str, Any]) -> tuple[str, dict[str, Any]]:
        u = resolve_user(args.get("user", ""))
        if action == "deactivate" and u["id"] == ctx.user.id:
            raise ToolError("You cannot deactivate your own account.")
        text = {
            "deactivate": f"Deactivate {person_label(u)}. They will be logged out and unable to log in until reactivated.",
            "reactivate": f"Reactivate {person_label(u)} so they can log in again.",
            "reset": f"Reset the password of {person_label(u)}. A new default password will be emailed to {u['email']}.",
        }[action]
        return text, {"user_id": u["id"]}

    def run(ctx: ToolContext, args: dict[str, Any]) -> ToolOutcome:
        if action == "reset":
            detail = user_service.reset_password(ctx.user, args["user_id"], via="voice")
            data = {"ok": True, "name": detail.full_name, "new_password_emailed_to": detail.email}
        else:
            detail = user_service.set_active(ctx.user, args["user_id"], action == "reactivate", via="voice")
            data = {"ok": True, "name": detail.full_name, "active": detail.is_active}
        return ToolOutcome(data=data, ui_actions=[refresh("users")])

    return prepare, run


for _name, _action, _desc in (
    ("deactivate_user", "deactivate", "Deactivate a user's account (blocks login). Needs confirmation."),
    ("reactivate_user", "reactivate", "Reactivate a deactivated account. Needs confirmation."),
    ("reset_user_password", "reset", "Email a user a new default password (never spoken). Needs confirmation."),
):
    _prep, _run = _account_tool(_action)
    register(Tool(name=_name, description=_desc, input_schema=obj({"user": s("Name, email or registration number")}, ["user"]),
                  roles=ADMIN, run=_run, requires_confirmation=True, prepare=_prep))


# --------------------------------------------------------------------------- academics

def _create_department(ctx: ToolContext, args: dict[str, Any]) -> ToolOutcome:
    data = validated(DepartmentIn, name=args.get("name"), code=args.get("code"))
    d = academic_service.create_department(ctx.user, data, via="voice")
    return ToolOutcome(data={"ok": True, "name": d.name, "code": d.code}, ui_actions=[refresh("departments")])


register(Tool(
    name="create_department",
    description="Create an academic department with a name and a 2-6 letter code (e.g. 'Law', 'LAW').",
    input_schema=obj({"name": s("Department name"), "code": s("2-6 letters")}, ["name", "code"]),
    roles=ADMIN, run=_create_department,
))


def _create_course(ctx: ToolContext, args: dict[str, Any]) -> ToolOutcome:
    dept = resolve_department(args.get("department", ""))
    data = validated(CourseIn, code=args.get("code"), title=args.get("title"), department_id=dept["id"],
                     credits=args.get("credits") or 3, semester=args.get("semester") or 1)
    c = academic_service.create_course(ctx.user, data, via="voice")
    return ToolOutcome(data={"ok": True, "code": c.code, "title": c.title, "department": dept["name"],
                             "next_step": "Offer to assign a teacher and enroll students."},
                       ui_actions=[refresh("courses", "departments")])


register(Tool(
    name="create_course",
    description="Create a course (code like CSC450, title, department; credits default 3, semester default 1).",
    input_schema=obj({"code": s("e.g. CSC450"), "title": s("Course title"), "department": s("Department name or code"),
                      "credits": {"type": "integer", "minimum": 1, "maximum": 10},
                      "semester": {"type": "integer", "minimum": 1, "maximum": 3}}, ["code", "title", "department"]),
    roles=ADMIN, run=_create_course,
))


def _assign_teacher(ctx: ToolContext, args: dict[str, Any]) -> ToolOutcome:
    course = resolve_course(args.get("course", ""), all_courses())
    teacher = resolve_user(args.get("teacher", ""), role="teacher")
    c = academic_service.assign_teacher(ctx.user, course["id"], AssignTeacherRequest(teacher_id=teacher["id"]), via="voice")
    return ToolOutcome(data={"ok": True, "course": c.code, "teacher": c.teacher.full_name if c.teacher else None},
                       ui_actions=[refresh("courses", "my-courses")])


register(Tool(
    name="assign_teacher",
    description="Assign a teacher to a course (replaces the current teacher).",
    input_schema=obj({"course": s("Course code or title"), "teacher": s("Teacher's name or email")}, ["course", "teacher"]),
    roles=ADMIN, run=_assign_teacher,
))


def _enroll(ctx: ToolContext, args: dict[str, Any]) -> ToolOutcome:
    course = resolve_course(args.get("course", ""), all_courses())
    student = resolve_user(args.get("student", ""), role="student")
    r = academic_service.enroll_students(ctx.user, course["id"], [student["id"]], via="voice")
    return ToolOutcome(data={"ok": True, "course": r.course.code, "student": student["full_name"],
                             "already_enrolled": r.already_enrolled == 1, "students_now_enrolled": r.course.enrolled_count},
                       ui_actions=[refresh("courses", "my-courses", "users")])


register(Tool(
    name="enroll_student",
    description="Enroll one student in a course.",
    input_schema=obj({"student": s("Student's name, email or registration number"), "course": s("Course code or title")},
                     ["student", "course"]),
    roles=ADMIN, run=_enroll,
))


# --------------------------------------------------------------------------- fees and invoices (confirm)

def _all_fees() -> list[dict[str, Any]]:
    return [f.model_dump() for f in finance_service.list_fee_types(include_inactive=True)]


def _prepare_fee_create(ctx: ToolContext, args: dict[str, Any]) -> tuple[str, dict[str, Any]]:
    data = validated(FeeTypeIn, name=args.get("name"), category=args.get("category"), amount=args.get("amount"))
    return f"Create the fee '{data.name}' ({data.category.replace('_', ' ')}) at {money(float(data.amount))}.", \
        data.model_dump(mode="json")


def _fee_create(ctx: ToolContext, args: dict[str, Any]) -> ToolOutcome:
    f = finance_service.create_fee_type(ctx.user, FeeTypeIn(**args), via="voice")
    return ToolOutcome(data={"ok": True, "name": f.name, "amount_spoken": money(f.amount, f.currency)},
                       ui_actions=[refresh("finance")])


register(Tool(
    name="create_fee_type",
    description="Create an official fee. Category: tuition, medical_insurance, registration or other. Needs confirmation.",
    input_schema=obj({"name": s("Fee name"), "category": {"type": "string", "enum": ["tuition", "medical_insurance", "registration", "other"]},
                      "amount": {"type": "number", "description": "Amount in US dollars"}}, ["name", "category", "amount"]),
    roles=ADMIN, run=_fee_create, requires_confirmation=True, prepare=_prepare_fee_create,
))


def _prepare_fee_amount(ctx: ToolContext, args: dict[str, Any]) -> tuple[str, dict[str, Any]]:
    fee = resolve_fee(args.get("fee", ""), _all_fees())
    data = validated(FeeTypeUpdate, amount=args.get("amount"))
    return (f"Change {fee['name']} from {money(float(fee['amount']))} to {money(float(data.amount))}. "
            "Existing invoices keep their amount; new invoices use the new one."), \
        {"fee_type_id": fee["id"], "amount": str(data.amount)}


def _fee_amount(ctx: ToolContext, args: dict[str, Any]) -> ToolOutcome:
    f = finance_service.update_fee_type(ctx.user, args["fee_type_id"], FeeTypeUpdate(amount=Decimal(args["amount"])), via="voice")
    return ToolOutcome(data={"ok": True, "fee": f.name, "new_amount_spoken": money(f.amount, f.currency)},
                       ui_actions=[refresh("finance")])


register(Tool(
    name="update_fee_amount",
    description="Change the official amount of a fee (e.g. 'change tuition to 4,800'). Needs confirmation.",
    input_schema=obj({"fee": s("Fee name or type, e.g. 'tuition'"), "amount": {"type": "number"}}, ["fee", "amount"]),
    roles=ADMIN, run=_fee_amount, requires_confirmation=True, prepare=_prepare_fee_amount,
))


def _prepare_invoice_for(ctx: ToolContext, args: dict[str, Any]) -> tuple[str, dict[str, Any]]:
    student = resolve_user(args.get("student", ""), role="student")
    fee = resolve_fee(args.get("fee", ""), [f for f in _all_fees() if f["is_active"]])
    return (f"Create an invoice for {person_label(student)}: {fee['name']}, {money(float(fee['amount']))}. "
            "They will be emailed."), {"student_id": student["id"], "fee_type_id": fee["id"]}


def _invoice_for(ctx: ToolContext, args: dict[str, Any]) -> ToolOutcome:
    r = finance_service.create_invoice(ctx.user, args["fee_type_id"], student_id=args["student_id"], via="voice")
    return ToolOutcome(data={"ok": True, "created": r.created, "message": r.message}, ui_actions=[refresh("finance")])


register(Tool(
    name="create_invoice_for_student",
    description="Create an invoice for a student from an official fee. Needs confirmation.",
    input_schema=obj({"student": s("Student's name, email or registration number"), "fee": s("Fee name or type")},
                     ["student", "fee"]),
    roles=ADMIN, run=_invoice_for, requires_confirmation=True, prepare=_prepare_invoice_for,
))


def _prepare_cancel(ctx: ToolContext, args: dict[str, Any]) -> tuple[str, dict[str, Any]]:
    number = (args.get("invoice_number") or "").strip()
    reason = " ".join((args.get("reason") or "").split())
    if len(reason) < 3:
        raise ToolError("Please give a reason for cancelling the invoice.")
    found = finance_service.list_invoices(ctx.user, search=number, page_size=20).items if number else []
    inv = resolve_invoice(number, [i.model_dump(mode="json") for i in found], only_unpaid=True)
    return (f"Cancel invoice {inv['invoice_number']} ({inv['fee_type']['name']}, {money(inv['amount'])}) for "
            f"{inv['student']['full_name']}. Reason: {reason}."), {"invoice_id": inv["id"], "reason": reason}


def _cancel(ctx: ToolContext, args: dict[str, Any]) -> ToolOutcome:
    inv = finance_service.cancel_invoice(ctx.user, args["invoice_id"], args["reason"], via="voice")
    return ToolOutcome(data={"ok": True, "invoice_number": inv.invoice_number, "status": inv.status},
                       ui_actions=[refresh("finance")])


register(Tool(
    name="cancel_invoice",
    description="Cancel an unpaid invoice (needs a reason). Needs confirmation.",
    input_schema=obj({"invoice_number": s("e.g. INV-2026-000142"), "reason": s("Why it is being cancelled")},
                     ["invoice_number", "reason"]),
    roles=ADMIN, run=_cancel, requires_confirmation=True, prepare=_prepare_cancel,
))


# --------------------------------------------------------------------------- stats

register(Tool(
    name="get_system_stats",
    description="System totals: students, teachers, courses, today's attendance, unpaid and paid invoice totals, failed emails.",
    input_schema=obj({}), roles=ADMIN,
    run=lambda ctx, _: ToolOutcome(data=dashboard_service.admin_summary()),
))

