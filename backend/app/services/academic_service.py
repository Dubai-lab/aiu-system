"""Departments, courses, teacher assignment and enrollment (spec Phase 6).

Every rule lives here once; the REST routes and (Phase 9) the voice assistant
tools both call these functions.
"""

from collections import Counter
from typing import Any, Literal

from fastapi import status

from app.core.errors import AppError
from app.core.security import CurrentUser
from app.db.supabase_client import service_client
from app.schemas.academics import (
    AssignTeacherRequest,
    CourseDetail,
    CourseIn,
    CourseOut,
    CourseUpdate,
    DepartmentIn,
    DepartmentOut,
    DepartmentUpdate,
    EnrollResult,
    MyCourse,
    PersonRef,
)
from app.services import audit_service
from app.services.user_service import is_valid_uuid

Via = Literal["ui", "voice", "system"]

COURSE_SELECT = (
    "id, code, title, credits, semester, is_active, department_id, teacher_id,"
    " department:departments(id, name, code),"
    " teacher:profiles!courses_teacher_id_fkey(id, full_name, email, staff_title, is_active)"
)
PERSON_FIELDS = "id, full_name, email, reg_number, staff_title, level, is_active"


def _conflict(code: str, message: str) -> AppError:
    return AppError(code, message, status.HTTP_409_CONFLICT)


def _not_found(what: str) -> AppError:
    return AppError("not_found", f"{what} not found.", status.HTTP_404_NOT_FOUND)


# =========================================================================== departments

def list_departments() -> list[dict[str, Any]]:
    """Plain list (id, name, code) for dropdowns - readable by every logged-in user."""
    return service_client().table("departments").select("id, name, code").order("name").execute().data


def list_departments_with_counts() -> list[DepartmentOut]:
    db = service_client()
    departments = db.table("departments").select("id, name, code").order("name").execute().data
    courses = Counter(r["department_id"] for r in db.table("courses").select("department_id").execute().data)
    people = db.table("profiles").select("department_id, role").not_.is_("department_id", "null").execute().data
    students = Counter(p["department_id"] for p in people if p["role"] == "student")
    teachers = Counter(p["department_id"] for p in people if p["role"] == "teacher")
    return [
        DepartmentOut(**d, course_count=courses[d["id"]], student_count=students[d["id"]], teacher_count=teachers[d["id"]])
        for d in departments
    ]


def _get_department(department_id: str) -> dict[str, Any]:
    if not is_valid_uuid(department_id):
        raise _not_found("Department")
    r = service_client().table("departments").select("id, name, code").eq("id", department_id).maybe_single().execute()
    if not r or not r.data:
        raise _not_found("Department")
    return r.data


def _ensure_department_unique(name: str | None, code: str | None, exclude_id: str | None = None) -> None:
    db = service_client()
    for field, value, label in (("code", code, "code"), ("name", name, "name")):
        if value is None:
            continue
        q = db.table("departments").select("id").ilike(field, value)
        if exclude_id:
            q = q.neq("id", exclude_id)
        if q.execute().data:
            raise _conflict(f"department_{label}_taken", f"A department with this {label} already exists.")


def create_department(actor: CurrentUser, data: DepartmentIn, *, via: Via = "ui", ip: str | None = None) -> DepartmentOut:
    _ensure_department_unique(data.name, data.code)
    row = service_client().table("departments").insert({"name": data.name, "code": data.code}).execute().data[0]
    audit_service.log("department.create", actor_id=actor.id, entity="department", entity_id=row["id"],
                      details={"code": data.code, "name": data.name}, via=via, ip=ip)
    return DepartmentOut(**row)


def update_department(actor: CurrentUser, department_id: str, data: DepartmentUpdate, *, via: Via = "ui",
                      ip: str | None = None) -> DepartmentOut:
    _get_department(department_id)
    patch = data.model_dump(exclude_unset=True, exclude_none=True)
    if patch:
        _ensure_department_unique(patch.get("name"), patch.get("code"), exclude_id=department_id)
        service_client().table("departments").update(patch).eq("id", department_id).execute()
        audit_service.log("department.update", actor_id=actor.id, entity="department", entity_id=department_id,
                          details=patch, via=via, ip=ip)
    return next(d for d in list_departments_with_counts() if d.id == department_id)


def delete_department(actor: CurrentUser, department_id: str, *, via: Via = "ui", ip: str | None = None) -> None:
    dept = _get_department(department_id)
    counts = next(d for d in list_departments_with_counts() if d.id == department_id)
    if counts.course_count or counts.student_count or counts.teacher_count:
        raise _conflict(
            "department_in_use",
            f"{dept['name']} still has {counts.course_count} course(s), {counts.student_count} student(s) and "
            f"{counts.teacher_count} teacher(s). Move them to another department first.",
        )
    service_client().table("departments").delete().eq("id", department_id).execute()
    audit_service.log("department.delete", actor_id=actor.id, entity="department", entity_id=department_id,
                      details={"code": dept["code"], "name": dept["name"]}, via=via, ip=ip)


