"""Attendance sessions, face-verified marking and reports (spec section 11).

Every rule lives here once; REST routes and (Phase 9) voice tools call these.
Sessions close automatically: every read first closes sessions whose time is up
(check-on-read), which also pushes the change to students through Realtime.
"""

import logging
from datetime import date, datetime, timedelta, timezone
from typing import Any, Literal

from fastapi import status

from app.core.config import get_settings
from app.core.errors import AppError
from app.core.security import CurrentUser
from app.db.supabase_client import service_client
from app.schemas.academics import PersonRef
from app.schemas.attendance import (
    AttendanceReport,
    CourseAttendance,
    CourseRef,
    HistoryItem,
    MarkResult,
    RecordOut,
    ReportRow,
    SessionDetail,
    SessionOut,
    StudentSessionOut,
)
from app.schemas.face import ChallengeOut, FrameIn
from app.services import audit_service, face_auth_service, rate_limit_service
from app.services.attendance_rules import counts_for_student, is_low, new_class_code, percent
from app.services.face_checks import FaceCheckError, as_unit_vector, to_pgvector
from app.services.user_service import is_valid_uuid

logger = logging.getLogger(__name__)

Via = Literal["ui", "voice", "system"]
SESSION_SELECT = ("id, course_id, teacher_id, title, opens_at, closes_at, status, created_via, created_at,"
                  " course:courses(id, code, title)")
PERSON_FIELDS = "id, full_name, email, reg_number, staff_title, level, is_active"
CODE_BUCKET = "class_code"
CODE_LIMIT = 5                       # wrong codes per student per session
CODE_WINDOW = 24 * 3600              # effectively "for the life of the session"
MAX_SESSION_MINUTES = 180            # extensions can never keep a session open longer than this


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _ts(value: str | datetime) -> datetime:
    return value if isinstance(value, datetime) else datetime.fromisoformat(value)


def _not_found() -> AppError:
    return AppError("not_found", "Attendance session not found.", status.HTTP_404_NOT_FOUND)


def _seconds_left(row: dict[str, Any]) -> int:
    if row["status"] != "open":
        return 0
    return max(0, int((_ts(row["closes_at"]) - _now()).total_seconds()))


# --------------------------------------------------------------------------- auto-close

def close_expired_sessions() -> int:
    """Close every open session whose time is up (runs before every read)."""
    rows = service_client().table("attendance_sessions").update({"status": "closed"}) \
        .eq("status", "open").lt("closes_at", _now().isoformat()).execute().data
    return len(rows)


# --------------------------------------------------------------------------- loading helpers

def _get_session_row(session_id: str) -> dict[str, Any]:
    if not is_valid_uuid(session_id):
        raise _not_found()
    r = service_client().table("attendance_sessions").select(SESSION_SELECT).eq("id", session_id).maybe_single().execute()
    if not r or not r.data:
        raise _not_found()
    return r.data


def _own_session(teacher: CurrentUser, session_id: str) -> dict[str, Any]:
    """Teachers may only act on sessions they own (admins may view any)."""
    close_expired_sessions()
    row = _get_session_row(session_id)
    if teacher.role != "admin" and row["teacher_id"] != teacher.id:
        raise _not_found()  # do not reveal other teachers' sessions
    return row


def _enrolled(course_id: str) -> list[dict[str, Any]]:
    """[{student: {...}, created_at}] for a course."""
    return service_client().table("enrollments").select(f"created_at, student:profiles({PERSON_FIELDS})") \
        .eq("course_id", course_id).execute().data


def _records(session_ids: list[str]) -> list[dict[str, Any]]:
    if not session_ids:
        return []
    return service_client().table("attendance_records").select(
        "session_id, student_id, marked_at, method, similarity, manual_reason,"
        f" student:profiles!attendance_records_student_id_fkey({PERSON_FIELDS})"
    ).in_("session_id", session_ids).execute().data


