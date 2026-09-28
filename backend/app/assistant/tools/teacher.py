"""Teacher tools (spec 13.4): attendance sessions and reports."""

from typing import Any

from app.assistant.registry import Tool, ToolContext, ToolError, ToolOutcome, register
from app.assistant.resolvers import all_courses, resolve_course
from app.assistant.tools._helpers import navigate, obj, refresh, s
from app.core.errors import AppError
from app.services import academic_service, attendance_service

TEACHER = ("teacher",)


def _my_course(ctx: ToolContext, query: str | None):
    courses = [c.model_dump() for c in academic_service.my_courses(ctx.user)]
    if not courses:
        raise ToolError("You are not assigned to any course yet.")
    if not query:
        if len(courses) == 1:
            return courses[0]
        raise ToolError("Which course?", [f"{c['code']} {c['title']}" for c in courses])
    return resolve_course(query, courses)


def _open_session(ctx: ToolContext, course_query: str | None):
    open_ = [x for x in attendance_service.list_sessions(ctx.user, limit=20) if x.status == "open"]
    if course_query:
        course = _my_course(ctx, course_query)
        match = [x for x in open_ if x.course.id == course["id"]]
        if not match:
            raise ToolError(f"There is no open attendance session for {course['code']}.")
        return match[0]
    if len(open_) == 1:
        return open_[0]
    if not open_:
        raise ToolError("You have no open attendance session.")
    raise ToolError("Which course's session?", [x.course.code for x in open_])


def _create_session(ctx: ToolContext, args: dict[str, Any]) -> ToolOutcome:
    course = _my_course(ctx, args.get("course"))
    minutes = int(args.get("duration_minutes") or 15)
    try:
        detail = attendance_service.create_session(ctx.user, course["id"], minutes, args.get("title"), via="voice")
    except AppError as exc:
        if exc.code == "session_already_open":
            existing = _open_session(ctx, course["code"])
            return ToolOutcome(data={"ok": False, "error": exc.message, "opened_existing_session": True},
                               ui_actions=[navigate(f"/teacher/attendance/{existing.id}")])
        raise
    return ToolOutcome(
        data={"ok": True, "course": detail.course.code, "class_code": detail.code, "class_code_spoken": " ".join(detail.code or ""),
              "open_for_minutes": minutes, "enrolled_students": detail.enrolled_count,
              "note": "The live session page with the big class code is now open."},
        ui_actions=[navigate(f"/teacher/attendance/{detail.id}"), refresh("attendance")],
    )


register(Tool(
    name="create_attendance_session",
    description="Start an attendance session for one of the teacher's courses (5-60 minutes, default 15). Returns the 6-digit class code and opens the live session page.",
    input_schema=obj({"course": s("Course code or title, e.g. 'CSC401' or 'software engineering'"),
                      "duration_minutes": {"type": "integer", "minimum": 5, "maximum": 60},
                      "title": s("Optional session title")}, ["course"]),
    roles=TEACHER, run=_create_session,
))


def _extend(ctx: ToolContext, args: dict[str, Any]) -> ToolOutcome:
    session = _open_session(ctx, args.get("course"))
    detail = attendance_service.extend_session(ctx.user, session.id, int(args.get("minutes") or 5), via="voice")
    return ToolOutcome(data={"ok": True, "course": detail.course.code, "minutes_left": round(detail.seconds_left / 60)},
                       ui_actions=[refresh("attendance")])


register(Tool(
    name="extend_attendance_session",
    description="Give an open attendance session more time.",
    input_schema=obj({"course": s("Course code or title; optional if only one session is open"),
                      "minutes": {"type": "integer", "minimum": 1, "maximum": 60}}, ["minutes"]),
    roles=TEACHER, run=_extend,
))


def _prepare_close(ctx: ToolContext, args: dict[str, Any]) -> tuple[str, dict[str, Any]]:
    session = _open_session(ctx, args.get("course"))
    summary = (f"Close the {session.course.code} attendance session now. {session.present_count} of "
               f"{session.enrolled_count} students are marked present; the rest will be recorded as absent.")
    return summary, {"session_id": session.id}


def _close(ctx: ToolContext, args: dict[str, Any]) -> ToolOutcome:
    detail = attendance_service.close_session(ctx.user, args["session_id"], via="voice")
    return ToolOutcome(data={"ok": True, "course": detail.course.code, "present": detail.present_count,
                             "enrolled": detail.enrolled_count}, ui_actions=[refresh("attendance")])


register(Tool(
    name="close_attendance_session",
    description="Close an open attendance session early. Needs the user's confirmation.",
    input_schema=obj({"course": s("Course code or title; optional if only one session is open")}),
    roles=TEACHER, run=_close, requires_confirmation=True, prepare=_prepare_close,
))


def _session_attendance(ctx: ToolContext, args: dict[str, Any]) -> ToolOutcome:
    sessions = attendance_service.list_sessions(ctx.user, limit=50)
    if args.get("course"):
        course = _my_course(ctx, args["course"])
        sessions = [x for x in sessions if x.course.id == course["id"]]
    target = next((x for x in sessions if x.status == "open"), sessions[0] if sessions else None)
    if target is None:
        return ToolOutcome(data={"ok": False, "error": "There are no attendance sessions yet."})
    d = attendance_service.get_session(ctx.user, target.id)
    return ToolOutcome(data={"course": d.course.code, "session": d.title, "status": d.status,
                             "present": d.present_count, "enrolled": d.enrolled_count,
                             "minutes_left": round(d.seconds_left / 60) if d.status == "open" else 0,
                             "present_names": [r.student.full_name for r in d.present],
                             "not_yet_marked": [p.full_name for p in d.absent]})


register(Tool(
    name="get_session_attendance",
    description="How many students are present in the current open session (or the most recent one), with names.",
    input_schema=obj({"course": s("Course code or title (optional)")}),
    roles=TEACHER, run=_session_attendance,
))


def _open_live(ctx: ToolContext, args: dict[str, Any]) -> ToolOutcome:
    session = _open_session(ctx, args.get("course"))
    return ToolOutcome(data={"ok": True, "opened": f"live session for {session.course.code}"},
                       ui_actions=[navigate(f"/teacher/attendance/{session.id}")])


register(Tool(
    name="open_live_session",
    description="Open the live attendance page (big class code, present list) for an open session.",
    input_schema=obj({"course": s("Course code or title (optional)")}),
    roles=TEACHER, run=_open_live,
))


# --------------------------------------------------------------------------- report (teacher + admin)

def _report(ctx: ToolContext, args: dict[str, Any]) -> ToolOutcome:
    if ctx.user.role == "teacher":
        course = _my_course(ctx, args.get("course"))
    else:
        course = resolve_course(args.get("course", ""), all_courses(active_only=False))
    report = attendance_service.attendance_report(ctx.user, course_id=course["id"])
    return ToolOutcome(data={
        "course": course["code"], "sessions_held": report.sessions_count, "threshold_percent": report.threshold,
        "students": [{"name": r.student.full_name, "percent": r.percent, "attended": r.attended, "sessions": r.total,
                      "below_threshold": r.low} for r in report.rows],
        "report_page_key": "teacher.reports" if ctx.user.role == "teacher" else "admin.reports.attendance",
    })


register(Tool(
    name="get_course_attendance_report",
    description="Each student's attendance percentage in a course, highlighting those below the threshold. You can then open the report page with navigate_to_page.",
    input_schema=obj({"course": s("Course code or title")}, ["course"]),
    roles=("teacher", "admin"), run=_report,
))