# =========================================================================== courses

def _enrolled_counts(course_ids: list[str]) -> Counter:
    if not course_ids:
        return Counter()
    rows = service_client().table("enrollments").select("course_id").in_("course_id", course_ids).execute().data
    return Counter(r["course_id"] for r in rows)


def _course_out(row: dict[str, Any], enrolled: int) -> dict[str, Any]:
    return {**row, "enrolled_count": enrolled}


def list_courses(*, department_id: str | None = None, search: str | None = None,
                 include_inactive: bool = True) -> list[CourseOut]:
    q = service_client().table("courses").select(COURSE_SELECT)
    if department_id and is_valid_uuid(department_id):
        q = q.eq("department_id", department_id)
    if not include_inactive:
        q = q.eq("is_active", True)
    rows = q.order("code").execute().data
    term = (search or "").strip().lower()
    if term:
        compact = term.replace(" ", "")
        rows = [r for r in rows if compact in r["code"].lower() or term in r["title"].lower()]
    counts = _enrolled_counts([r["id"] for r in rows])
    return [CourseOut.model_validate(_course_out(r, counts[r["id"]])) for r in rows]


def _get_course_row(course_id: str) -> dict[str, Any]:
    if not is_valid_uuid(course_id):
        raise _not_found("Course")
    r = service_client().table("courses").select(COURSE_SELECT).eq("id", course_id).maybe_single().execute()
    if not r or not r.data:
        raise _not_found("Course")
    return r.data


def _course_students(course_id: str) -> list[PersonRef]:
    rows = service_client().table("enrollments").select(f"student:profiles({PERSON_FIELDS})") \
        .eq("course_id", course_id).execute().data
    students = [PersonRef.model_validate(r["student"]) for r in rows if r.get("student")]
    return sorted(students, key=lambda p: p.full_name.lower())


def get_course(viewer: CurrentUser, course_id: str) -> CourseDetail:
    """Admins: any course, with students. Teachers: their own course, with students.
    Students: a course they are enrolled in, without the class list."""
    row = _get_course_row(course_id)
    students = _course_students(course_id)
    if viewer.role == "admin" or (viewer.role == "teacher" and row["teacher_id"] == viewer.id):
        return CourseDetail.model_validate({**_course_out(row, len(students)), "students": students})
    if viewer.role == "student" and any(s.id == viewer.id for s in students):
        return CourseDetail.model_validate(_course_out(row, len(students)))
    raise _not_found("Course")  # never reveal courses the viewer has no business seeing


def _ensure_code_free(code: str, exclude_id: str | None = None) -> None:
    q = service_client().table("courses").select("id").eq("code", code)
    if exclude_id:
        q = q.neq("id", exclude_id)
    if q.execute().data:
        raise _conflict("course_code_taken", f"A course with code {code} already exists.")


def _ensure_teacher(teacher_id: str) -> dict[str, Any]:
    if not is_valid_uuid(teacher_id):
        raise AppError("teacher_not_found", "That teacher does not exist.")
    r = service_client().table("profiles").select("id, full_name, role, is_active").eq("id", teacher_id).maybe_single().execute()
    if not r or not r.data or r.data["role"] != "teacher":
        raise AppError("teacher_not_found", "That teacher does not exist.")
    if not r.data["is_active"]:
        raise AppError("teacher_inactive", f"{r.data['full_name']} is deactivated and cannot be assigned.")
    return r.data


def create_course(actor: CurrentUser, data: CourseIn, *, via: Via = "ui", ip: str | None = None) -> CourseDetail:
    _get_department(data.department_id)
    _ensure_code_free(data.code)
    if data.teacher_id:
        _ensure_teacher(data.teacher_id)
    row = service_client().table("courses").insert(data.model_dump()).execute().data[0]
    audit_service.log("course.create", actor_id=actor.id, entity="course", entity_id=row["id"],
                      details={"code": data.code, "title": data.title}, via=via, ip=ip)
    return get_course(actor, row["id"])


def update_course(actor: CurrentUser, course_id: str, data: CourseUpdate, *, via: Via = "ui",
                  ip: str | None = None) -> CourseDetail:
    _get_course_row(course_id)
    patch = data.model_dump(exclude_unset=True, exclude_none=True)
    if "department_id" in patch:
        _get_department(patch["department_id"])
    if "code" in patch:
        _ensure_code_free(patch["code"], exclude_id=course_id)
    if patch:
        service_client().table("courses").update(patch).eq("id", course_id).execute()
        audit_service.log("course.update", actor_id=actor.id, entity="course", entity_id=course_id,
                          details=patch, via=via, ip=ip)
    return get_course(actor, course_id)