def _code_for(session_id: str) -> str | None:
    r = service_client().table("attendance_session_codes").select("code").eq("session_id", session_id).maybe_single().execute()
    return r.data["code"] if r and r.data else None


def _session_out(row: dict[str, Any], present: int, enrolled: int) -> dict[str, Any]:
    return {**row, "seconds_left": _seconds_left(row), "present_count": present, "enrolled_count": enrolled}


def _detail(row: dict[str, Any], *, with_code: bool) -> SessionDetail:
    enrolled = [e["student"] for e in _enrolled(row["course_id"]) if e.get("student")]
    records = _records([row["id"]])
    present_ids = {r["student_id"] for r in records}
    present = sorted((RecordOut.model_validate(r) for r in records if r.get("student")), key=lambda r: r.marked_at)
    absent = sorted((PersonRef.model_validate(s) for s in enrolled if s["id"] not in present_ids),
                    key=lambda p: p.full_name.lower())
    return SessionDetail.model_validate({
        **_session_out(row, len(present_ids), len(enrolled)),
        "code": _code_for(row["id"]) if with_code else None,
        "present": present,
        "absent": absent,
    })


# --------------------------------------------------------------------------- teacher: sessions

def create_session(teacher: CurrentUser, course_id: str, duration_minutes: int = 15, title: str | None = None,
                   *, via: Via = "ui", ip: str | None = None) -> SessionDetail:
    if not 5 <= duration_minutes <= 60:
        raise AppError("bad_duration", "The duration must be between 5 and 60 minutes.")
    if not is_valid_uuid(course_id):
        raise AppError("course_not_found", "Course not found.", status.HTTP_404_NOT_FOUND)
    db = service_client()
    course = db.table("courses").select("id, code, title, teacher_id, is_active").eq("id", course_id).maybe_single().execute()
    course = course.data if course else None
    if not course or course["teacher_id"] != teacher.id:
        raise AppError("course_not_found", "You can only start attendance for a course you teach.", status.HTTP_404_NOT_FOUND)
    if not course["is_active"]:
        raise AppError("course_inactive", f"{course['code']} is deactivated.")

    close_expired_sessions()
    existing = db.table("attendance_sessions").select("id, closes_at").eq("course_id", course_id).eq("status", "open") \
        .limit(1).execute().data
    if existing:
        raise AppError("session_already_open", f"An attendance session for {course['code']} is already open.",
                       status.HTTP_409_CONFLICT)

    now = _now()
    title = title or f"Lecture - {now.strftime('%d %b %Y')}"
    try:
        row = db.table("attendance_sessions").insert({
            "course_id": course_id, "teacher_id": teacher.id, "title": title,
            "opens_at": now.isoformat(), "closes_at": (now + timedelta(minutes=duration_minutes)).isoformat(),
            "status": "open", "created_via": via,
        }).execute().data[0]
    except Exception as exc:  # noqa: BLE001 - the one-open-session unique index can race
        if "attendance_sessions_one_open_per_course" in str(exc):
            raise AppError("session_already_open", f"An attendance session for {course['code']} is already open.",
                           status.HTTP_409_CONFLICT) from exc
        raise
    db.table("attendance_session_codes").insert({"session_id": row["id"], "code": new_class_code()}).execute()
    audit_service.log("attendance.session_create", actor_id=teacher.id, entity="attendance_session", entity_id=row["id"],
                      details={"course": course["code"], "duration_minutes": duration_minutes}, via=via, ip=ip)
    return get_session(teacher, row["id"])


def get_session(viewer: CurrentUser, session_id: str) -> SessionDetail:
    row = _own_session(viewer, session_id)
    return _detail(row, with_code=True)


