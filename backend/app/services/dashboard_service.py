"""Role-specific dashboard numbers - used by GET /dashboard and by the assistant's
get_dashboard_summary / get_system_stats tools (one implementation for both)."""

from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from decimal import Decimal
from typing import Any

from app.core.config import get_settings
from app.core.security import CurrentUser
from app.db.supabase_client import service_client
from app.services import academic_service, attendance_service


# Each Supabase round trip costs ~0.3 s from the server, so independent reads run side
# by side (the shared HTTP client is thread-safe) instead of one after another.
_pool = ThreadPoolExecutor(max_workers=8, thread_name_prefix="aiu-dash")


def _parallel(**tasks: Callable[[], Any]) -> dict[str, Any]:
    """Run independent read-only calls concurrently; returns {name: result}. Errors propagate."""
    futures = {name: _pool.submit(fn) for name, fn in tasks.items()}
    return {name: f.result() for name, f in futures.items()}


def _count(table: str, **filters: Any) -> int:
    q = service_client().table(table).select("id", count="exact").limit(1)
    for k, v in filters.items():
        q = q.eq(k, v)
    return q.execute().count or 0


def _money_sum(rows: list[dict[str, Any]]) -> float:
    return float(sum(Decimal(str(r["amount"])) for r in rows))


def student_summary(user: CurrentUser) -> dict[str, Any]:
    r = _parallel(
        courses=lambda: academic_service.my_courses(user),
        open_sessions=lambda: attendance_service.open_sessions_for_student(user),
        attendance=lambda: attendance_service.my_attendance(user),
        unpaid=lambda: service_client().table("invoices").select("invoice_number, amount, due_date")
        .eq("student_id", user.id).eq("status", "unpaid").execute().data,
    )
    courses, open_sessions, attendance, unpaid = r["courses"], r["open_sessions"], r["attendance"], r["unpaid"]
    return {
        "role": "student",
        "courses": [{"code": c.code, "title": c.title} for c in courses],
        "open_attendance_sessions": [
            {"course": s.course.code, "title": s.title, "minutes_left": round(s.seconds_left / 60), "already_marked": s.marked}
            for s in open_sessions
        ],
        "attendance": [{"course_id": a.course.id, "course": a.course.code, "title": a.course.title, "percent": a.percent,
                        "attended": a.attended, "sessions": a.total, "below_threshold": a.low} for a in attendance],
        "attendance_threshold": get_settings().ATTENDANCE_LOW_THRESHOLD,
        "unpaid_invoices": len(unpaid),
        "outstanding_amount_usd": _money_sum(unpaid),
        "face_enrolled": bool(user.profile.get("face_enrolled")),
    }


def teacher_summary(user: CurrentUser) -> dict[str, Any]:
    r = _parallel(courses=lambda: academic_service.my_courses(user),
                  sessions=lambda: attendance_service.list_sessions(user, limit=20))
    courses, sessions = r["courses"], r["sessions"]
    open_ = [s for s in sessions if s.status == "open"]
    recent = [s for s in sessions if s.status == "closed"][:5]
    return {
        "role": "teacher",
        "courses": [{"id": c.id, "code": c.code, "title": c.title, "students": c.enrolled_count} for c in courses],
        "open_sessions": [{"id": s.id, "course": s.course.code, "course_title": s.course.title, "title": s.title,
                           "present": s.present_count, "enrolled": s.enrolled_count,
                           "closes_at": s.closes_at.isoformat(), "minutes_left": round(s.seconds_left / 60)} for s in open_],
        "recent_sessions": [{"id": s.id, "course": s.course.code, "title": s.title, "date": s.opens_at.isoformat(),
                             "present": s.present_count, "enrolled": s.enrolled_count,
                             "rate_percent": round(100 * s.present_count / s.enrolled_count, 1) if s.enrolled_count else None}
                            for s in recent],
    }


def _attendance_today() -> tuple[int, float | None]:
    """(sessions today, present / expected % across them)."""
    db = service_client()
    today = datetime.now(timezone.utc).date().isoformat()
    todays = db.table("attendance_sessions").select("id, course_id").gte("opens_at", today).execute().data
    if not todays:
        return 0, None
    # Sequential on purpose: this already runs inside the pool, and a pool task must never
    # wait on the same pool (enough concurrent requests would deadlock it).
    present = db.table("attendance_records").select("id", count="exact") \
        .in_("session_id", [s["id"] for s in todays]).limit(1).execute().count or 0
    course_ids = [s["course_id"] for s in todays]
    per_course = {cid: 0 for cid in course_ids}
    for e in db.table("enrollments").select("course_id").in_("course_id", list(per_course)).execute().data:
        per_course[e["course_id"]] += 1
    expected = sum(per_course[cid] for cid in course_ids)
    return len(todays), (round(100 * present / expected, 1) if expected else None)


def admin_summary() -> dict[str, Any]:
    db = service_client()
    r = _parallel(
        today=_attendance_today,
        unpaid=lambda: db.table("invoices").select("amount").eq("status", "unpaid").execute().data,
        paid=lambda: db.table("invoices").select("amount").eq("status", "paid").execute().data,
        students=lambda: _count("profiles", role="student"),
        teachers=lambda: _count("profiles", role="teacher"),
        admins=lambda: _count("profiles", role="admin"),
        courses=lambda: _count("courses", is_active=True),
        departments=lambda: _count("departments"),
        users_without_face=lambda: db.table("profiles").select("id", count="exact").eq("face_enrolled", False)
        .eq("is_active", True).limit(1).execute().count or 0,
        failed_emails=lambda: _count("email_logs", status="failed"),
    )
    sessions_today, rate_today = r["today"]
    return {
        "role": "admin",
        "students": r["students"],
        "teachers": r["teachers"],
        "admins": r["admins"],
        "courses": r["courses"],
        "departments": r["departments"],
        "users_without_face": r["users_without_face"],
        "attendance_sessions_today": sessions_today,
        "attendance_rate_today_percent": rate_today,
        "unpaid_invoices": len(r["unpaid"]),
        "unpaid_total_usd": _money_sum(r["unpaid"]),
        "paid_invoices": len(r["paid"]),
        "paid_total_usd": _money_sum(r["paid"]),
        "failed_emails": r["failed_emails"],
    }


def admin_dashboard() -> dict[str, Any]:
    """admin_summary() plus the short lists shown on the admin dashboard (spec 14.1)."""
    db = service_client()
    fields = "id, full_name, role, email, reg_number, created_at, face_enrolled"
    lists = {
        "recent_registrations": lambda: db.table("profiles").select(fields).neq("role", "admin")
        .order("created_at", desc=True).limit(6).execute().data,
        "users_without_face_list": lambda: db.table("profiles").select(fields).eq("face_enrolled", False)
        .eq("is_active", True).order("created_at", desc=True).limit(6).execute().data,
        "failed_email_list": lambda: db.table("email_logs").select("id, to_email, template, error, created_at, related_user_id")
        .eq("status", "failed").order("created_at", desc=True).limit(6).execute().data,
    }
    # Start the lists first, then build the summary in THIS thread (it fans out on the pool
    # itself - nesting it inside a pool task could deadlock under load).
    futures = {name: _pool.submit(fn) for name, fn in lists.items()}
    summary = admin_summary()
    summary.update({name: f.result() for name, f in futures.items()})
    summary["attendance_threshold"] = get_settings().ATTENDANCE_LOW_THRESHOLD
    return summary


def get_dashboard(user: CurrentUser) -> dict[str, Any]:
    if user.role == "student":
        return student_summary(user)
    if user.role == "teacher":
        return teacher_summary(user)
    return admin_dashboard()
