"""Request/response models for departments, courses and enrollments."""

import re
from typing import Literal

from pydantic import BaseModel, Field, field_validator


def _clean(value: str) -> str:
    return " ".join(value.split())


def normalise_course_code(value: str) -> str:
    """'csc 401' / 'CSC-401' -> 'CSC401'."""
    return re.sub(r"[\s\-_]", "", value).upper()


def valid_department_code(value: str) -> str:
    value = value.strip().upper()
    if not re.fullmatch(r"[A-Z]{2,6}", value):
        raise ValueError("must be 2-6 letters, e.g. CSC")
    return value


def valid_course_code(value: str) -> str:
    value = normalise_course_code(value)
    if not re.fullmatch(r"[A-Z]{2,6}[0-9]{3}", value):
        raise ValueError("must look like CSC401 (2-6 letters then 3 digits)")
    return value


class DepartmentIn(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    code: str = Field(min_length=2, max_length=6)

    _name = field_validator("name")(_clean)

    _code = field_validator("code")(valid_department_code)


class DepartmentUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=2, max_length=120)
    code: str | None = Field(default=None, min_length=2, max_length=6)

    @field_validator("name")
    @classmethod
    def _name(cls, v: str | None) -> str | None:
        return _clean(v) if v is not None else None

    @field_validator("code")
    @classmethod
    def _code(cls, v: str | None) -> str | None:
        return valid_department_code(v) if v is not None else None


class DepartmentOut(BaseModel):
    id: str
    name: str
    code: str
    course_count: int = 0
    student_count: int = 0
    teacher_count: int = 0


class CourseIn(BaseModel):
    code: str = Field(min_length=4, max_length=12)
    title: str = Field(min_length=2, max_length=160)
    department_id: str
    credits: int = Field(default=3, ge=1, le=10)
    semester: int = Field(default=1, ge=1, le=3)
    teacher_id: str | None = None

    _title = field_validator("title")(_clean)

    _code = field_validator("code")(valid_course_code)


class CourseUpdate(BaseModel):
    code: str | None = Field(default=None, min_length=4, max_length=12)
    title: str | None = Field(default=None, min_length=2, max_length=160)
    department_id: str | None = None
    credits: int | None = Field(default=None, ge=1, le=10)
    semester: int | None = Field(default=None, ge=1, le=3)
    is_active: bool | None = None

    @field_validator("code")
    @classmethod
    def _code(cls, v: str | None) -> str | None:
        return valid_course_code(v) if v is not None else None

    @field_validator("title")
    @classmethod
    def _title(cls, v: str | None) -> str | None:
        return _clean(v) if v is not None else None


class PersonRef(BaseModel):
    id: str
    full_name: str
    email: str
    reg_number: str | None = None
    staff_title: str | None = None
    level: int | None = None
    is_active: bool = True


class DepartmentRef(BaseModel):
    id: str
    name: str
    code: str


class CourseOut(BaseModel):
    id: str
    code: str
    title: str
    credits: int
    semester: int
    is_active: bool
    department: DepartmentRef
    teacher: PersonRef | None = None
    enrolled_count: int = 0


class CourseDetail(CourseOut):
    # Only admins and the course's own teacher receive the student list.
    students: list[PersonRef] | None = None


class AssignTeacherRequest(BaseModel):
    teacher_id: str | None = None  # null = unassign


class EnrollRequest(BaseModel):
    student_ids: list[str] = Field(min_length=1, max_length=500)


class EnrollResult(BaseModel):
    added: int
    already_enrolled: int
    course: CourseDetail


class MyCourse(BaseModel):
    id: str
    code: str
    title: str
    credits: int
    semester: int
    department: DepartmentRef
    teacher: PersonRef | None = None
    enrolled_count: int | None = None  # teachers only
    role: Literal["student", "teacher"]