def extend_session(teacher: CurrentUser, session_id: str, minutes: int, *, via: Via = "ui",
                   ip: str | None = None) -> SessionDetail:
    row = _own_session(teacher, session_id)
    if row["status"] != "open":
        raise AppError("session_closed", "This session is already closed.")
    if not 1 <= minutes <= 60:
        raise AppError("bad_minutes", "Extend by 1 to 60 minutes.")
    new_close = _ts(row["closes_at"]) + timedelta(minutes=minutes)
    if new_close - _ts(row["opens_at"]) > timedelta(minutes=MAX_SESSION_MINUTES):
        raise AppError("too_long", f"A session cannot run longer than {MAX_SESSION_MINUTES // 60} hours.")
    service_client().table("attendance_sessions").update({"closes_at": new_close.isoformat()}).eq("id", session_id).execute()
    audit_service.log("attendance.session_extend", actor_id=teacher.id, entity="attendance_session", entity_id=session_id,
                      details={"minutes": minutes, "course": row["course"]["code"]}, via=via, ip=ip)
    return get_session(teacher, session_id)


def regenerate_code(teacher: CurrentUser, session_id: str, *, via: Via = "ui", ip: str | None = None) -> SessionDetail:
    row = _own_session(teacher, session_id)
    if row["status"] != "open":
        raise AppError("session_closed", "This session is already closed.")
    old = _code_for(session_id)
    code = new_class_code()
    while code == old:
        code = new_class_code()
    service_client().table("attendance_session_codes").update({"code": code}).eq("session_id", session_id).execute()
    audit_service.log("attendance.code_regenerate", actor_id=teacher.id, entity="attendance_session", entity_id=session_id,
                      details={"course": row["course"]["code"]}, via=via, ip=ip)
    return get_session(teacher, session_id)


def close_session(teacher: CurrentUser, session_id: str, *, via: Via = "ui", ip: str | None = None) -> SessionDetail:
    row = _own_session(teacher, session_id)
    if row["status"] == "open":
        service_client().table("attendance_sessions").update({"status": "closed", "closes_at": _now().isoformat()}) \
            .eq("id", session_id).execute()
        audit_service.log("attendance.session_close", actor_id=teacher.id, entity="attendance_session",
                          entity_id=session_id, details={"course": row["course"]["code"]}, via=via, ip=ip)
    return get_session(teacher, session_id)


def manual_mark(teacher: CurrentUser, session_id: str, student_id: str, reason: str, *, via: Via = "ui",
                ip: str | None = None) -> SessionDetail:
    """Mark a student present without the face check (e.g. camera broken). Always audited."""
    row = _own_session(teacher, session_id)
    if not is_valid_uuid(student_id) or not any(
        e["student"] and e["student"]["id"] == student_id for e in _enrolled(row["course_id"])
    ):
        raise AppError("not_enrolled", "That student is not enrolled in this course.")
    db = service_client()
    if db.table("attendance_records").select("id").eq("session_id", session_id).eq("student_id", student_id).execute().data:
        raise AppError("already_marked", "This student is already marked present.", status.HTTP_409_CONFLICT)
    db.table("attendance_records").insert({
        "session_id": session_id, "student_id": student_id, "method": "manual", "liveness_passed": False,
        "manual_reason": reason, "marked_by": teacher.id,
    }).execute()
    audit_service.log("attendance.manual_mark", actor_id=teacher.id, entity="attendance_session", entity_id=session_id,
                      details={"student_id": student_id, "reason": reason, "course": row["course"]["code"]}, via=via, ip=ip)
    return get_session(teacher, session_id)


def list_sessions(teacher: CurrentUser, course_id: str | None = None, limit: int = 100) -> list[SessionOut]:
    """A teacher's sessions (newest first) with present / enrolled counts."""
    close_expired_sessions()
    q = service_client().table("attendance_sessions").select(SESSION_SELECT).eq("teacher_id", teacher.id)
    if course_id and is_valid_uuid(course_id):
        q = q.eq("course_id", course_id)
    rows = q.order("opens_at", desc=True).limit(limit).execute().data
    if not rows:
        return []
    present: dict[str, int] = {}
    for r in service_client().table("attendance_records").select("session_id").in_("session_id", [s["id"] for s in rows]).execute().data:
        present[r["session_id"]] = present.get(r["session_id"], 0) + 1
    course_ids = list({r["course_id"] for r in rows})
    enrolled: dict[str, int] = {}
    for e in service_client().table("enrollments").select("course_id").in_("course_id", course_ids).execute().data:
        enrolled[e["course_id"]] = enrolled.get(e["course_id"], 0) + 1
    return [SessionOut.model_validate(_session_out(r, present.get(r["id"], 0), enrolled.get(r["course_id"], 0))) for r in rows]


