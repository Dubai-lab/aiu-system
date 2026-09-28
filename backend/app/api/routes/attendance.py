"""Attendance (spec 11 + section 15).

Teachers: create / extend / regenerate code / close sessions, live detail, manual marks.
Students: open sessions, verify class code, liveness challenge, face-verified marking.
Reports: teachers (own courses) and admins (all), JSON or CSV.
"""

from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Query, Request
from fastapi.responses import Response

from app.core.security import CurrentUser, StudentDep, TeacherDep, client_ip, require_roles
from app.schemas.attendance import (
    AttendanceReport,
    CourseAttendance,
    CreateSessionRequest,
    ManualMarkRequest,
    MarkRequest,
    MarkResult,
    SessionDetail,
    SessionOut,
    StudentSessionOut,
    UpdateSessionRequest,
    VerifyCodeRequest,
)
from app.schemas.face import ChallengeOut
from app.services import attendance_service

router = APIRouter(tags=["attendance"])
TeacherOrAdmin = Annotated[CurrentUser, Depends(require_roles("teacher", "admin"))]


# ------------------------------------------------------------------ teacher
@router.post("/attendance/sessions", response_model=SessionDetail, status_code=201)
def create_session(body: CreateSessionRequest, teacher: TeacherDep, request: Request) -> SessionDetail:
    return attendance_service.create_session(teacher, body.course_id, body.duration_minutes, body.title,
                                             ip=client_ip(request))


@router.get("/attendance/sessions", response_model=list[SessionOut])
def list_sessions(teacher: TeacherDep, course_id: str | None = None) -> list[SessionOut]:
    return attendance_service.list_sessions(teacher, course_id)


@router.get("/attendance/sessions/{session_id}", response_model=SessionDetail)
def get_session(session_id: str, viewer: TeacherOrAdmin) -> SessionDetail:
    """Live detail: class code, present list and not-yet-marked list (owning teacher or admin)."""
    return attendance_service.get_session(viewer, session_id)


@router.patch("/attendance/sessions/{session_id}", response_model=SessionDetail)
def update_session(session_id: str, body: UpdateSessionRequest, teacher: TeacherDep, request: Request) -> SessionDetail:
    ip = client_ip(request)
    if body.action == "extend":
        return attendance_service.extend_session(teacher, session_id, body.minutes or 5, ip=ip)
    if body.action == "regenerate_code":
        return attendance_service.regenerate_code(teacher, session_id, ip=ip)
    return attendance_service.close_session(teacher, session_id, ip=ip)


@router.post("/attendance/sessions/{session_id}/manual-mark", response_model=SessionDetail)
def manual_mark(session_id: str, body: ManualMarkRequest, teacher: TeacherDep, request: Request) -> SessionDetail:
    return attendance_service.manual_mark(teacher, session_id, body.student_id, body.reason, ip=client_ip(request))


# ------------------------------------------------------------------ student
@router.get("/attendance/open", response_model=list[StudentSessionOut])
def open_sessions(student: StudentDep) -> list[StudentSessionOut]:
    return attendance_service.open_sessions_for_student(student)


@router.get("/attendance/student-sessions/{session_id}", response_model=StudentSessionOut)
def student_session(session_id: str, student: StudentDep) -> StudentSessionOut:
    return attendance_service.get_student_session(student, session_id)


@router.post("/attendance/sessions/{session_id}/verify-code")
def verify_code(session_id: str, body: VerifyCodeRequest, student: StudentDep) -> dict[str, bool]:
    return attendance_service.verify_code(student, session_id, body.code)


@router.post("/attendance/challenge", response_model=ChallengeOut)
def attendance_challenge(student: StudentDep, request: Request) -> ChallengeOut:
    return attendance_service.create_attendance_challenge(student, ip=client_ip(request))


@router.post("/attendance/sessions/{session_id}/mark", response_model=MarkResult)
def mark(session_id: str, body: MarkRequest, student: StudentDep, request: Request) -> MarkResult:
    return attendance_service.mark_attendance(student, session_id, body.code, body.challenge_id, body.frames,
                                              ip=client_ip(request))


@router.get("/attendance/me", response_model=list[CourseAttendance])
def my_attendance(student: StudentDep) -> list[CourseAttendance]:
    return attendance_service.my_attendance(student)


# ------------------------------------------------------------------ reports
@router.get("/reports/attendance", response_model=AttendanceReport)
def attendance_report(
    viewer: TeacherOrAdmin,
    course_id: str | None = None,
    department_id: str | None = None,
    date_from: str | None = Query(default=None, pattern=r"^\d{4}-\d{2}-\d{2}$"),
    date_to: str | None = Query(default=None, pattern=r"^\d{4}-\d{2}-\d{2}$"),
    format: Literal["json", "csv"] = "json",
):
    """Per student and course: sessions attended / held and percentage (?format=csv to download)."""
    report = attendance_service.attendance_report(viewer, course_id=course_id, department_id=department_id,
                                                  date_from=date_from, date_to=date_to)
    if format == "csv":
        return Response(content=attendance_service.report_csv(report), media_type="text/csv",
                        headers={"Content-Disposition": 'attachment; filename="attendance-report.csv"'})
    return report
