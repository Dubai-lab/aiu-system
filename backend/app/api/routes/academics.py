"""Departments, courses, teacher assignment and enrollment (spec section 15).

Read access: every logged-in user can list departments and courses.
Write access: admins only. Course detail is filtered by service rules
(admins: any; teachers: their own; students: enrolled, without the class list).
"""

from typing import Annotated

from fastapi import APIRouter, Depends, Query, Request, Response, status

from app.core.security import AdminDep, CurrentUser, CurrentUserDep, client_ip, require_roles
from app.schemas.academics import (
    AssignTeacherRequest,
    CourseDetail,
    CourseIn,
    CourseOut,
    CourseUpdate,
    DepartmentIn,
    DepartmentOut,
    DepartmentRef,
    DepartmentUpdate,
    EnrollRequest,
    EnrollResult,
    MyCourse,
)
from app.services import academic_service

router = APIRouter(tags=["academics"])
StaffOrStudent = Annotated[CurrentUser, Depends(require_roles("teacher", "student"))]


# ------------------------------------------------------------------ departments

@router.get("/departments", response_model=list[DepartmentRef])
def list_departments(_: CurrentUserDep) -> list[DepartmentRef]:
    return [DepartmentRef.model_validate(d) for d in academic_service.list_departments()]


@router.get("/departments/summary", response_model=list[DepartmentOut])
def department_summary(_: AdminDep) -> list[DepartmentOut]:
    """Departments with course / student / teacher counts (admin page)."""
    return academic_service.list_departments_with_counts()


@router.post("/departments", response_model=DepartmentOut, status_code=status.HTTP_201_CREATED)
def create_department(body: DepartmentIn, admin: AdminDep, request: Request) -> DepartmentOut:
    return academic_service.create_department(admin, body, ip=client_ip(request))


@router.patch("/departments/{department_id}", response_model=DepartmentOut)
def update_department(department_id: str, body: DepartmentUpdate, admin: AdminDep, request: Request) -> DepartmentOut:
    return academic_service.update_department(admin, department_id, body, ip=client_ip(request))


@router.delete("/departments/{department_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_department(department_id: str, admin: AdminDep, request: Request) -> Response:
    academic_service.delete_department(admin, department_id, ip=client_ip(request))
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ------------------------------------------------------------------ courses

@router.get("/courses", response_model=list[CourseOut])
def list_courses(
    user: CurrentUserDep,
    department_id: str | None = None,
    search: str | None = Query(default=None, max_length=100),
) -> list[CourseOut]:
    # Only admins see deactivated courses.
    return academic_service.list_courses(department_id=department_id, search=search,
                                         include_inactive=user.role == "admin")


@router.get("/courses/{course_id}", response_model=CourseDetail)
def get_course(course_id: str, user: CurrentUserDep) -> CourseDetail:
    return academic_service.get_course(user, course_id)


@router.post("/courses", response_model=CourseDetail, status_code=status.HTTP_201_CREATED)
def create_course(body: CourseIn, admin: AdminDep, request: Request) -> CourseDetail:
    return academic_service.create_course(admin, body, ip=client_ip(request))


@router.patch("/courses/{course_id}", response_model=CourseDetail)
def update_course(course_id: str, body: CourseUpdate, admin: AdminDep, request: Request) -> CourseDetail:
    return academic_service.update_course(admin, course_id, body, ip=client_ip(request))


@router.delete("/courses/{course_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_course(course_id: str, admin: AdminDep, request: Request) -> Response:
    academic_service.delete_course(admin, course_id, ip=client_ip(request))
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/courses/{course_id}/teacher", response_model=CourseDetail)
def assign_teacher(course_id: str, body: AssignTeacherRequest, admin: AdminDep, request: Request) -> CourseDetail:
    return academic_service.assign_teacher(admin, course_id, body, ip=client_ip(request))


@router.post("/courses/{course_id}/enrollments", response_model=EnrollResult)
def enroll_students(course_id: str, body: EnrollRequest, admin: AdminDep, request: Request) -> EnrollResult:
    return academic_service.enroll_students(admin, course_id, body.student_ids, ip=client_ip(request))


@router.delete("/courses/{course_id}/enrollments/{student_id}", response_model=CourseDetail)
def unenroll_student(course_id: str, student_id: str, admin: AdminDep, request: Request) -> CourseDetail:
    return academic_service.unenroll_student(admin, course_id, student_id, ip=client_ip(request))


# ------------------------------------------------------------------ own courses

@router.get("/my/courses", response_model=list[MyCourse])
def my_courses(user: StaffOrStudent) -> list[MyCourse]:
    """Students: courses they are enrolled in. Teachers: courses they teach."""
    return academic_service.my_courses(user)