def open_session_for_course(teacher: CurrentUser, course_id: str) -> SessionOut | None:
    return next((s for s in list_sessions(teacher, course_id, limit=5) if s.status == "open"), None)


# --------------------------------------------------------------------------- student: marking

def _enrolled_course_ids(student_id: str) -> list[str]:
    return [r["course_id"] for r in service_client().table("enrollments").select("course_id")
            .eq("student_id", student_id).execute().data]


def open_sessions_for_student(student: CurrentUser) -> list[StudentSessionOut]:
    close_expired_sessions()
    course_ids = _enrolled_course_ids(student.id)
    if not course_ids:
        return []
    rows = service_client().table("attendance_sessions").select(SESSION_SELECT).in_("course_id", course_ids) \
        .eq("status", "open").order("closes_at").execute().data
    marks = {r["session_id"]: r["marked_at"] for r in service_client().table("attendance_records")
             .select("session_id, marked_at").eq("student_id", student.id)
             .in_("session_id", [r["id"] for r in rows] or ["00000000-0000-0000-0000-000000000000"]).execute().data}
    return [StudentSessionOut.model_validate({**r, "seconds_left": _seconds_left(r), "marked": r["id"] in marks,
                                              "marked_at": marks.get(r["id"])}) for r in rows]


def _session_for_student(student: CurrentUser, session_id: str) -> dict[str, Any]:
    close_expired_sessions()
    row = _get_session_row(session_id)
    if row["course_id"] not in _enrolled_course_ids(student.id):
        raise _not_found()  # not enrolled: the session does not exist for this student
    return row


def get_student_session(student: CurrentUser, session_id: str) -> StudentSessionOut:
    row = _session_for_student(student, session_id)
    mark = service_client().table("attendance_records").select("marked_at").eq("session_id", session_id) \
        .eq("student_id", student.id).maybe_single().execute()
    marked_at = mark.data["marked_at"] if mark and mark.data else None
    return StudentSessionOut.model_validate({**row, "seconds_left": _seconds_left(row), "marked": bool(marked_at),
                                             "marked_at": marked_at})


def _check_code(student: CurrentUser, row: dict[str, Any], code: str) -> None:
    key = f"{row['id']}:{student.id}"
    rate_limit_service.ensure_allowed(
        CODE_BUCKET, key, limit=CODE_LIMIT, window_seconds=CODE_WINDOW,
        message="Too many wrong codes for this session. Ask your teacher to mark you manually.")
    if code != _code_for(row["id"]):
        rate_limit_service.record(CODE_BUCKET, key)
        audit_service.log("attendance.code_wrong", actor_id=student.id, entity="attendance_session", entity_id=row["id"])
        raise AppError("wrong_code", "That code is not correct. Check the code on the board and try again.")


def _ensure_open(row: dict[str, Any]) -> None:
    if row["status"] != "open" or _seconds_left(row) <= 0:
        raise AppError("session_closed", "This attendance session has closed.")


def _ensure_not_marked(student: CurrentUser, session_id: str) -> None:
    if service_client().table("attendance_records").select("id").eq("session_id", session_id) \
            .eq("student_id", student.id).execute().data:
        raise AppError("already_marked", "You are already marked present for this session.", status.HTTP_409_CONFLICT)


def verify_code(student: CurrentUser, session_id: str, code: str) -> dict[str, bool]:
    row = _session_for_student(student, session_id)
    _ensure_open(row)
    _ensure_not_marked(student, session_id)
    _check_code(student, row, code)
    return {"ok": True}