def delete_course(actor: CurrentUser, course_id: str, *, via: Via = "ui", ip: str | None = None) -> None:
    """Only empty courses can be deleted, so no enrollment or attendance history is lost.
    Courses in use should be deactivated instead."""
    row = _get_course_row(course_id)
    db = service_client()
    enrolled = db.table("enrollments").select("id", count="exact").eq("course_id", course_id).limit(1).execute().count
    sessions = db.table("attendance_sessions").select("id", count="exact").eq("course_id", course_id).limit(1).execute().count
    if enrolled or sessions:
        raise _conflict("course_in_use", f"{row['code']} has {enrolled} enrolled student(s) and {sessions} attendance "
                                         "session(s). Deactivate it instead, so the history is kept.")
    db.table("courses").delete().eq("id", course_id).execute()
    audit_service.log("course.delete", actor_id=actor.id, entity="course", entity_id=course_id,
                      details={"code": row["code"], "title": row["title"]}, via=via, ip=ip)


def assign_teacher(actor: CurrentUser, course_id: str, data: AssignTeacherRequest, *, via: Via = "ui",
                   ip: str | None = None) -> CourseDetail:
    row = _get_course_row(course_id)
    teacher = _ensure_teacher(data.teacher_id) if data.teacher_id else None
    service_client().table("courses").update({"teacher_id": data.teacher_id}).eq("id", course_id).execute()
    audit_service.log("course.assign_teacher" if teacher else "course.unassign_teacher", actor_id=actor.id,
                      entity="course", entity_id=course_id,
                      details={"code": row["code"], "teacher_id": data.teacher_id,
                               "teacher": teacher["full_name"] if teacher else None,
                               "previous_teacher_id": row["teacher_id"]}, via=via, ip=ip)
    return get_course(actor, course_id)


# =========================================================================== enrollment

def enroll_students(actor: CurrentUser, course_id: str, student_ids: list[str], *, via: Via = "ui",
                    ip: str | None = None) -> EnrollResult:
    row = _get_course_row(course_id)
    if not row["is_active"]:
        raise AppError("course_inactive", f"{row['code']} is deactivated. Reactivate it before enrolling students.")
    ids = list(dict.fromkeys(i for i in student_ids if is_valid_uuid(i)))  # dedupe, keep order
    if not ids:
        raise AppError("no_students", "Choose at least one student.")
    db = service_client()
    found = db.table("profiles").select("id, full_name, role, is_active").in_("id", ids).execute().data
    by_id = {p["id"]: p for p in found}
    bad = [i for i in ids if i not in by_id or by_id[i]["role"] != "student"]
    if bad:
        raise AppError("not_students", "Only registered students can be enrolled in a course.")
    inactive = [by_id[i]["full_name"] for i in ids if not by_id[i]["is_active"]]
    if inactive:
        raise AppError("students_inactive", f"Deactivated students cannot be enrolled: {', '.join(inactive)}.")

    existing = {r["student_id"] for r in db.table("enrollments").select("student_id")
                .eq("course_id", course_id).in_("student_id", ids).execute().data}
    new_ids = [i for i in ids if i not in existing]
    if new_ids:
        db.table("enrollments").upsert(
            [{"course_id": course_id, "student_id": i} for i in new_ids],
            on_conflict="course_id,student_id", ignore_duplicates=True,
        ).execute()
        audit_service.log("enrollment.add", actor_id=actor.id, entity="course", entity_id=course_id,
                          details={"code": row["code"], "student_ids": new_ids, "count": len(new_ids)}, via=via, ip=ip)
    return EnrollResult(added=len(new_ids), already_enrolled=len(existing), course=get_course(actor, course_id))


def unenroll_student(actor: CurrentUser, course_id: str, student_id: str, *, via: Via = "ui",
                     ip: str | None = None) -> CourseDetail:
    row = _get_course_row(course_id)
    if not is_valid_uuid(student_id):
        raise _not_found("Enrollment")
    deleted = service_client().table("enrollments").delete().eq("course_id", course_id) \
        .eq("student_id", student_id).execute().data
    if not deleted:
        raise _not_found("Enrollment")
    audit_service.log("enrollment.remove", actor_id=actor.id, entity="course", entity_id=course_id,
                      details={"code": row["code"], "student_id": student_id}, via=via, ip=ip)
    return get_course(actor, course_id)


# =========================================================================== my courses

def my_courses(user: CurrentUser) -> list[MyCourse]:
    """Courses a student is enrolled in, or a teacher teaches (active courses only)."""
    db = service_client()
    if user.role == "teacher":
        rows = db.table("courses").select(COURSE_SELECT).eq("teacher_id", user.id).eq("is_active", True) \
            .order("code").execute().data
        counts = _enrolled_counts([r["id"] for r in rows])
        return [MyCourse.model_validate({**r, "enrolled_count": counts[r["id"]], "role": "teacher"}) for r in rows]
    if user.role == "student":
        rows = db.table("enrollments").select(f"course:courses({COURSE_SELECT})").eq("student_id", user.id).execute().data
        courses = [r["course"] for r in rows if r.get("course") and r["course"]["is_active"]]
        return [MyCourse.model_validate({**c, "role": "student"}) for c in sorted(courses, key=lambda c: c["code"])]
    return []