def create_attendance_challenge(student: CurrentUser, session_id: str | None = None, ip: str | None = None) -> ChallengeOut:
    if not student.profile.get("face_enrolled"):
        raise AppError("face_not_enrolled", "Your face is not enrolled yet - please see the administrator.")
    return face_auth_service.create_challenge("attendance", user_id=student.id, ip=ip)


def mark_attendance(student: CurrentUser, session_id: str, code: str, challenge_id: str, frames: list[FrameIn],
                    *, ip: str | None = None) -> MarkResult:
    """Spec 11.2 step 5 - checks in this order: enrolled, open, code, not already marked,
    quality + liveness, then 1:1 face verification against THIS student's embedding."""
    s = get_settings()
    row = _session_for_student(student, session_id)          # enrolled (else 404)
    _ensure_open(row)                                         # open and not expired
    _check_code(student, row, code)                           # code matches (counts wrong attempts)
    _ensure_not_marked(student, session_id)                   # not already marked
    if not student.profile.get("face_enrolled"):
        raise AppError("face_not_enrolled", "Your face is not enrolled yet - please see the administrator.")

    challenge = face_auth_service.consume_challenge(challenge_id, "attendance", user_id=student.id)
    try:
        embedding, stats = face_auth_service.verify_live_face(challenge, frames)   # quality + liveness
    except FaceCheckError as exc:
        audit_service.log("attendance.face_failed", actor_id=student.id, entity="attendance_session", entity_id=session_id,
                          details={"reason": exc.code, **exc.details}, ip=ip)
        raise AppError(f"face_{exc.code}", exc.message.rstrip(".") + ".") from exc

    similarity = service_client().rpc("verify_face", {
        "p_user_id": student.id, "query": to_pgvector(as_unit_vector(embedding))}).execute().data
    if similarity is None or float(similarity) < s.FACE_VERIFY_THRESHOLD:
        audit_service.log("attendance.face_failed", actor_id=student.id, entity="attendance_session", entity_id=session_id,
                          details={"reason": "not_matched", "similarity": similarity, **stats}, ip=ip)
        raise AppError("face_not_matched", "Your face did not match your enrolled face. Please try again.")

    try:
        record = service_client().table("attendance_records").insert({
            "session_id": session_id, "student_id": student.id, "method": "face",
            "similarity": round(float(similarity), 4), "liveness_passed": True,
        }).execute().data[0]
    except Exception as exc:  # noqa: BLE001 - unique(session, student) if two tabs race
        if "duplicate" in str(exc).lower() or "unique" in str(exc).lower():
            raise AppError("already_marked", "You are already marked present for this session.",
                           status.HTTP_409_CONFLICT) from exc
        raise
    audit_service.log("attendance.mark", actor_id=student.id, entity="attendance_session", entity_id=session_id,
                      details={"course": row["course"]["code"], "similarity": round(float(similarity), 4), **stats}, ip=ip)
    marked_at = _ts(record["marked_at"])
    return MarkResult(message=f"You're marked present for {row['course']['code']}.",
                      course=CourseRef.model_validate(row["course"]), marked_at=marked_at)


# --------------------------------------------------------------------------- reports

def _report_rows(course_ids: list[str], date_from: str | None = None, date_to: str | None = None,
                 student_id: str | None = None) -> tuple[list[ReportRow], int, dict[str, list[dict[str, Any]]], dict]:
    """Per (course, student) attendance. Returns rows, sessions count, sessions by course, records by session."""
    threshold = get_settings().ATTENDANCE_LOW_THRESHOLD
    db = service_client()
    if not course_ids:
        return [], 0, {}, {}
    courses = {c["id"]: c for c in db.table("courses").select("id, code, title").in_("id", course_ids).execute().data}
    q = db.table("attendance_sessions").select("id, course_id, title, opens_at, status").in_("course_id", course_ids)
    if date_from:
        q = q.gte("opens_at", date_from)
    if date_to:
        q = q.lt("opens_at", date_to)
    sessions = q.order("opens_at").execute().data
    by_course: dict[str, list[dict[str, Any]]] = {}
    for sess in sessions:
        by_course.setdefault(sess["course_id"], []).append(sess)
    records = _records([x["id"] for x in sessions])
    marked_by_student: dict[str, set[str]] = {}
    record_by_key: dict[tuple[str, str], dict[str, Any]] = {}
    for r in records:
        marked_by_student.setdefault(r["student_id"], set()).add(r["session_id"])
        record_by_key[(r["session_id"], r["student_id"])] = r

    eq = db.table("enrollments").select(f"course_id, created_at, student:profiles({PERSON_FIELDS})").in_("course_id", course_ids)
    if student_id:
        eq = eq.eq("student_id", student_id)
    rows: list[ReportRow] = []
    for e in eq.execute().data:
        st = e.get("student")
        if not st:
            continue
        attended, total = counts_for_student(by_course.get(e["course_id"], []), _ts(e["created_at"]),
                                             marked_by_student.get(st["id"], set()))
        pct = percent(attended, total)
        rows.append(ReportRow(course=CourseRef.model_validate(courses[e["course_id"]]), student=PersonRef.model_validate(st),
                              attended=attended, total=total, percent=pct, low=is_low(pct, threshold)))
    rows.sort(key=lambda r: (r.course.code, r.student.full_name.lower()))
    return rows, len(sessions), by_course, record_by_key


def attendance_report(viewer: CurrentUser, *, course_id: str | None = None, department_id: str | None = None,
                      date_from: str | None = None, date_to: str | None = None) -> AttendanceReport:
    """Teachers: their own courses. Admins: all courses, optional department filter."""
    close_expired_sessions()
    q = service_client().table("courses").select("id")
    if viewer.role == "teacher":
        q = q.eq("teacher_id", viewer.id)
    if course_id:
        if not is_valid_uuid(course_id):
            raise AppError("course_not_found", "Course not found.", status.HTTP_404_NOT_FOUND)
        q = q.eq("id", course_id)
    if department_id and is_valid_uuid(department_id):
        q = q.eq("department_id", department_id)
    ids = [c["id"] for c in q.execute().data]
    if course_id and not ids:
        raise AppError("course_not_found", "Course not found.", status.HTTP_404_NOT_FOUND)
    # date_to is inclusive for the user ("up to and including 30 Sept").
    date_to_exclusive = (date.fromisoformat(date_to) + timedelta(days=1)).isoformat() if date_to else None
    rows, count, _, _ = _report_rows(ids, date_from, date_to_exclusive)
    return AttendanceReport(threshold=get_settings().ATTENDANCE_LOW_THRESHOLD, rows=rows, sessions_count=count)


def my_attendance(student: CurrentUser) -> list[CourseAttendance]:
    close_expired_sessions()
    ids = _enrolled_course_ids(student.id)
    rows, _, by_course, records = _report_rows(ids, student_id=student.id)
    result = []
    for row in rows:
        history = [
            HistoryItem(session_id=s["id"], title=s["title"], opens_at=_ts(s["opens_at"]), status=s["status"],
                        present=(s["id"], student.id) in records,
                        method=records.get((s["id"], student.id), {}).get("method"))
            for s in reversed(by_course.get(row.course.id, []))
        ]
        result.append(CourseAttendance(course=row.course, attended=row.attended, total=row.total, percent=row.percent,
                                       low=row.low, history=history))
    return result


def report_csv(report: AttendanceReport) -> str:
    import csv
    import io

    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["Course", "Course title", "Student", "Registration number", "Attended", "Sessions", "Percent", "Below threshold"])
    for r in report.rows:
        w.writerow([r.course.code, r.course.title, r.student.full_name, r.student.reg_number or "", r.attended, r.total,
                    "" if r.percent is None else r.percent, "yes" if r.low else "no"])
    return buf.getvalue()
